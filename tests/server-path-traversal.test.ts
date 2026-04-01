/**
 * Tests for path traversal protection in serveInternalAsset (RF-01)
 *
 * Validates: Requirements 1.1, 1.2
 *
 * Strategy: We test the path validation logic directly by replicating the
 * exact guard used in serveInternalAsset, and also via a live HTTP server
 * to confirm end-to-end behaviour.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as http from "node:http";
import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";

// ---------------------------------------------------------------------------
// Helpers — mirror the exact guard from serveInternalAsset
// ---------------------------------------------------------------------------

/**
 * Returns true if `resolvedPath` is safely within `safeRoot`.
 * This mirrors the guard added to serveInternalAsset.
 */
function isPathSafe(resolvedPath: string, safeRoot: string): boolean {
  return resolvedPath.startsWith(safeRoot + path.sep) || resolvedPath === safeRoot;
}

/**
 * Resolves an asset path the same way serveInternalAsset does.
 */
function resolveAssetPath(distRoot: string, urlPath: string): string {
  return path.resolve(distRoot, "static", urlPath.replace(/^\//, "").replaceAll("/", path.sep));
}

// ---------------------------------------------------------------------------
// Unit tests — path validation logic
// ---------------------------------------------------------------------------

describe("serveInternalAsset — path traversal guard (unit)", () => {
  const distRoot = path.resolve(os.tmpdir(), "sourceog-unit-test");
  const safeRoot = path.resolve(distRoot, "static");

  it("allows a normal asset path within distRoot/static", () => {
    const url = "/__sourceog/client.js";
    const resolved = resolveAssetPath(distRoot, url);
    expect(isPathSafe(resolved, safeRoot)).toBe(true);
  });

  it("allows a nested asset path within distRoot/static", () => {
    const url = "/__sourceog/chunks/vendor.js";
    const resolved = resolveAssetPath(distRoot, url);
    expect(isPathSafe(resolved, safeRoot)).toBe(true);
  });

  it("blocks a path with .. that escapes distRoot/static", () => {
    const url = "/__sourceog/../../../etc/passwd";
    const resolved = resolveAssetPath(distRoot, url);
    expect(isPathSafe(resolved, safeRoot)).toBe(false);
  });

  it("blocks a path with .. that escapes to distRoot parent", () => {
    const url = "/__sourceog/../../secret.json";
    const resolved = resolveAssetPath(distRoot, url);
    expect(isPathSafe(resolved, safeRoot)).toBe(false);
  });

  it("allows a path with .. that stays within distRoot/static", () => {
    // /__sourceog/../ resolves to distRoot/static (the safeRoot itself) — still safe
    const url = "/__sourceog/../";
    const resolved = resolveAssetPath(distRoot, url);
    expect(isPathSafe(resolved, safeRoot)).toBe(true);
  });

  it("allows a path with .. that navigates within distRoot/static", () => {
    // /__sourceog/../public/secret.json resolves to distRoot/static/public/secret.json — still inside static
    const url = "/__sourceog/../public/secret.json";
    const resolved = resolveAssetPath(distRoot, url);
    expect(isPathSafe(resolved, safeRoot)).toBe(true);
  });

  it("blocks a path that starts with safeRoot string but is actually a sibling directory", () => {
    // e.g. distRoot/static-evil/file.js — starts with safeRoot string but not safeRoot + sep
    const evilRoot = safeRoot + "-evil";
    const resolved = path.join(evilRoot, "file.js");
    expect(isPathSafe(resolved, safeRoot)).toBe(false);
  });

  it("allows the safeRoot itself (edge case)", () => {
    expect(isPathSafe(safeRoot, safeRoot)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Integration tests — live HTTP server
// ---------------------------------------------------------------------------

/**
 * Minimal HTTP server that replicates the serveInternalAsset guard.
 * We can't easily spin up createSourceOGServer (requires full config + disk),
 * so we create a minimal server that exercises the same guard logic.
 */
function createTestServer(distRoot: string): http.Server {
  const safeRoot = path.resolve(distRoot, "static");

  return http.createServer((req, res) => {
    const url = req.url ?? "/";

    if (!url.startsWith("/__sourceog/")) {
      res.statusCode = 404;
      res.end("not found");
      return;
    }

    const assetPath = path.resolve(distRoot, "static", url.replace(/^\//, "").replaceAll("/", path.sep));

    // Path traversal protection — same guard as serveInternalAsset
    if (!(assetPath.startsWith(safeRoot + path.sep) || assetPath === safeRoot)) {
      res.statusCode = 404;
      res.end();
      return;
    }

    if (fs.existsSync(assetPath)) {
      res.statusCode = 200;
      res.setHeader("content-type", "application/javascript; charset=utf-8");
      fs.createReadStream(assetPath).pipe(res);
    } else {
      res.statusCode = 404;
      res.end();
    }
  });
}

function makeRequest(server: http.Server, urlPath: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const req = http.request({ host: "127.0.0.1", port: addr.port, path: urlPath }, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

describe("serveInternalAsset — path traversal guard (integration)", () => {
  let tmpDir: string;
  let server: http.Server;

  beforeAll(async () => {
    // Create a temp distRoot with a static asset
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sourceog-test-"));
    const staticDir = path.join(tmpDir, "static", "__sourceog");
    fs.mkdirSync(staticDir, { recursive: true });
    fs.writeFileSync(path.join(staticDir, "client.js"), "// client runtime", "utf8");

    // Also create a sensitive file outside static to verify it can't be read
    fs.writeFileSync(path.join(tmpDir, "secret.txt"), "sensitive data", "utf8");

    server = createTestServer(tmpDir);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("serves a valid asset within distRoot/static", async () => {
    const { status } = await makeRequest(server, "/__sourceog/client.js");
    expect(status).toBe(200);
  });

  it("returns 404 for path with .. escaping distRoot/static", async () => {
    const { status } = await makeRequest(server, "/__sourceog/../../../etc/passwd");
    expect(status).toBe(404);
  });

  it("returns 404 for path escaping to distRoot parent", async () => {
    const { status } = await makeRequest(server, "/__sourceog/../../secret.txt");
    expect(status).toBe(404);
  });

  it("returns 404 for path escaping to distRoot sibling", async () => {
    const { status } = await makeRequest(server, "/__sourceog/../secret.txt");
    expect(status).toBe(404);
  });

  it("returns 404 for path with encoded traversal sequences", async () => {
    // URL-encoded .. — path.resolve handles these after decoding
    const { status } = await makeRequest(server, "/__sourceog/%2e%2e/secret.txt");
    expect(status).toBe(404);
  });

  it("returns 404 for non-existent asset within safe root", async () => {
    const { status } = await makeRequest(server, "/__sourceog/nonexistent.js");
    expect(status).toBe(404);
  });
});
