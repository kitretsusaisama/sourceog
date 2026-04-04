import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import type { CacheStore } from "./cache.js";
import type { CacheManifest, DecisionTrace, ExecutionPlan } from "./contracts.js";

export type SourceOGRuntimeName =
  | "node"
  | "edge"
  | "cloudflare"
  | "vercel-node"
  | "vercel-edge"
  | "deno";

export interface SourceOGRequestMemoizationState {
  entries: Map<string, Promise<unknown>>;
}

export interface SourceOGRequestRuntimeState {
  requestMemoization?: SourceOGRequestMemoizationState;
  dataCacheStore?: CacheStore;
  buildId?: string;
  cacheManifest?: CacheManifest;
  executionPlan?: ExecutionPlan;
  decisionTrace?: DecisionTrace;
}

export interface SourceOGRequest {
  url: URL;
  method: string;
  headers: Headers;
  cookies: Map<string, string>;
  requestId: string;
  runtime: SourceOGRuntimeName;
  raw?: IncomingMessage | Request;
  bodyText(): Promise<string>;
  bodyJson<T>(): Promise<T>;
}

export interface SourceOGResponseInit {
  status?: number;
  headers?: HeadersInit;
}

export class SourceOGResponse {
  public readonly status: number;

  public readonly headers: Headers;

  public readonly body: string | Readable | Uint8Array | null;

  public constructor(body: string | Readable | Uint8Array | null, init?: SourceOGResponseInit) {
    this.status = init?.status ?? 200;
    this.headers = new Headers(init?.headers ?? {});
    this.body = body;
  }
}

export interface SourceOGRequestContext {
  request: SourceOGRequest;
  params: Record<string, string | string[]>;
  query: URLSearchParams;
  locale?: string;
  runtimeState?: SourceOGRequestRuntimeState;
}

export function parseCookies(cookieHeader?: string | null): Map<string, string> {
  const cookies = new Map<string, string>();
  if (!cookieHeader) {
    return cookies;
  }

  for (const part of cookieHeader.split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (!rawKey) {
      continue;
    }

    cookies.set(rawKey, decodeURIComponent(rawValue.join("=")));
  }

  return cookies;
}

async function readNodeBody(req: IncomingMessage): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function createNodeRequest(req: IncomingMessage, baseUrl: string): SourceOGRequest {
  const url = new URL(req.url ?? "/", baseUrl);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(key, item);
      }
    } else if (value !== undefined) {
      headers.set(key, value);
    }
  }

  const requestId = headers.get("x-request-id") ?? randomUUID();

  return {
    url,
    method: (req.method ?? "GET").toUpperCase(),
    headers,
    cookies: parseCookies(headers.get("cookie")),
    requestId,
    runtime: "node",
    raw: req,
    async bodyText() {
      return readNodeBody(req);
    },
    async bodyJson<T>() {
      return JSON.parse(await readNodeBody(req)) as T;
    }
  };
}

export async function sendNodeResponse(res: ServerResponse, response: SourceOGResponse): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });

  if (!response.body) {
    res.end();
    return;
  }

  if (typeof response.body === "string" || response.body instanceof Uint8Array) {
    res.end(response.body);
    return;
  }

  const streamBody = response.body;
  await new Promise<void>((resolve, reject) => {
    streamBody.pipe(res);
    streamBody.on("end", resolve);
    streamBody.on("error", reject);
  });
}

export function html(body: string, init?: SourceOGResponseInit): SourceOGResponse {
  const response = new SourceOGResponse(body, init);
  response.headers.set("content-type", "text/html; charset=utf-8");
  return response;
}

export function json(data: unknown, init?: SourceOGResponseInit): SourceOGResponse {
  const response = new SourceOGResponse(JSON.stringify(data, null, 2), init);
  response.headers.set("content-type", "application/json; charset=utf-8");
  return response;
}

export function text(body: string, init?: SourceOGResponseInit): SourceOGResponse {
  const response = new SourceOGResponse(body, init);
  response.headers.set("content-type", "text/plain; charset=utf-8");
  return response;
}

export function redirect(location: string, status = 302): SourceOGResponse {
  const response = new SourceOGResponse(null, { status });
  response.headers.set("location", location);
  return response;
}
