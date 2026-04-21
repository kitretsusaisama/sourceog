/**
 * adapter-cloudflare — SourceOG Adapter for Cloudflare Workers
 *
 * Implements SourceOGAdapter for the Cloudflare Workers runtime.
 * Uses Web APIs only (no Node.js built-ins) in the request handler.
 * Requirements: 6.2, 6.5, 6.6, 6.7
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

// ---------------------------------------------------------------------------
// Cloudflare Workers types
// ---------------------------------------------------------------------------

export interface Env { [key: string]: unknown; }

export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

export type CloudflareRequestHandler = (
  req: Request,
  env: Env,
  ctx: ExecutionContext
) => Promise<Response>;

interface CloudflareIncomingCfProperties {
  country?: string;
  region?: string;
  city?: string;
  latitude?: string;
  longitude?: string;
  [key: string]: unknown;
}

interface CloudflareRequest extends Request {
  cf?: CloudflareIncomingCfProperties;
}

// ---------------------------------------------------------------------------
// Features
// ---------------------------------------------------------------------------

const CF_SUPPORTED_FEATURES = new Set([
  "streaming", "cookies", "headers", "crypto", "middleware",
  "edge-runtime", "i18n", "rate-limiting", "jwt", "validation",
]);

const CF_UNSUPPORTED_FEATURES = new Set(["filesystem", "isr"]);

/**
 * Resolves the deployment root directory for a given adapter based on the provided configuration.
 *
 * @param config - The source configuration containing optional distRoot, distDir, and cwd properties.
 * @param adapterName - The name of the adapter for which to resolve the deploy directory.
 * @returns The absolute path to the deploy directory for the adapter.
 */
function resolveDeployRoot(config: SourceOGConfig, adapterName: string): string {
  const c = config as SourceOGConfig & { distRoot?: string; distDir?: string; cwd?: string };
  const base = c.distRoot ?? path.resolve(c.cwd ?? process.cwd(), c.distDir ?? ".sourceog");
  return path.join(base, "deploy", adapterName);
}

/**
 * Copies deployment manifest files to the specified deployment root directory.
 *
 * @param manifestPaths - An object mapping manifest names to their file paths. If undefined, the function returns without performing any actions.
 * @param deployRoot - The root directory where manifest files will be copied under the "manifests" subdirectory.
 * @returns A promise that resolves when all manifest files have been copied.
 */
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

/**
 * Extracts geographic data from Cloudflare properties.
 *
 * @param cf - The Cloudflare incoming CF properties object or undefined.
 * @returns A GeoData object containing any available country, region, city, latitude, and longitude; otherwise undefined.
 */
function extractGeoData(cf: CloudflareIncomingCfProperties | undefined): GeoData | undefined {
  if (!cf) return undefined;
  const geo: GeoData = {};
  if (cf.country) geo.country = cf.country;
  if (cf.region) geo.region = cf.region;
  if (cf.city) geo.city = cf.city;
  if (cf.latitude) geo.latitude = parseFloat(cf.latitude);
  if (cf.longitude) geo.longitude = parseFloat(cf.longitude);
  return Object.keys(geo).length > 0 ? geo : undefined;
}

/**
 * Normalizes a Cloudflare request into the adapter's request format.
 *
 * @param req - The incoming CloudflareRequest to normalize.
 * @returns AdapterSourceOGRequest - The normalized request suitable for the adapter.
 */
function normalizeCloudflareRequest(req: CloudflareRequest): AdapterSourceOGRequest {
  const url = new URL(req.url);
  const headers = createMutableHeaders(req.headers);
  const cookieMap = parseCookieHeader(req.headers.get("cookie"));
  const cookies = createMutableCookies(cookieMap);
  const ip =
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    undefined;
  const geo = extractGeoData(req.cf);
  const method = req.method.toUpperCase();
  const hasBody = !["GET", "HEAD", "OPTIONS"].includes(method);
  return {
    method, url, headers, cookies, ip, geo,
    body: hasBody ? (req.body as ReadableStream<Uint8Array> | null) : null,
    requestId: crypto.randomUUID(),
    traceId: crypto.randomUUID(),
  };
}

/**
 * Creates a default request handler based on the provided deployment manifest.
 *
 * @param manifest DeploymentManifest object containing route definitions.
 * @returns A request handler function that takes a request and returns a promise
 *          resolving to an AdapterSourceOGResponse.
 */
