/**
 * Property-based tests: cross-adapter response equivalence
 *
 * Validates Requirement 24 (Adapter Response Parity):
 * All adapters must produce equivalent responses for the same request.
 *
 * Also validates Requirement 11.4 (round-trip property):
 * parseCookieHeader(serializeCookieHeader(name, value)) produces equivalent map.
 */

import { describe, it } from "vitest";
import * as fc from "fast-check";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { DeploymentManifest } from "@sourceog/runtime";
import {
  parseCookieHeader,
  serializeCookieHeader,
  createMutableHeaders,
  createMutableCookies,
  buildWebResponse,
} from "../packages/adapter-utils/src/index";

import { nodeAdapter } from "../packages/adapter-node/src/index";
import { cloudflareAdapter } from "../packages/adapter-cloudflare/src/index";
import { vercelNodeAdapter } from "../packages/adapter-vercel-node/src/index";
import { vercelEdgeAdapter } from "../packages/adapter-vercel-edge/src/index";

// ---------------------------------------------------------------------------
// Test manifest
// ---------------------------------------------------------------------------

const TEST_MANIFEST: DeploymentManifest = {
  version: "2027.1",
  buildId: "parity-test",
  generatedAt: new Date().toISOString(),
  stability: "stable",
  routes: [
    {
      routeId: "page:/",
      pathname: "/",
      kind: "page",
      runtime: "node",
      prerendered: false,
      edgeCompatible: true,
    },
  ],
  manifests: {
    routeManifest: "route-manifest.json",
    routeGraphManifest: "route-graph-manifest.json",
    renderManifest: "render-manifest.json",
    bundleManifest: "bundle-manifest.json",
    routeOwnershipManifest: "route-ownership-manifest.json",
    assetManifest: "asset-manifest.json",
    adapterManifest: "adapter-manifest.json",
    diagnosticsManifest: "diagnostics-manifest.json",
    prerenderManifest: "prerender-manifest.json",
    cacheManifest: "cache-manifest.json",
    automationManifest: "automation-manifest.json",
    clientManifest: "client-manifest.json",
    clientReferenceManifest: "client-reference-manifest.json",
    clientBoundaryManifest: "client-boundary-manifest.json",
    rscReferenceManifest: "rsc-reference-manifest.json",
    serverReferenceManifest: "server-reference-manifest.json",
    actionManifest: "action-manifest.json",
  },
};

// ---------------------------------------------------------------------------
// Adapter runners
// ---------------------------------------------------------------------------

function makeMockNodeReq(method: string, url: string, body?: string): IncomingMessage {
  const req = new EventEmitter() as unknown as IncomingMessage;
  const r = req as unknown as Record<string, unknown>;
  r.method = method;
  r.url = url;
  r.headers = { host: "localhost" };
  r.socket = { remoteAddress: "127.0.0.1" };
  setImmediate(() => {
    if (body) req.emit("data", Buffer.from(body));
    req.emit("end");
  });
  return req;
}

async function runNode(method: string, pathname: string, body?: string) {
  if (!nodeAdapter.createRequestHandler) {
    throw new Error('createRequestHandler is not available on nodeAdapter');
  }
  const handler = nodeAdapter.createRequestHandler(TEST_MANIFEST) as (req: IncomingMessage, res: ServerResponse) => void;
  const req = makeMockNodeReq(method, pathname, body);
  let capturedBody = "";
  let capturedStatus = 200;
  const res = {
    statusCode: 200,
    headersSent: false,
    setHeader() { return this; },
    getHeader() { return undefined; },
    write(d: string | Buffer) { capturedBody += typeof d === "string" ? d : d.toString(); },
    on() { return this; },
    once() { return this; },
    emit() { return false; },
    pipe(dest: unknown) { return dest; },
  } as unknown as ServerResponse & { statusCode: number };
  await new Promise<void>((resolve) => {
    (res as unknown as Record<string, unknown>).end = (d?: string | Buffer) => {
      capturedStatus = (res as { statusCode: number }).statusCode;
      if (d) capturedBody += typeof d === "string" ? d : d.toString();
      resolve();
    };
    handler(req, res);
  });
  return { status: capturedStatus, body: capturedBody };
}

