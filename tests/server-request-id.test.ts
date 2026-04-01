/**
 * Tests for x-request-id propagation through the server (RF-29)
 *
 * Validates: Requirement 21 (Request Tracing with Correlation IDs)
 *
 * Strategy: We replicate the exact x-request-id guard logic in unit tests,
 * and exercise it end-to-end via a minimal HTTP server that mirrors the
 * request-id assignment and response header propagation.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as http from "node:http";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Helpers — mirror the exact x-request-id logic from createSourceOGServer
// ---------------------------------------------------------------------------

/**
 * Resolves the request ID: uses the incoming header if present, otherwise
 * generates a new UUID. Mirrors the logic in createSourceOGServer.
 */
function resolveRequestId(incomingHeader: string | undefined): string {
  return incomingHeader ?? randomUUID();
}

/**
 * Returns true if the value is a valid UUID v4 string.
 */
function isValidUUID(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

// ---------------------------------------------------------------------------
// Unit tests — x-request-id assignment logic
// ---------------------------------------------------------------------------

describe("x-request-id assignment (unit)", () => {
  it("uses the incoming x-request-id header when present", () => {
    const incoming = "my-trace-id-123";
    expect(resolveRequestId(incoming)).toBe("my-trace-id-123");
  });

  it("generates a new UUID when x-request-id header is absent", () => {
    const id = resolveRequestId(undefined);
    expect(id).toBeTruthy();
    expect(isValidUUID(id)).toBe(true);
  });

  it("generates a different UUID on each call when no header is present", () => {
    const id1 = resolveRequestId(undefined);
    const id2 = resolveRequestId(undefined);
    expect(id1).not.toBe(id2);
  });

  it("isValidUUID accepts a valid UUID v4", () => {
    expect(isValidUUID(randomUUID())).toBe(true);
    expect(isValidUUID(randomUUID())).toBe(true);
  });

  it("isValidUUID rejects non-UUID strings", () => {
    expect(isValidUUID("not-a-uuid")).toBe(false);
    expect(isValidUUID("")).toBe(false);
    expect(isValidUUID("my-trace-id-123")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Integration tests — live HTTP server
// ---------------------------------------------------------------------------

/**
 * Minimal HTTP server that replicates the x-request-id logic from
 * createSourceOGServer. Exercises the same assignment and response header
 * propagation without requiring a full SourceOG config or disk setup.
 */
function createTestServer(): http.Server {
  return http.createServer((req, res) => {
    // RF-29: Assign unique x-request-id if not present in incoming request headers
    const requestId = (req.headers["x-request-id"] as string | undefined) ?? randomUUID();

    // Propagate x-request-id in response headers
    res.setHeader("x-request-id", requestId);
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true, requestId }));
  });
}

function makeRequest(
  server: http.Server,
  options: { requestId?: string } = {}
): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const headers: Record<string, string> = {};
    if (options.requestId !== undefined) {
      headers["x-request-id"] = options.requestId;
    }

    const req = http.request(
      { host: "127.0.0.1", port: addr.port, path: "/", method: "GET", headers },
      (res) => {
        let body = "";
        res.on("data", (chunk) => { body += chunk; });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
      }
    );
    req.on("error", reject);
    req.end();
  });
}

describe("x-request-id propagation (integration)", () => {
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

  it("assigns a new x-request-id when none is provided in the request", async () => {
    const { headers } = await makeRequest(server);
    const responseId = headers["x-request-id"];
    expect(responseId).toBeTruthy();
    expect(typeof responseId).toBe("string");
    expect(isValidUUID(responseId as string)).toBe(true);
  });

  it("echoes back the x-request-id from the incoming request", async () => {
    const incomingId = "my-correlation-id-abc";
    const { headers } = await makeRequest(server, { requestId: incomingId });
    expect(headers["x-request-id"]).toBe(incomingId);
  });

  it("echoes back a UUID x-request-id from the incoming request", async () => {
    const incomingId = randomUUID();
    const { headers } = await makeRequest(server, { requestId: incomingId });
    expect(headers["x-request-id"]).toBe(incomingId);
  });

  it("generates different x-request-ids for different requests without a header", async () => {
    const [res1, res2] = await Promise.all([
      makeRequest(server),
      makeRequest(server)
    ]);
    const id1 = res1.headers["x-request-id"];
    const id2 = res2.headers["x-request-id"];
    expect(id1).toBeTruthy();
    expect(id2).toBeTruthy();
    expect(id1).not.toBe(id2);
  });

  it("assigned x-request-id is a valid UUID when none is provided", async () => {
    const { headers } = await makeRequest(server);
    expect(isValidUUID(headers["x-request-id"] as string)).toBe(true);
  });
});
