import fs from "node:fs/promises";
import path from "node:path";
import { PassThrough, Writable } from "node:stream";
import type { IncomingHttpHeaders, IncomingMessage } from "node:http";
import { createSourceOGServer, type SourceOGServerInstance } from "@sourceog/server";

export interface TestInstanceOptions {
  cwd: string;
  mode?: "development" | "production";
}

export interface NormalizedTestResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface TestInstance {
  cwd: string;
  server: SourceOGServerInstance;
  fetch(pathname: string, init?: RequestInit): Promise<Response>;
  close(): Promise<void>;
}

export interface FixtureRequest {
  pathname: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface FixtureResult {
  fixtureName: string;
  request: FixtureRequest;
  response: NormalizedTestResponse;
}

export interface AdapterParityMismatch {
  fixtureName: string;
  field: "status" | "headers" | "body";
  adapterNames: string[];
  values: unknown[];
}

export interface AdapterLike {
  name: string;
  createRequestHandler?(manifest: unknown): unknown;
}

class MockIncomingMessage extends PassThrough {
  public method?: string;
  public url?: string;
  public headers: IncomingHttpHeaders;
  public socket: { remoteAddress?: string };

  public constructor(input: { pathname: string; method: string; headers: Record<string, string>; body?: string }) {
    super();
    this.method = input.method;
    this.url = input.pathname;
    this.headers = input.headers;
    this.socket = { remoteAddress: "127.0.0.1" };

    queueMicrotask(() => {
      if (input.body) {
        this.write(input.body);
      }
      this.end();
    });
  }
}

class MockServerResponse extends Writable {
  public statusCode = 200;
  public headersSent = false;
  private readonly headerMap = new Map<string, string | string[]>();
  private readonly chunks: Buffer[] = [];
  private readonly completion: Promise<void>;
  private resolveCompletion!: () => void;

  public constructor() {
    super();
    this.completion = new Promise<void>((resolve) => {
      this.resolveCompletion = resolve;
    });
  }

  public setHeader(name: string, value: string | string[]): this {
    this.headerMap.set(name.toLowerCase(), value);
    return this;
  }

  public getHeader(name: string): string | string[] | undefined {
    return this.headerMap.get(name.toLowerCase());
  }

  public getHeaders(): Record<string, string | string[]> {
    return Object.fromEntries(this.headerMap.entries());
  }

  public end(cb?: () => void): this;
  public end(chunk: string | Buffer | Uint8Array, cb?: () => void): this;
  public end(chunk: string | Buffer | Uint8Array, encoding: BufferEncoding, cb?: () => void): this;
  public end(
    chunkOrCb?: string | Buffer | Uint8Array | (() => void),
    encodingOrCb?: BufferEncoding | (() => void),
    cb?: () => void
  ): this {
    const chunk = typeof chunkOrCb === "function" ? undefined : chunkOrCb;
    const encoding = typeof encodingOrCb === "function" ? undefined : encodingOrCb;
    const callback = typeof chunkOrCb === "function"
      ? chunkOrCb
      : typeof encodingOrCb === "function"
        ? encodingOrCb
        : cb;

    if (chunk) {
      if (typeof chunk === "string") {
        this.chunks.push(Buffer.from(chunk, encoding));
      } else {
        this.chunks.push(Buffer.from(chunk));
      }
    }
    this.headersSent = true;
    super.end(callback);
    this.resolveCompletion();
    return this;
  }

  public async toResponse(): Promise<Response> {
    await this.completion;
    const headers = new Headers();
    for (const [name, value] of this.headerMap.entries()) {
      if (Array.isArray(value)) {
        for (const item of value) {
          headers.append(name, item);
        }
      } else {
        headers.set(name, value);
      }
    }

    return new Response(Buffer.concat(this.chunks), {
      status: this.statusCode,
      headers
    });
  }

  public _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void
  ): void {
    this.chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    callback();
  }
}