function makeWebReq(method: string, pathname: string, body?: string): Request {
  return new Request(`http://localhost${pathname}`, {
    method,
    body: body != null && !["GET", "HEAD"].includes(method) ? body : undefined,
    headers: { "content-type": "application/json" },
  });
}

async function runCloudflare(method: string, pathname: string, body?: string) {
  const handler = cloudflareAdapter.createRequestHandler
    ? cloudflareAdapter.createRequestHandler(TEST_MANIFEST) as (
      req: Request,
      env: Record<string, unknown>,
      ctx: { waitUntil(p: Promise<unknown>): void; passThroughOnException(): void }
    ) => Promise<Response>
    : async (_req: Request, _env: Record<string, unknown>, _ctx: { waitUntil(p: Promise<unknown>): void; passThroughOnException(): void }) => {
        throw new Error('createRequestHandler is not available');
      };
  const res = await handler(makeWebReq(method, pathname, body), {}, {
    waitUntil: () => {},
    passThroughOnException: () => {},
  });
  return { status: res.status, body: await res.text() };
}

async function runVercelEdge(method: string, pathname: string, body?: string) {
  const handler = vercelEdgeAdapter.createRequestHandler?.(TEST_MANIFEST) as (req: Request) => Promise<Response>;
  const res = await handler(makeWebReq(method, pathname, body));
  return { status: res.status, body: await res.text() };
}

async function runVercelNode(method: string, pathname: string, body?: string) {
  const handler = vercelNodeAdapter.createRequestHandler?.(TEST_MANIFEST) as (req: unknown, res: unknown) => void;
  const req = new EventEmitter() as unknown as IncomingMessage;
  const r = req as unknown as Record<string, unknown>;
  r.method = method;
  r.url = pathname;
  r.headers = { host: "localhost" };
  r.socket = { remoteAddress: "127.0.0.1" };
  r.query = {};
  r.cookies = {};
  r.body = body ?? null;
  setImmediate(() => {
    if (body) req.emit("data", Buffer.from(body));
    req.emit("end");
  });
  let capturedBody = "";
  let capturedStatus = 200;
  const res = {
    statusCode: 200,
    headersSent: false,
    setHeader() { return this; },
    getHeader() { return undefined; },
    write(d: string | Buffer) { capturedBody += typeof d === "string" ? d : d.toString(); },
    on() { return this; },
    once() { return this; },
    emit() { return false; },
    pipe(dest: unknown) { return dest; },
    json(b: unknown) { capturedBody = JSON.stringify(b); return this; },
    send(b: unknown) { capturedBody = String(b); return this; },
    status(this: { statusCode: number }, code: number) { this.statusCode = code; return this; },
  } as unknown as ServerResponse & { statusCode: number };
  await new Promise<void>((resolve) => {
    (res as unknown as Record<string, unknown>).end = (d?: string | Buffer) => {
      capturedStatus = (res as { statusCode: number }).statusCode;
      if (d) capturedBody += typeof d === "string" ? d : d.toString();
      resolve();
    };
    handler(req, res);
  });
  return { status: capturedStatus, body: capturedBody };
}

