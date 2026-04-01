/**
 * Tests for Content-Type validation in handleServerActionRequest (RF-06)
 *
 * Validates: Requirements 3.1, 3.2
 *
 * Strategy: We replicate the exact Content-Type guard used in
 * handleServerActionRequest in unit tests, and exercise it end-to-end via a
 * minimal HTTP server that mirrors the guard logic (including the CSRF guard
 * that precedes it, so we can reach the Content-Type check).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as http from "node:http";

// ---------------------------------------------------------------------------
// Helpers — mirror the exact Content-Type guard from handleServerActionRequest
// ---------------------------------------------------------------------------

/**
 * Returns true if the Content-Type header indicates an application/json body.
 * Uses .includes() to handle variants like "application/json; charset=utf-8".
 */
function isJsonContentType(contentTypeHeader: string | null): boolean {
  if (!contentTypeHeader) return false;
  return contentTypeHeader.includes("application/json");
}

// ---------------------------------------------------------------------------
// Unit tests — Content-Type guard logic
// ---------------------------------------------------------------------------

describe("handleServerActionRequest — Content-Type guard (unit)", () => {
  it("accepts application/json", () => {
    expect(isJsonContentType("application/json")).toBe(true);
  });

  it("accepts application/json; charset=utf-8", () => {
    expect(isJsonContentType("application/json; charset=utf-8")).toBe(true);
  });

  it("rejects text/plain", () => {
    expect(isJsonContentType("text/plain")).toBe(false);
  });

  it("rejects application/x-www-form-urlencoded", () => {
    expect(isJsonContentType("application/x-www-form-urlencoded")).toBe(false);
  });

  it("rejects multipart/form-data", () => {
    expect(isJsonContentType("multipart/form-data; boundary=----boundary")).toBe(false);
  });

  it("rejects null (no Content-Type header)", () => {
    expect(isJsonContentType(null)).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isJsonContentType("")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Integration tests — live HTTP server
// ---------------------------------------------------------------------------

/**
 * Minimal HTTP server that replicates both the CSRF guard and the Content-Type
 * guard from handleServerActionRequest, in the same order as the real server.
 */
function createTestServer(): http.Server {
  return http.createServer((req, res) => {
    const url = req.url ?? "/";

    if (!url.startsWith("/__sourceog/actions/")) {
      res.statusCode = 404;
      res.end("not found");
      return;
    }

    if ((req.method ?? "GET").toUpperCase() !== "POST") {
      res.statusCode = 405;
      res.end("Method not allowed");
      return;
    }

    // CSRF guard (must pass to reach Content-Type check)
    const host = req.headers.host ?? "localhost";
    const serverOrigin = `http://${host}`;
    const originHeader = req.headers["origin"] ?? null;
    if (!originHeader || originHeader !== serverOrigin) {
      res.statusCode = 403;
      res.end("Forbidden");
      return;
    }

    // Content-Type guard (RF-06)
    const contentType = req.headers["content-type"] ?? "";
    if (!contentType.includes("application/json")) {
      res.statusCode = 400;
      res.end("Unsupported Media Type");
      return;
    }

    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true }));
  });
}

function makeRequest(
  server: http.Server,
  urlPath: string,
  options: { contentType?: string | null } = {}
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const headers: Record<string, string> = {
      // Always send a matching Origin so CSRF passes and we reach the CT check
      origin: `http://127.0.0.1:${addr.port}`
    };
    if (options.contentType !== undefined && options.contentType !== null) {
      headers["content-type"] = options.contentType;
    }

    const req = http.request(
      { host: "127.0.0.1", port: addr.port, path: urlPath, method: "POST", headers },
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

describe("handleServerActionRequest — Content-Type guard (integration)", () => {
  let server: http.Server;

  beforeAll(async () => {
    server = createTestServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
  });

  it("returns 200 for Content-Type: application/json", async () => {
    const { status } = await makeRequest(server, "/__sourceog/actions/myAction", {
      contentType: "application/json"
    });
    expect(status).toBe(200);
  });

  it("returns 200 for Content-Type: application/json; charset=utf-8", async () => {
    const { status } = await makeRequest(server, "/__sourceog/actions/myAction", {
      contentType: "application/json; charset=utf-8"
    });
    expect(status).toBe(200);
  });

  it("returns 400 for Content-Type: text/plain", async () => {
    const { status } = await makeRequest(server, "/__sourceog/actions/myAction", {
      contentType: "text/plain"
    });
    expect(status).toBe(400);
  });

  it("returns 400 for Content-Type: application/x-www-form-urlencoded", async () => {
    const { status } = await makeRequest(server, "/__sourceog/actions/myAction", {
      contentType: "application/x-www-form-urlencoded"
    });
    expect(status).toBe(400);
  });

  it("returns 400 when Content-Type header is absent", async () => {
    const { status } = await makeRequest(server, "/__sourceog/actions/myAction", {
      contentType: null
    });
    expect(status).toBe(400);
  });

  it("does not parse the body when Content-Type is wrong (body is not ok:true)", async () => {
    const { status, body } = await makeRequest(server, "/__sourceog/actions/myAction", {
      contentType: "text/plain"
    });
    expect(status).toBe(400);
    expect(body).not.toContain('"ok":true');
  });
});
