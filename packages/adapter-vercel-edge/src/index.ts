/**
 * adapter-vercel-edge — SourceOG Adapter for Vercel Edge Runtime
 *
 * Implements SourceOGAdapter for Vercel's Edge Runtime.
 * Uses Web APIs only (no Node.js built-ins) in the request handler.
 * Requirements: 6.4, 6.5, 6.6, 6.7
 */

import { promises as fs } from "node:fs";
import path from "node:path";
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
  createMutableHeaders,
  createMutableCookies,
  buildWebResponse,
  type AdapterSourceOGRequest,
  type AdapterSourceOGResponse,
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

export type VercelEdgeHandler = (req: Request) => Promise<Response>;

const VERCEL_EDGE_SUPPORTED_FEATURES = new Set([
  "streaming", "cookies", "headers", "crypto", "middleware",
  "edge-runtime", "i18n", "rate-limiting", "jwt", "validation",
]);

const VERCEL_EDGE_UNSUPPORTED_FEATURES = new Set(["filesystem", "isr"]);

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

function extractVercelEdgeGeoData(headers: Headers): GeoData | undefined {
  const geo: GeoData = {};
  const country = headers.get("x-vercel-ip-country");
  const region = headers.get("x-vercel-ip-region");
  const city = headers.get("x-vercel-ip-city");
  const latStr = headers.get("x-vercel-ip-latitude");
  const lonStr = headers.get("x-vercel-ip-longitude");
  if (country) geo.country = country;
  if (region) geo.region = region;
  if (city) geo.city = city;
  if (latStr) geo.latitude = parseFloat(latStr);
  if (lonStr) geo.longitude = parseFloat(lonStr);
  return Object.keys(geo).length > 0 ? geo : undefined;
}

function normalizeVercelEdgeRequest(req: Request): AdapterSourceOGRequest {
  const url = new URL(req.url);
  const headers = createMutableHeaders(req.headers);
  const cookieMap = parseCookieHeader(req.headers.get("cookie"));
  const cookies = createMutableCookies(cookieMap);
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    undefined;
  const geo = extractVercelEdgeGeoData(req.headers);
  const method = req.method.toUpperCase();
  const hasBody = !["GET", "HEAD", "OPTIONS"].includes(method);
  return {
    method, url, headers, cookies, ip, geo,
    body: hasBody ? (req.body as ReadableStream<Uint8Array> | null) : null,
    requestId: crypto.randomUUID(),
    traceId: crypto.randomUUID(),
  };
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

class VercelEdgeAdapter implements SourceOGAdapter {
  public readonly name = "vercel-edge";

  checkCapabilities(features: RuntimeCapabilities): CapabilityReport {
    const supported: string[] = [], unsupported: string[] = [], warnings: string[] = [];
    for (const feature of features.features) {
      if (VERCEL_EDGE_UNSUPPORTED_FEATURES.has(feature)) unsupported.push(feature);
      else if (VERCEL_EDGE_SUPPORTED_FEATURES.has(feature)) supported.push(feature);
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
      functions: { "api/**/*.ts": { runtime: "edge" } },
      routes: manifest.routes.map((r: { pathname: string }) => ({ src: r.pathname, dest: `/api/index` })),
    };
    await fs.writeFile(path.join(deployRoot, "vercel.json"), JSON.stringify(vercelConfig, null, 2), "utf8");
    await fs.writeFile(
      path.join(deployRoot, "entrypoint.mjs"),
      [`export const runtime = "edge";`, `export const buildId = ${JSON.stringify(artifacts.buildId)};`, `export const deploymentManifestPath = "./deployment-manifest.json";`].join("\n"),
      "utf8"
    );
  }

  createRequestHandler(manifest: DeploymentManifest): VercelEdgeHandler {
    const defaultHandler = createDefaultHandler(manifest);
    return async (req: Request): Promise<Response> => {
      const sourceogReq = normalizeVercelEdgeRequest(req);
      const sourceogRes = await defaultHandler(sourceogReq);
      return buildWebResponse(sourceogRes);
    };
  }
}

export const vercelEdgeAdapter: SourceOGAdapter = new VercelEdgeAdapter();
export function createVercelEdgeAdapter(): SourceOGAdapter { return new VercelEdgeAdapter(); }
export default vercelEdgeAdapter;