async function collectAll(method: string, pathname: string, body?: string) {
  return Promise.all([
    runNode(method, pathname, body),
    runCloudflare(method, pathname, body),
    runVercelNode(method, pathname, body),
    runVercelEdge(method, pathname, body),
  ]);
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const pathnameArb = fc.oneof(
  fc.constant("/"),
  fc.stringMatching(/^\/[a-z][a-z0-9-]*$/)
);

const cookieNameArb = fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_-]{0,15}$/);
const cookieValueArb = fc.stringMatching(/^[a-zA-Z0-9 !#$%&'*+\-.^_`|~]{1,30}$/);

// ---------------------------------------------------------------------------
// Property: all adapters return identical status for the same request
// ---------------------------------------------------------------------------

describe("Property: cross-adapter response parity", () => {
  it("all adapters return identical status codes", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          method: fc.constantFrom("GET", "POST", "PUT", "DELETE"),
          pathname: pathnameArb,
          body: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: null }),
        }),
        async ({ method, pathname, body }) => {
          const results = await collectAll(method, pathname, body ?? undefined);
          const statuses = results.map((r) => r.status);
          return statuses.every((s) => s === statuses[0]);
        }
      ),
      { numRuns: 50 }
    );
  });

  it("all adapters return identical response bodies", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          method: fc.constantFrom("GET", "POST", "PUT", "DELETE"),
          pathname: pathnameArb,
          body: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: null }),
        }),
        async ({ method, pathname, body }) => {
          const results = await collectAll(method, pathname, body ?? undefined);
          const bodies = results.map((r) => r.body);
          return bodies.every((b) => b === bodies[0]);
        }
      ),
      { numRuns: 50 }
    );
  });

  it("matched route (/) returns 200 across all adapters", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom("GET", "POST", "PUT", "DELETE"),
        async (method) => {
          const results = await collectAll(method, "/");
          return results.every((r) => r.status === 200);
        }
      ),
      { numRuns: 20 }
    );
  });

  it("unmatched route returns 404 across all adapters", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          method: fc.constantFrom("GET", "POST"),
          pathname: fc.stringMatching(/^\/[a-z][a-z0-9-]*$/),
        }),
        async ({ method, pathname }) => {
          const results = await collectAll(method, pathname);
          return results.every((r) => r.status === 404);
        }
      ),
      { numRuns: 30 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property: cookie round-trip (Requirement 11.4)
// ---------------------------------------------------------------------------

describe("Property: cookie round-trip", () => {
  it("parseCookieHeader(serializeCookieHeader(name, value)).get(name) === value", () => {
    fc.assert(
      fc.property(
        cookieNameArb,
        cookieValueArb,
        (name, value) => {
          const serialized = serializeCookieHeader(name, value);
          const parsed = parseCookieHeader(serialized);
          return parsed.get(name) === value;
        }
      ),
      { numRuns: 200 }
    );
  });

  it("parseCookieHeader preserves all cookies in a multi-cookie string", () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ name: cookieNameArb, value: cookieValueArb }), { minLength: 1, maxLength: 5 }),
        (pairs) => {
          // Deduplicate names
          const unique = [...new Map(pairs.map((p) => [p.name, p.value])).entries()];
          const cookieStr = unique.map(([n, v]) => `${n}=${encodeURIComponent(v)}`).join("; ");
          const parsed = parseCookieHeader(cookieStr);
          return unique.every(([n, v]) => parsed.get(n) === v);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property: buildWebResponse flushes all pending cookies
// ---------------------------------------------------------------------------

describe("Property: buildWebResponse cookie flushing", () => {
  it("every pending cookie appears in Set-Cookie header", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({ name: cookieNameArb, value: cookieValueArb }),
          { minLength: 1, maxLength: 5 }
        ),
        (pairs) => {
          const headers = createMutableHeaders();
          const cookies = createMutableCookies(new Map());
          for (const { name, value } of pairs) {
            cookies.set(name, value);
          }
          const res = buildWebResponse({ status: 200, headers, cookies, body: null });
          // In Web API, multiple Set-Cookie headers are joined by comma in .get()
          // We check the raw headers via getSetCookie if available, else fall back
          const setCookieRaw = res.headers.get("set-cookie") ?? "";
          return pairs.every(({ name }) => setCookieRaw.includes(`${name}=`));
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property: createMutableHeaders case-insensitivity
// ---------------------------------------------------------------------------

describe("Property: createMutableHeaders case-insensitivity", () => {
  it("get is case-insensitive for any header name", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9-]{1,20}$/),
        fc.string({ minLength: 1, maxLength: 50 }),
        (name, value) => {
          const h = createMutableHeaders();
          h.set(name, value);
          return (
            h.get(name.toLowerCase()) === value &&
            h.get(name.toUpperCase()) === value &&
            h.get(name) === value
          );
        }
      ),
      { numRuns: 200 }
    );
  });
});
