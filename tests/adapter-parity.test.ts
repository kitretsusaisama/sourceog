/**
 * Property 16: Adapter parity — byte-identical responses
 * Validates: Requirements 6.8
 */

import { describe, it } from "vitest";
import * as fc from "fast-check";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { DeploymentManifest } from "@sourceog/runtime";

import { nodeAdapter } from "../packages/adapter-node/src/index.js";
import { cloudflareAdapter } from "../packages/adapter-cloudflare/src/index.js";
import { vercelNodeAdapter } from "../packages/adapter-vercel-node/src/index.js";
import { vercelEdgeAdapter } from "../packages/adapter-vercel-edge/src/index.js";
import type { NodeRequestHandler } from "../packages/adapter-node/src/index.js";
import type { CloudflareRequestHandler, ExecutionContext, Env } from "../packages/adapter-cloudflare/src/index.js";
import type { VercelRequestHandler, VercelRequest, VercelResponse } from "../packages/adapter-vercel-node/src/index.js";
import type { VercelEdgeHandler } from "../packages/adapter-vercel-edge/src/index.js";

const TEST_MANIFEST: DeploymentManifest = {
  version: "1.0.0",
  buildId: "test-build",
  generatedAt: new Date().toISOString(),
  stability: "stable",
  routes: [
    {
      routeId: "page:/",
      pathname: "/",
      kind: "page",
      runtime: "auto",
      prerendered: false,
      edgeCompatible: true,
    },
  ],
  manifests: {
    routeManifest: "",
    routeGraphManifest: "",
    renderManifest: "",
    bundleManifest: "",
    routeOwnershipManifest: "",
    assetManifest: "",
    adapterManifest: "",
    diagnosticsManifest: "",
    prerenderManifest: "",
    cacheManifest: "",
    automationManifest: "",
    clientManifest: "",
    clientReferenceManifest: "",
    clientBoundaryManifest: "",
    rscReferenceManifest: "",
    serverReferenceManifest: "",
    actionManifest: "",
  },
};

// Bypass the optional `createRequestHandler?` signature on SourceOGAdapter
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getHandler<T>(adapter: { createRequestHandler?: (...args: any[]) => any }, manifest: DeploymentManifest): T {
  if (!adapter.createRequestHandler) throw new Error(`${String(adapter)} has no createRequestHandler`);
  return adapter.createRequestHandler(manifest) as T;
}

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
  const handler = getHandler<NodeRequestHandler>(nodeAdapter, TEST_MANIFEST);
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
  } as unknown as ServerResponse;
  await new Promise<void>((resolve) => {
    (res as unknown as Record<string, unknown>).end = (d?: string | Buffer) => {
      capturedStatus = (res as unknown as { statusCode: number }).statusCode;
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
  const handler = getHandler<CloudflareRequestHandler>(cloudflareAdapter, TEST_MANIFEST);
  const res = await handler(makeWebReq(method, pathname, body), {} as Env, {
    waitUntil: () => {},
    passThroughOnException: () => {},
  } as ExecutionContext);
  return { status: res.status, body: await res.text() };
}

async function runVercelEdge(method: string, pathname: string, body?: string) {
  const handler = getHandler<VercelEdgeHandler>(vercelEdgeAdapter, TEST_MANIFEST);
  const res = await handler(makeWebReq(method, pathname, body));
  return { status: res.status, body: await res.text() };
}

async function runVercelNode(method: string, pathname: string, body?: string) {
  const handler = getHandler<VercelRequestHandler>(vercelNodeAdapter, TEST_MANIFEST);
  const req = new EventEmitter() as unknown as VercelRequest;
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
    status(code: number) { (this as unknown as { statusCode: number }).statusCode = code; return this; },
  } as unknown as VercelResponse;
  await new Promise<void>((resolve) => {
    (res as unknown as Record<string, unknown>).end = (d?: string | Buffer) => {
      capturedStatus = (res as unknown as { statusCode: number }).statusCode;
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

// Pathname generator: valid paths, no double slashes
const pathnameArb = fc.oneof(
  fc.constant("/"),
  fc.stringMatching(/^\/[a-z][a-z0-9-]*$/)
);

describe("Property 16: Adapter parity — byte-identical responses", () => {
  it("all adapters return identical status for the same request fixture", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          method: fc.constantFrom("GET", "POST", "PUT", "DELETE"),
          pathname: pathnameArb,
          body: fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: null }),
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

  it("all adapters return identical body for the same request fixture", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          method: fc.constantFrom("GET", "POST", "PUT", "DELETE"),
          pathname: pathnameArb,
          body: fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: null }),
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

  it("matched route (/) returns status 200 across all adapters", async () => {
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
          const statuses = results.map((r) => r.status);
          return statuses.every((s) => s === statuses[0]);
        }
      ),
      { numRuns: 30 }
    );
  });
});
