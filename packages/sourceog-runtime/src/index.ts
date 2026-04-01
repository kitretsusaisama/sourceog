// =============================================================================
// @sourceog/runtime
// Core types, error classes, response primitives, and runtime utilities.
// Referenced by: render.tsx, rsc.ts, rsc-worker.ts, rsc-worker-bootstrap.mjs
// =============================================================================

export { ISRCoordinator } from "./isr-coordinator.js";
export type { Lock, ISRCoordinatorOptions, ISRCachePolicy, ISRCacheEntry } from "./isr-coordinator.js";
export {ClientIsland, CompilerError} from './client-island.js';
export { DataCache } from "./data-cache.js";
export type { DataCacheKey, DataCacheEntry, DataCacheBackend, DataCacheOptions } from "./data-cache.js";
export { DataFilesystemCacheStore, FilesystemCacheStore } from "./filesystem-cache-store.js";
export type { ClientReferenceManifestRegistryEntry } from "./contracts.js"
// Deployment manifest types (from contracts)
export type {
  DeploymentManifest,
  DeploymentManifestRoute,
  StabilityLevel,
  DiagnosticIssue,
  DiagnosticsEnvelope,
  RenderManifest,
  RenderManifestEntry,
  BundleManifest,
  AssetManifest,
  AssetManifestEntry,
  PrerenderManifest,
  PrerenderManifestEntry,
  CacheManifest,
  CacheManifestEntry,
  ClientReferenceManifestEntry,
  ServerReferenceManifest,
  ServerReferenceManifestEntry,
  ActionManifest,
  ActionManifestEntry,
  AdapterManifest,
  RouteOwnershipManifest,
  RouteOwnershipManifestEntry,
  RouteGraphManifest,
  RouteGraphNode,
  RouteGraphRouteEntry,
  RuntimeCapabilityIssue,
} from "./contracts.js";
export { createDiagnosticsEnvelope, SOURCEOG_MANIFEST_VERSION as CONTRACTS_MANIFEST_VERSION } from "./contracts.js";
export type { BudgetReport, BudgetViolation } from "./contracts.js";

// ---------------------------------------------------------------------------
// Runtime name
// ---------------------------------------------------------------------------

export type SourceOGRuntimeName =
  | "node"
  | "edge"
  | "vercel-node"
  | "vercel-edge"
  | "cloudflare"
  | "deno";

// ---------------------------------------------------------------------------
// Request / context types
// ---------------------------------------------------------------------------

export interface SourceOGRequest {
  url: URL;
  method: string;
  headers: Headers;
  cookies: Map<string, string>;
  requestId: string;
  runtime: SourceOGRuntimeName;
  bodyText(): Promise<string>;
  bodyJson<T>(): Promise<T>;
}

export interface SourceOGRequestContext {
  request: SourceOGRequest;
  params: Record<string, string | string[]>;
  query: URLSearchParams;
  locale?: string;
}

// ---------------------------------------------------------------------------
// Render mode
// ---------------------------------------------------------------------------

export type RouteRenderMode = "server-components" | "client-root";

// ---------------------------------------------------------------------------
// Flight / RSC payload types
// ---------------------------------------------------------------------------

export type RscPayloadFormat = "none" | "react-flight-text";

export interface ClientBoundaryDescriptor {
  boundaryId: string;
  routeId: string;
  assetHref?: string;
}

export interface ClientReferenceRef {
  id: string;
  name: string;
  chunks?: string[];
  async?: boolean;
}

export interface ClientReferenceManifest {
  registry: Record<
    string,
    {
      id?: string;
      chunks?: string[];
      name?: string;
      async?: boolean;
      filepath?: string;
    }
  >;
}

export interface FlightManifestRefs {
  runtimeHref?: string;
  routeAssetHref?: string;
  metadataHref?: string;
  entryAssetHref?: string;
  sharedChunkHrefs: string[];
  boundaryAssetHrefs: string[];
  actionIds: string[];
}

export interface FlightRenderSegment {
  kind: "page" | "layout" | "template" | "parallel-page";
  routeId: string;
  filePath: string;
  pathname: string;
  segmentKey: string;
  slotName?: string;
}

export interface FlightRenderTreeNode {
  id: string;
  kind: "root" | "layout" | "template" | "page" | "parallel-slot" | "parallel-page";
  routeId: string;
  pathname: string;
  filePath?: string;
  segmentKey: string;
  slotName?: string;
  boundaryIds: string[];
  children: FlightRenderTreeNode[];
}