function createDefaultHandler(manifest: DeploymentManifest): (req: AdapterSourceOGRequest) => Promise<AdapterSourceOGResponse> {
  return async (req) => {
    const headers = createMutableHeaders();
    const cookies = createMutableCookies(new Map());
    const matchedRoute = manifest.routes.find((r: { pathname: string }) => {
      try {
        return new RegExp(`^${r.pathname.replace(/\[([^\]]+)\]/g, "[^/]+")}\$`).test(req.url.pathname);
      } catch { return r.pathname === req.url.pathname; }
    });
    if (!matchedRoute) return { status: 404, headers, cookies, body: "Not Found" };
    return { status: 200, headers, cookies, body: null };
  };
}

// ---------------------------------------------------------------------------
// CloudflareAdapter — implements SourceOGAdapter
// ---------------------------------------------------------------------------

class CloudflareAdapter implements SourceOGAdapter {
  public readonly name = "cloudflare";

  /**
   * Checks which features from the given RuntimeCapabilities are supported or unsupported.
   * @param features The runtime capabilities to check for feature support.
   * @returns A CapabilityReport object containing supported, unsupported features and warnings.
   */
  checkCapabilities(features: RuntimeCapabilities): CapabilityReport {
    const supported: string[] = [], unsupported: string[] = [], warnings: string[] = [];
    for (const feature of features.features) {
      if (CF_UNSUPPORTED_FEATURES.has(feature)) unsupported.push(feature);
      else if (CF_SUPPORTED_FEATURES.has(feature)) supported.push(feature);
      else { warnings.push(`Unknown feature: ${feature}`); supported.push(feature); }
    }
    return { supported, unsupported, warnings };
  }

  /**
   * Deploys the build artifacts and manifest to the target environment.
   *
   * @param manifest - The deployment manifest containing build details and metadata.
   * @param artifacts - The build artifacts including manifest paths and build identifiers.
   * @param config - Configuration for SourceOG deployment.
   * @returns A promise that resolves when deployment is complete.
   */
  async deploy(manifest: DeploymentManifest, artifacts: BuildArtifacts, config: SourceOGConfig): Promise<void> {
    const deployRoot = resolveDeployRoot(config, this.name);
    await fs.mkdir(deployRoot, { recursive: true });
    await copyDeploymentManifests(artifacts.manifestPaths, deployRoot);
    await fs.writeFile(path.join(deployRoot, "deployment-manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
    const wranglerToml = [
      'name = "sourceog-app"',
      'main = "./worker.mjs"',
      `compatibility_date = "${new Date().toISOString().slice(0, 10)}"`,
      '',
      '# Generated by @sourceog/adapter-cloudflare',
      `# buildId: ${manifest.buildId}`,
    ].join("\n");
    await fs.writeFile(path.join(deployRoot, "wrangler.toml"), wranglerToml, "utf8");
    await fs.writeFile(
      path.join(deployRoot, "worker.mjs"),
      [`export const buildId = ${JSON.stringify(artifacts.buildId)};`, 'export const deploymentManifestPath = "./deployment-manifest.json";', 'export const manifestsDir = "./manifests";'].join("\n"),
      "utf8"
    );
  }

  /**
   * Creates a Cloudflare request handler using the given deployment manifest.
   * @param manifest - The deployment manifest containing route and resource information.
   * @returns A CloudflareRequestHandler that handles incoming requests and returns a Response.
   */
  createRequestHandler(manifest: DeploymentManifest): CloudflareRequestHandler {
    const defaultHandler = createDefaultHandler(manifest);
    return async (req: Request, _env: Env, _ctx: ExecutionContext): Promise<Response> => {
      const sourceogReq = normalizeCloudflareRequest(req as CloudflareRequest);
      const sourceogRes = await defaultHandler(sourceogReq);
      return buildWebResponse(sourceogRes);
    };
  }
}

export const cloudflareAdapter: SourceOGAdapter = new CloudflareAdapter();
/**
 * Creates a new CloudflareAdapter instance.
 *
 * @returns {SourceOGAdapter} A new instance of CloudflareAdapter.
 */
export function createCloudflareAdapter(): SourceOGAdapter { return new CloudflareAdapter(); }
export default cloudflareAdapter;
