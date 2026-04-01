/**
 * adapter-vercel-node — SourceOG Adapter for Vercel Serverless Functions (Node.js)
 *
 * Implements SourceOGAdapter for Vercel's Node.js serverless function runtime.
 * Requirements: 6.3, 6.5, 6.6, 6.7
 */

import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import type { DeploymentManifest } from "@sourceog/runtime";
import type {
  AdapterBuildArtifacts as BuildArtifacts,
  AdapterFeatureSet as RuntimeCapabilities,
  CapabilityReport,
  SourceOGAdapter,
  SourceOGConfig
} from "@sourceog/platform/config";
import {
  parseCookieHeader,
  serializeCookieHeader,
  createMutableHeaders,
  createMutableCookies,
  type MutableCookiesWithPending,
  type AdapterSourceOGRequest,
  type AdapterSourceOGResponse,
  type CookieOptions,
  type GeoData,
} from "@sourceog/adapter-utils";

// Re-export shared types for consumers of this adapter
export type {
  ReadonlyHeaders,
  ReadonlyCookies,
  MutableHeaders,
  MutableCookies,
  CookieOptions,
  GeoData,
  AdapterSourceOGRequest,
  AdapterSourceOGResponse,
} from "@sourceog/adapter-utils";

// ---------------------------------------------------------------------------
// Vercel-specific types
// ---------------------------------------------------------------------------

export interface VercelRequest extends IncomingMessage {
  query: Record<string, string | string[]>;
  cookies: Record<string, string>;
  body: unknown;
}

export interface VercelResponse extends ServerResponse {
  json(body: unknown): VercelResponse;
  send(body: unknown): VercelResponse;
  status(statusCode: number): VercelResponse;
}

export type VercelRequestHandler = (req: VercelRequest, res: VercelResponse) => void | Promise<void>;

const VERCEL_NODE_SUPPORTED_FEATURES = new Set([
  "streaming", "cookies", "headers", "filesystem", "crypto", "isr",
  "middleware", "i18n", "rate-limiting", "jwt", "validation",
]);

const VERCEL_NODE_UNSUPPORTED_FEATURES = new Set(["edge-runtime"]);

function resolveDeployRoot(config: SourceOGConfig, adapterName: string): string {
  const c = config as SourceOGConfig & { distRoot?: string; distDir?: string; cwd?: string };
  const base = c.distRoot ?? path.resolve(c.cwd ?? process.cwd(), c.distDir ?? ".sourceog");
  return path.join(base, "deploy", adapterName);
}

async function copyDeploymentManifests(
  manifestPaths: Record<string, string> | undefined,
  deployRoot: string
): Promise<void> {
  if (!manifestPaths) return;
  const manifestsRoot = path.join(deployRoot, "manifests");
  await fs.mkdir(manifestsRoot, { recursive: true });
  for (const [name, filePath] of Object.entries(manifestPaths)) {
    await fs.copyFile(filePath, path.join(manifestsRoot, `${name}.json`));
  }
}

function extractVercelGeoData(headers: Record<string, string | string[] | undefined>): GeoData | undefined {
  const get = (key: string): string | undefined => {
    const val = headers[key];
    return Array.isArray(val) ? val[0] : val;
  };
  const geo: GeoData = {};
  const country = get("x-vercel-ip-country");
  const region = get("x-vercel-ip-region");
  const city = get("x-vercel-ip-city");
  const latStr = get("x-vercel-ip-latitude");
  const lonStr = get("x-vercel-ip-longitude");
  if (country) geo.country = country;
  if (region) geo.region = region;
  if (city) geo.city = city;
  if (latStr) geo.latitude = parseFloat(latStr);
  if (lonStr) geo.longitude = parseFloat(lonStr);
  return Object.keys(geo).length > 0 ? geo : undefined;
}

function nodeIncomingMessageToReadableStream(req: IncomingMessage): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      req.on("data", (chunk: Buffer | string) => {
        controller.enqueue(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
      });
      req.on("end", () => controller.close());
      req.on("error", (err) => controller.error(err));
    },
    cancel() { req.destroy(); },
  });
}

function normalizeVercelRequest(req: VercelRequest): AdapterSourceOGRequest {
  const host = req.headers.host ?? "localhost";
  const url = new URL(req.url ?? "/", `https://${host}`);
  const headers = createMutableHeaders(req.headers as Record<string, string | string[] | undefined>);

  let cookieMap: Map<string, string>;
  if (req.cookies && typeof req.cookies === "object") {
    cookieMap = new Map(Object.entries(req.cookies));
  } else {
    const cookieHeader = req.headers["cookie"];
    cookieMap = parseCookieHeader(Array.isArray(cookieHeader) ? cookieHeader.join("; ") : cookieHeader);
  }
  const cookies = createMutableCookies(cookieMap);

  const forwardedFor = req.headers["x-forwarded-for"];
  const ip =
    (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor?.split(",")[0]?.trim()) ??
    req.socket?.remoteAddress ?? undefined;

  const geo = extractVercelGeoData(req.headers as Record<string, string | string[] | undefined>);
  const method = (req.method ?? "GET").toUpperCase();
  const hasBody = !["GET", "HEAD", "OPTIONS"].includes(method);

  return {
    method, url, headers, cookies, ip, geo,
    body: hasBody ? nodeIncomingMessageToReadableStream(req) : null,
    requestId: randomUUID(),
    traceId: randomUUID(),
  };
}