// ---------------------------------------------------------------------------
// Route render identity
// ---------------------------------------------------------------------------

export interface RouteRenderIdentity {
  canonicalRouteId?: string;
  resolvedRouteId?: string;
  renderContextKey?: string;
  renderContext?: "canonical" | "intercepted";
  intercepted?: boolean;
  parallelRouteMap?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Action entries
// ---------------------------------------------------------------------------

export interface ActionEntry {
  actionId: string;
  exportName: string;
  runtime: "node" | "edge";
  refreshPolicy: "none" | "refresh-current-route-on-revalidate";
  revalidationPolicy: "none" | "track-runtime-revalidation";
}

// ---------------------------------------------------------------------------
// Canonical render result — the single source of truth for a rendered route
// ---------------------------------------------------------------------------

export interface CanonicalRenderResult {
  routeId?: string;
  pathname: string;
  canonicalRouteId: string;
  resolvedRouteId: string;
  renderContextKey: string;
  renderContext: "canonical" | "intercepted";
  intercepted: boolean;
  parallelRouteMap: Record<string, string>;
  renderMode: RouteRenderMode;
  headHtml: string;
  shellHtmlStart: string;
  shellHtmlEnd: string;
  shellMode: "document" | "fragment";
  bodyHtml: string;
  rscPayloadFormat: RscPayloadFormat;
  rscPayloadChunks: string[];
  renderedSegments: FlightRenderSegment[];
  serverTree: FlightRenderTreeNode;
  boundaryRefs: ClientBoundaryDescriptor[];
  clientReferenceRefs: ClientReferenceRef[];
  flightManifestRefs: FlightManifestRefs;
  actionEntries: ActionEntry[];
}

// ---------------------------------------------------------------------------
// Client route snapshot — serialized to window.__SOURCEOG_INITIAL_RENDER_SNAPSHOT__
// ---------------------------------------------------------------------------

export interface ClientRouteSnapshot extends CanonicalRenderResult {
  version: number;
  hydrationMode: "none" | "full-route" | "mixed-route";
  runtimeHref?: string;
  routeAssetHref?: string;
  metadataHref?: string;
  entryAssetHref?: string;
  clientReferenceManifestUrl?: string;
  flightHref?: string;
  sharedChunkHrefs: string[];
  preloadHrefs: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const SOURCEOG_MANIFEST_VERSION = 1 as const;

export const SOURCEOG_ERROR_CODES = {
  RENDER_FAILED: "RENDER_FAILED",
  NOT_FOUND: "NOT_FOUND",
  REDIRECT: "REDIRECT",
  MANIFEST_MISSING: "MANIFEST_MISSING",
  MANIFEST_PATH_TRAVERSAL: "MANIFEST_PATH_TRAVERSAL",
  WORKER_TIMEOUT: "WORKER_TIMEOUT",
  WORKER_FAILURE: "WORKER_FAILURE",
  QUEUE_FULL: "QUEUE_FULL",
  INVALID_ROUTE: "INVALID_ROUTE",
  EDGE_CAPABILITY_VIOLATION: "EDGE_CAPABILITY_VIOLATION",
  // Compiler / build error codes
  CONFIG_INVALID: "SOURCEOG_CONFIG_INVALID",
  MANIFEST_INVALID: "SOURCEOG_MANIFEST_INVALID",
  ROUTE_NOT_FOUND: "SOURCEOG_ROUTE_NOT_FOUND",
  ROUTE_CONFLICT: "SOURCEOG_ROUTE_CONFLICT",
  METHOD_NOT_ALLOWED: "SOURCEOG_METHOD_NOT_ALLOWED",
  RUNTIME_INCOMPATIBLE: "SOURCEOG_RUNTIME_INCOMPATIBLE",
  ADAPTER_CAPABILITY_MISSING: "SOURCEOG_ADAPTER_CAPABILITY_MISSING",
  ADAPTER_PARITY_FAILED: "SOURCEOG_ADAPTER_PARITY_FAILED",
  BUNDLE_BUDGET_EXCEEDED: "SOURCEOG_BUNDLE_BUDGET_EXCEEDED",
  MODULE_BOUNDARY_VIOLATION: "SOURCEOG_MODULE_BOUNDARY_VIOLATION",
  ACTION_NOT_FOUND: "SOURCEOG_ACTION_NOT_FOUND",
  ACTION_EXECUTION_FAILED: "SOURCEOG_ACTION_EXECUTION_FAILED",
  REDIRECT_INTERRUPT: "SOURCEOG_REDIRECT_INTERRUPT",
  NOT_FOUND_INTERRUPT: "SOURCEOG_NOT_FOUND_INTERRUPT",
  SECURITY_POLICY_VIOLATION: "SOURCEOG_SECURITY_POLICY_VIOLATION",
  AUTOMATION_INVALID: "SOURCEOG_AUTOMATION_INVALID",
} as const;

export type SourceOGErrorCode = (typeof SOURCEOG_ERROR_CODES)[keyof typeof SOURCEOG_ERROR_CODES];

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class SourceOGError extends Error {
  public readonly code: SourceOGErrorCode | string;
  public readonly details?: Record<string, unknown>;

  constructor(code: SourceOGErrorCode | string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.details = details;
    this.name = "SourceOGError";
    // Maintain proper prototype chain in transpiled ES5
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ---------------------------------------------------------------------------
// Interrupt system (used for redirect / not-found in render pipeline)
// ---------------------------------------------------------------------------

const INTERRUPT_BRAND = "__sourceog_interrupt__" as const;

interface NotFoundInterrupt {
  [INTERRUPT_BRAND]: "not-found";
}

interface RedirectInterrupt {
  [INTERRUPT_BRAND]: "redirect";
  location: string;
  status: 301 | 302 | 307 | 308;
}

type SourceOGInterrupt = NotFoundInterrupt | RedirectInterrupt;

function isInterrupt(value: unknown): value is SourceOGInterrupt {
  return (
    typeof value === "object" &&
    value !== null &&
    INTERRUPT_BRAND in (value as object)
  );
}

export function isNotFoundInterrupt(value: unknown): value is NotFoundInterrupt {
  return isInterrupt(value) && (value as NotFoundInterrupt)[INTERRUPT_BRAND] === "not-found";
}

export function isRedirectInterrupt(value: unknown): value is RedirectInterrupt {
  if (isInterrupt(value) && (value as RedirectInterrupt)[INTERRUPT_BRAND] === "redirect") return true;
  // Also handle class-based RedirectInterrupt from render-control.ts
  if (value instanceof Error && (value as Error & { location?: string }).location !== undefined && (value as Error & { code?: string }).code === "SOURCEOG_REDIRECT_INTERRUPT") return true;
  return false;
}

export function redirect(
  location: string,
  status: 301 | 302 | 307 | 308 = 302
): never {
  throw { [INTERRUPT_BRAND]: "redirect", location, status } satisfies RedirectInterrupt;
}

/**
 * Throw a not-found interrupt. Caught by renderRouteToResponse to render the
 * closest not-found.tsx boundary.
 */
export function notFound(): never {
  throw { [INTERRUPT_BRAND]: "not-found" } satisfies NotFoundInterrupt;
}

// ---------------------------------------------------------------------------
// SourceOGResponse — wraps Node Readable, Web ReadableStream, or string body
// ---------------------------------------------------------------------------

export type SourceOGResponseBody =
  | string
  | NodeJS.ReadableStream
  | ReadableStream<Uint8Array>
  | null;

export interface SourceOGResponseInit {
  status?: number;
  headers?: Record<string, string>;
}

export class SourceOGResponse {
  public readonly body: SourceOGResponseBody;
  public readonly status: number;
  public readonly headers: Headers;

  constructor(body: SourceOGResponseBody, init: SourceOGResponseInit = {}) {
    this.body = body;
    this.status = init.status ?? 200;
    this.headers = new Headers(init.headers ?? {});
  }

  /**
   * Convert to a standard Web API Response.
   * Handles Node.js Readable streams (PassThrough etc.) transparently.
   */
  toWebResponse(): Response {
    const init: ResponseInit = {
      status: this.status,
      headers: this.headers,
    };

    if (this.body === null) {
      return new Response(null, init);
    }

    if (typeof this.body === "string") {
      return new Response(this.body, init);
    }

    // Web ReadableStream — pass through directly
    if (this.body instanceof ReadableStream) {
      return new Response(this.body as ReadableStream<Uint8Array>, init);
    }

    // Node.js Readable (PassThrough, etc.) — wrap in ReadableStream
    const nodeStream = this.body as NodeJS.ReadableStream;
    const webStream = new ReadableStream<Uint8Array>({
      start(controller) {
        nodeStream.on("data", (chunk: Buffer | string) => {
          controller.enqueue(
            typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk
          );
        });
        nodeStream.on("end", () => controller.close());
        nodeStream.on("error", (err: Error) => controller.error(err));
      },
      cancel() {
        if (typeof (nodeStream as NodeJS.ReadableStream & { destroy?: (e?: Error) => void }).destroy === "function") {
          (nodeStream as NodeJS.ReadableStream & { destroy: () => void }).destroy();
        }
      }
    });

    return new Response(webStream, init);
  }
}

// ---------------------------------------------------------------------------
// Response factory helpers
// ---------------------------------------------------------------------------

export function html(
  content: string,
  init: SourceOGResponseInit = {}
): SourceOGResponse {
  return new SourceOGResponse(content, {
    status: init.status ?? 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      ...init.headers,
    },
  });
}

export function json<T>(
  data: T,
  init: SourceOGResponseInit = {}
): SourceOGResponse {
  return new SourceOGResponse(JSON.stringify(data), {
    status: init.status ?? 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...init.headers,
    },
  });
}

export function text(
  content: string,
  init: SourceOGResponseInit = {}
): SourceOGResponse {
  return new SourceOGResponse(content, {
    status: init.status ?? 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      ...init.headers,
    },
  });
}

// ---------------------------------------------------------------------------
// Config layer (FrameworkError, loadConfig, deepMerge, deepFreeze, etc.)
// ---------------------------------------------------------------------------
export {
  FrameworkError,
  loadConfig,
  defineConfig,
  deepMerge,
  deepFreeze,
} from "./config.js";
export type {
  FrameworkErrorCode,
  FrameworkLayer,
  SourceOGConfig,
  SourceOGConfig as FrameworkSourceOGConfig,
  SourceOGPlugin,
  SourceOGPreset,
  EnvSchema,
  I18nConfig as FrameworkI18nConfig,
  ImageConfig as FrameworkImageConfig,
  ExperimentalConfig,
} from "./config.js";

// ---------------------------------------------------------------------------
// Revalidation helpers
// ---------------------------------------------------------------------------
export {
  setRevalidationHandler,
  revalidatePath,
  revalidateTag,
  cacheTag,
  cacheTTL,
  prerenderPolicy,
  withRevalidationTracking,
  applyRuntimeCacheInvalidation,
  mergeRevalidationTrackingSummary,
} from "./revalidate.js";
export type {
  RevalidationHandler,
  RevalidationTrackingSummary,
} from "./revalidate.js";

// ---------------------------------------------------------------------------
// Render control (redirectTo, notFound via interrupt classes)
// ---------------------------------------------------------------------------
export { redirectTo, RedirectInterrupt, NotFoundInterrupt } from "./render-control.js";

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------
export { createLogger } from "./logger.js";
export type { SourceOGLogger, LogRecord } from "./logger.js";

// ---------------------------------------------------------------------------
// Request context
// ---------------------------------------------------------------------------
export { runWithRequestContext, getRequestContext, requireRequestContext } from "./context.js";

// ---------------------------------------------------------------------------
// Fetch memoization
// ---------------------------------------------------------------------------
export { sourceogFetch, getRequestMemoizationEntryCount, clearRequestMemo, clearRequestMemoByTags } from "./fetch.js";
export type { SourceOGFetchOptions } from "./fetch.js";

// ---------------------------------------------------------------------------
// Cache utilities
// ---------------------------------------------------------------------------
export { unstable_cache, resolveCacheInvalidation, applyResolvedCacheInvalidation } from "./cache.js";
export type { ResolvedCacheInvalidation, RouteCacheEntry, RouteCachePolicy, RouteCacheStore, CacheEntry, CachePolicy, CacheStore } from "./cache.js";

export { loadEnv, getEnvCandidates } from "./env.js";
export type { LoadedEnvFile, LoadEnvResult } from "./env.js";

// ---------------------------------------------------------------------------
// Node.js request/response adapters
// ---------------------------------------------------------------------------
export { createNodeRequest, sendNodeResponse } from "./request.js";