function normalizeHeaders(headers?: HeadersInit): Record<string, string> {
  const normalized = new Headers(headers ?? {});
  if (!normalized.has("host")) {
    normalized.set("host", "localhost");
  }
  const result: Record<string, string> = {};
  normalized.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

export async function createTestInstance(options: TestInstanceOptions): Promise<TestInstance> {
  const server = await createSourceOGServer({
    cwd: options.cwd,
    mode: options.mode ?? "development"
  });

  return {
    cwd: options.cwd,
    server,
    async fetch(pathname: string, init?: RequestInit): Promise<Response> {
      const req = new MockIncomingMessage({
        pathname,
        method: (init?.method ?? "GET").toUpperCase(),
        headers: normalizeHeaders(init?.headers),
        body: typeof init?.body === "string" ? init.body : undefined
      }) as unknown as IncomingMessage;
      const res = new MockServerResponse();

      await new Promise<void>((resolve, reject) => {
        server.server.once("error", reject);
        server.server.emit("request", req, res);
        res.once("finish", () => {
          server.server.removeListener("error", reject);
          resolve();
        });
      });

      return res.toResponse();
    },
    async close(): Promise<void> {
      if (server.server.listening) {
        await server.close();
      }
    }
  };
}

export async function runFixture(instance: TestInstance, fixtureName: string): Promise<FixtureResult> {
  const filePath = path.join(instance.cwd, "fixtures", `${fixtureName}.json`);
  const raw = await fs.readFile(filePath, "utf8");
  const request = JSON.parse(raw) as FixtureRequest;
  const response = await instance.fetch(request.pathname, {
    method: request.method,
    headers: request.headers,
    body: request.body
  });

  return {
    fixtureName,
    request,
    response: await normalizeResponse(response)
  };
}

async function normalizeResponse(response: Response): Promise<NormalizedTestResponse> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });

  return {
    status: response.status,
    headers,
    body: await response.text()
  };
}

async function runAdapterFixture(adapter: AdapterLike, manifest: unknown, request: FixtureRequest): Promise<NormalizedTestResponse> {
  if (!adapter.createRequestHandler) {
    throw new Error(`Adapter "${adapter.name}" does not expose createRequestHandler.`);
  }

  const handler = adapter.createRequestHandler(manifest) as unknown;

  if (adapter.name === "node" || adapter.name === "vercel-node") {
    const req = new MockIncomingMessage({
      pathname: request.pathname,
      method: (request.method ?? "GET").toUpperCase(),
      headers: request.headers ?? { host: "localhost" },
      body: request.body
    });
    const res = new MockServerResponse();
    await new Promise<void>((resolve) => {
      (handler as (req: IncomingMessage, res: Writable & { statusCode: number }) => void)(
        req as unknown as IncomingMessage,
        res as unknown as Writable & { statusCode: number }
      );
      res.once("finish", resolve);
    });
    return normalizeResponse(await res.toResponse());
  }

  const webRequest = new Request(`http://localhost${request.pathname}`, {
    method: request.method ?? "GET",
    headers: request.headers,
    body: request.body
  });

  const webResponse = adapter.name === "cloudflare"
    ? await (handler as (req: Request, env: Record<string, unknown>, ctx: { waitUntil(promise: Promise<unknown>): void; passThroughOnException(): void }) => Promise<Response>)(
      webRequest,
      {},
      {
        waitUntil() {},
        passThroughOnException() {}
      }
    )
    : await (handler as (req: Request) => Promise<Response>)(webRequest);

  return normalizeResponse(webResponse);
}

export async function adapterParityHarness(input: {
  fixtures: Array<{ name: string; request: FixtureRequest }>;
  adapters: AdapterLike[];
  manifest: unknown;
}): Promise<{ passed: boolean; mismatches: AdapterParityMismatch[] }> {
  const mismatches: AdapterParityMismatch[] = [];

  for (const fixture of input.fixtures) {
    const outputs = await Promise.all(
      input.adapters.map(async (adapter) => ({
        adapter: adapter.name,
        response: await runAdapterFixture(adapter, input.manifest, fixture.request)
      }))
    );

    const baseline = outputs[0]?.response;
    if (!baseline) {
      continue;
    }

    const fields: Array<keyof NormalizedTestResponse> = ["status", "headers", "body"];
    for (const field of fields) {
      const values = outputs.map((output) => JSON.stringify(output.response[field]));
      const first = values[0];
      if (values.some((value) => value !== first)) {
        mismatches.push({
          fixtureName: fixture.name,
          field,
          adapterNames: outputs.map((output) => output.adapter),
          values: outputs.map((output) => output.response[field])
        });
      }
    }
  }

  return {
    passed: mismatches.length === 0,
    mismatches
  };
}