async function writeSourceOGResponse(sourceogRes: AdapterSourceOGResponse, res: VercelResponse): Promise<void> {
  res.statusCode = sourceogRes.status;
  if (typeof sourceogRes.body === "string" && !sourceogRes.headers.has("content-type")) {
    sourceogRes.headers.set("content-type", "text/plain;charset=UTF-8");
  }
  sourceogRes.headers.forEach((value: string, name: string) => res.setHeader(name, value));
  const cookiesWithPending = sourceogRes.cookies as MutableCookiesWithPending;
  if (cookiesWithPending._pending?.length) {
    res.setHeader(
      "set-cookie",
      cookiesWithPending._pending.map(({ name, value, options }: { name: string; value: string; options?: CookieOptions }) =>
        serializeCookieHeader(name, value, options as CookieOptions)
      )
    );
  }
  const { body } = sourceogRes;
  if (body === null) { res.end(); return; }
  if (typeof body === "string") { res.end(body); return; }
  const nodeReadable = Readable.fromWeb(body as import("stream/web").ReadableStream);
  await new Promise<void>((resolve, reject) => {
    nodeReadable.pipe(res);
    nodeReadable.on("end", resolve);
    nodeReadable.on("error", reject);
  });
}

function createDefaultHandler(manifest: DeploymentManifest): (req: AdapterSourceOGRequest) => Promise<AdapterSourceOGResponse> {
  return async (req) => {
    const headers = createMutableHeaders();
    const cookies = createMutableCookies(new Map());
    const matchedRoute = manifest.routes.find((r: { pathname: string }) => {
      try {
        return new RegExp(`^${r.pathname.replace(/\[([^\]]+)\]/g, "[^/]+")}$`).test(req.url.pathname);
      } catch { return r.pathname === req.url.pathname; }
    });
    if (!matchedRoute) return { status: 404, headers, cookies, body: "Not Found" };
    return { status: 200, headers, cookies, body: null };
  };
}

class VercelNodeAdapter implements SourceOGAdapter {
  public readonly name = "vercel-node";

  checkCapabilities(features: RuntimeCapabilities): CapabilityReport {
    const supported: string[] = [], unsupported: string[] = [], warnings: string[] = [];
    for (const feature of features.features) {
      if (VERCEL_NODE_UNSUPPORTED_FEATURES.has(feature)) unsupported.push(feature);
      else if (VERCEL_NODE_SUPPORTED_FEATURES.has(feature)) supported.push(feature);
      else { warnings.push(`Unknown feature: ${feature}`); supported.push(feature); }
    }
    return { supported, unsupported, warnings };
  }

  async deploy(manifest: DeploymentManifest, artifacts: BuildArtifacts, config: SourceOGConfig): Promise<void> {
    const deployRoot = resolveDeployRoot(config, this.name);
    await fs.mkdir(deployRoot, { recursive: true });
    await copyDeploymentManifests(artifacts.manifestPaths, deployRoot);
    await fs.writeFile(path.join(deployRoot, "deployment-manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
    const vercelConfig = {
      version: 2,
      builds: [{ src: "api/**/*.ts", use: "@vercel/node" }],
      routes: manifest.routes.map((r) => ({ src: r.pathname, dest: `/api/index` })),
    };
    await fs.writeFile(path.join(deployRoot, "vercel.json"), JSON.stringify(vercelConfig, null, 2), "utf8");
    await fs.writeFile(
      path.join(deployRoot, "entrypoint.mjs"),
      [`export const runtime = "nodejs";`, `export const buildId = ${JSON.stringify(artifacts.buildId)};`, `export const deploymentManifestPath = "./deployment-manifest.json";`].join("\n"),
      "utf8"
    );
  }

  createRequestHandler(manifest: DeploymentManifest): VercelRequestHandler {
    const defaultHandler = createDefaultHandler(manifest);
    return (req: VercelRequest, res: VercelResponse): void => {
      const sourceogReq = normalizeVercelRequest(req);
      void defaultHandler(sourceogReq)
        .then((sourceogRes) => writeSourceOGResponse(sourceogRes, res))
        .catch((err: unknown) => {
          if (!res.headersSent) { res.statusCode = 500; res.end("Internal Server Error"); }
          console.error("[adapter-vercel-node] Unhandled error:", err);
        });
    };
  }
}

export const vercelNodeAdapter: SourceOGAdapter = new VercelNodeAdapter();
export function createVercelNodeAdapter(): SourceOGAdapter { return new VercelNodeAdapter(); }
export default vercelNodeAdapter;
