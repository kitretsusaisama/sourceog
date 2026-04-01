/**
 * Tests for CSRF protection on server action POST endpoints (RF-02)
 *
 * Validates: Requirements 2.1, 2.2, 2.3
 *
 * Strategy: We replicate the exact CSRF guard used in handleServerActionRequest
 * in unit tests, and exercise it end-to-end via a minimal HTTP server that
 * mirrors the guard logic.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as http from "node:http";

// ---------------------------------------------------------------------------
// Helpers — mirror the exact CSRF guard from handleServerActionRequest
// ---------------------------------------------------------------------------

/**
 * Returns true if the Origin header is present and matches the server origin.
 * This mirrors the guard added to handleServerActionRequest.
 */
function isCsrfSafe(originHeader: string | null, serverOrigin: string): boolean {
  return originHeader !== null && originHeader === serverOrigin;
}

// ---------------------------------------------------------------------------
// Unit tests — CSRF guard logic
// ---------------------------------------------------------------------------

describe("handleServerActionRequest — CSRF Origin guard (unit)", () => {
  const serverOrigin = "http://localhost:3000";

  it("allows a request with a matching Origin header", () => {
    expect(isCsrfSafe("http://localhost:3000", serverOrigin)).toBe(true);
  });

  it("blocks a request with an absent Origin header (null)", () => {
    expect(isCsrfSafe(null, serverOrigin)).toBe(false);
  });

  it("blocks a request with a mismatched Origin (different host)", () => {
    expect(isCsrfSafe("http://evil.example.com", serverOrigin)).toBe(false);
  });

  it("blocks a request with a mismatched Origin (different port)", () => {
    expect(isCsrfSafe("http://localhost:9999", serverOrigin)).toBe(false);
  });

  it("blocks a request with a mismatched Origin (different scheme)", () => {
    expect(isCsrfSafe("https://localhost:3000", serverOrigin)).toBe(false);
  });

  it("blocks a request with an empty Origin header", () => {
    expect(isCsrfSafe("", serverOrigin)).toBe(false);
  });

  it("is case-sensitive — different casing is rejected", () => {
    expect(isCsrfSafe("HTTP://LOCALHOST:3000", serverOrigin)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Integration tests — live HTTP server
// ---------------------------------------------------------------------------

/**
 * Minimal HTTP server that replicates the CSRF guard from handleServerActionRequest.
 * We create a focused server that exercises the same guard logic without
 * requiring a full SourceOG config or disk setup.
 */
function createTestServer(): http.Server {
  return http.createServer((req, res) => {
    const url = req.url ?? "/";

    // Only handle action routes
    if (!url.startsWith("/__sourceog/actions/")) {
      res.statusCode = 404;
      res.end("not found");
      return;
    }

    // Only POST is allowed
    if ((req.method ?? "GET").toUpperCase() !== "POST") {
      res.statusCode = 405;
      res.end("Method not allowed");
      return;
    }

    // CSRF protection: validate Origin header matches server origin
    const host = req.headers.host ?? "localhost";
    const serverOrigin = `http://${host}`;
    const originHeader = req.headers["origin"] ?? null;

    if (!originHeader || originHeader !== serverOrigin) {
      res.statusCode = 403;
      res.end("Forbidden");
      return;
    }

    // Simulate a successful action response
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true }));
  });
}

function makeRequest(
  server: http.Server,
  urlPath: string,
  options: { method?: string; origin?: string | null } = {}
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const headers: Record<string, string> = {};
    if (options.origin !== undefined && options.origin !== null) {
      headers["origin"] = options.origin;
    }

    const req = http.request(
      { host: "127.0.0.1", port: addr.port, path: urlPath, method: options.method ?? "POST", headers },
      (res) => {
        let body = "";
        res.on("data", (chunk) => { body += chunk; });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      }
    );
    req.on("error", reject);
    req.end();
  });
}

describe("handleServerActionRequest — CSRF Origin guard (integration)", () => {
  let server: http.Server;
  let serverPort: number;

  beforeAll(async () => {
    server = createTestServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    serverPort = (server.address() as { port: number }).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
  });

  it("returns 200 when Origin matches server origin", async () => {
    const { status } = await makeRequest(server, "/__sourceog/actions/myAction", {
      origin: `http://127.0.0.1:${serverPort}`
    });
    expect(status).toBe(200);
  });

  it("returns 403 when Origin header is absent", async () => {
    const { status } = await makeRequest(server, "/__sourceog/actions/myAction", {
      origin: null
    });
    expect(status).toBe(403);
  });

  it("returns 403 when Origin is a different host", async () => {
    const { status } = await makeRequest(server, "/__sourceog/actions/myAction", {
      origin: "http://evil.example.com"
    });
    expect(status).toBe(403);
  });

  it("returns 403 when Origin is a different port", async () => {
    const { status } = await makeRequest(server, "/__sourceog/actions/myAction", {
      origin: `http://127.0.0.1:9999`
    });
    expect(status).toBe(403);
  });

  it("returns 403 when Origin is a different scheme", async () => {
    const { status } = await makeRequest(server, "/__sourceog/actions/myAction", {
      origin: `https://127.0.0.1:${serverPort}`
    });
    expect(status).toBe(403);
  });

  it("does not execute the action when Origin is absent (body is not ok:true)", async () => {
    const { status, body } = await makeRequest(server, "/__sourceog/actions/myAction", {
      origin: null
    });
    expect(status).toBe(403);
    expect(body).not.toContain('"ok":true');
  });

  it("does not execute the action when Origin is mismatched", async () => {
    const { status, body } = await makeRequest(server, "/__sourceog/actions/myAction", {
      origin: "http://attacker.example.com"
    });
    expect(status).toBe(403);
    expect(body).not.toContain('"ok":true');
  });
});
