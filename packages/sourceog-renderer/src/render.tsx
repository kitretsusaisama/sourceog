// sourceog-renderer/src/render.tsx — Alibaba CTO 2027 Standard Aligned
import { pathToFileURL, fileURLToPath } from "node:url";
import { PassThrough, Readable, Transform } from "node:stream";
import { createRequire } from "node:module";
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import path from "node:path";
import React from "react";
import { renderToPipeableStream, renderToStaticMarkup } from "react-dom/server";
import type { Metadata } from "@sourceog/platform";
import { mergeMetadata, renderMetadataToHead } from "@sourceog/platform";
import {
  type CanonicalRenderResult,
  type ClientRouteSnapshot,
  type ClientBoundaryDescriptor,
  type ClientReferenceManifest,
  type ClientReferenceRef,
  type FlightManifestRefs,
  type FlightRenderSegment,
  type FlightRenderTreeNode,
  type RouteRenderIdentity,
  type RouteRenderMode,
  isNotFoundInterrupt,
  isRedirectInterrupt,
  redirect,
  SourceOGError,
  SourceOGResponse,
  html,
  SOURCEOG_ERROR_CODES,
  SOURCEOG_MANIFEST_VERSION
} from "@sourceog/runtime";
import type { RouteDefinition } from "@sourceog/router";
import type { SourceOGRequestContext } from "@sourceog/runtime";
import { renderRouteToOfficialRscPayload } from "./rsc.js";

const require = createRequire(import.meta.url);
const TRANSFORM_TEMP_DIR = mkdtempSync(path.join(tmpdir(), "sourceog-main-transform-"));

// ---------------------------------------------------------------------------
// UTAL: Zero-Config Inline Transform Fallback (Main Thread)
// ---------------------------------------------------------------------------
// render.tsx loads modules directly (errors, not-found, parallel routes) 
// OUTSIDE the worker pool. This fallback ensures they never crash on .tsx.

let _esbuildTransform: ((code: string, filepath: string) => Promise<string>) | null = null;
let _sucraseTransform: ((code: string, filepath: string) => Promise<string>) | null = null;

async function ensureMainThreadTransformers() {
  if (_esbuildTransform || _sucraseTransform) return;

  try {
    const esbuild = await import("esbuild");
    _esbuildTransform = (code, filepath) => 
      esbuild.transform(code, {
        loader: filepath.endsWith(".tsx") ? "tsx" : filepath.endsWith(".jsx") ? "jsx" : "ts",
        jsx: "automatic",
        jsxImportSource: "react",
        target: "es2022",
        format: "esm",
      }).then(r => r.code);
    return;
  } catch { /* esbuild not installed */ }

  try {
    // @ts-expect-error - sucrase is an optional dependency
    const sucrase = await import("sucrase") as {
      transform: (code: string, options: {
        transforms: string[];
        jsxRuntime: string;
        production: boolean;
        filePath: string;
      }) => { code: string };
    };
    _sucraseTransform = (code, filepath) => 
      Promise.resolve(sucrase.transform(code, {
        transforms: ["typescript", "jsx"],
        jsxRuntime: "automatic",
        production: process.env.NODE_ENV === "production",
        filePath: filepath,
      }).code);
    return;
  } catch { /* sucrase not installed */ }
}

/**
 * Resilient import that catches "Unknown file extension" and falls back to 
 * inline esbuild/sucrase -> temp file import. Zero config required.
 * 
 * FIX: Added generic <T> to function signature to resolve "Generic type 'Promise<T>' requires 1 type argument(s)" errors.
 */
async function resilientImport<T = unknown>(specifier: string): Promise<T> {
  try {
    return await import(specifier) as T;
  } catch (error) {
    if (String(error).includes("Unknown file extension")) {
      const fsPath = specifier.startsWith("file://") ? fileURLToPath(specifier) : specifier;
      const ext = path.extname(fsPath);
      
      if (ext === ".tsx" || ext === ".ts" || ext === ".jsx") {
        await ensureMainThreadTransformers();
        const transformFn = _esbuildTransform ?? _sucraseTransform;
        
        if (!transformFn) {
          throw new Error(
            `[SOURCEOG] Cannot load "${fsPath}". Unknown file extension and no inline transpiler (esbuild/sucrase) available.`
          );
        }

        const source = readFileSync(fsPath, "utf8");
        const code = await transformFn(source, fsPath);
        
        // FIX: data:text/javascript URLs fail on relative imports. 
        // Write to a temp .mjs file in OS tmpdir.
        const hash = createHash("sha256").update(fsPath).digest("hex").slice(0, 8);
        const tmpFile = path.join(TRANSFORM_TEMP_DIR, `${path.basename(fsPath, ext)}-${hash}.mjs`);
        
        if (!existsSync(tmpFile)) {
          writeFileSync(tmpFile, code, "utf8");
        }
        
        return import(pathToFileURL(tmpFile).href) as Promise<T>;
      }
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Types & Interfaces
// ---------------------------------------------------------------------------

interface RouteModule {
  default?: React.ComponentType<any>;
  metadata?: Metadata;
  generateMetadata?: (context: SourceOGRequestContext) => Promise<Metadata> | Metadata;
  renderTimeoutMs?: number;
}

interface LayoutModule {
  metadata?: Metadata;
  generateMetadata?: (context: SourceOGRequestContext) => Promise<Metadata> | Metadata;
  default: React.ComponentType<{
    children: React.ReactNode;
    params: SourceOGRequestContext["params"];
    query: SourceOGRequestContext["query"];
  }>;
}

export interface RenderedPage {
  routeId?: string;
  metadata: Metadata;
  bodyHtml: string;
  shellMode: "document" | "fragment";
  renderedSegments: FlightRenderSegment[];
  serverTree: FlightRenderTreeNode;
}

export type RouteFlightPayload = ClientRouteSnapshot;

export interface DocumentClientAssets {
  runtimeHref: string;
  routeAssetHref?: string;
  metadataHref?: string;
  entryAssetHref?: string;
  clientReferenceManifestUrl?: string;
  flightHref?: string;
  sharedChunkHrefs?: string[];
  preloadHrefs?: string[];
  renderMode?: RouteRenderMode;
  hydrationMode?: "none" | "full-route" | "mixed-route";
  boundaryRefs?: ClientBoundaryDescriptor[];
  clientReferenceRefs?: ClientReferenceRef[];
  actionEntries?: Array<{
    actionId: string;
    exportName: string;
    runtime: "node" | "edge";
    refreshPolicy: "none" | "refresh-current-route-on-revalidate";
    revalidationPolicy: "none" | "track-runtime-revalidation";
  }>;
}

interface PreparedRouteRender {
  metadata: Metadata;
  element: React.JSX.Element;
  renderTimeoutMs: number;
  canonicalResult: CanonicalRenderResult;
}

interface ClientReferenceManifestOverride {
  clientReferenceManifest?: ClientReferenceManifest;
  clientReferenceDistRoot?: string;
}

interface RouteRenderOptions extends ClientReferenceManifestOverride {
  pathname?: string;
  clientAssets?: DocumentClientAssets;
  routeIdentity?: RouteRenderIdentityInput;
  parallelRoutes?: Record<string, RouteDefinition>;
}

export interface FlightHtmlRenderResult {
  bodyHtml: string;
  shellMode: "document" | "fragment";
}

interface RouteRenderIdentityInput {
  canonicalRouteId?: string;
  resolvedRouteId?: string;
  renderContextKey?: string;
  renderContext?: "canonical" | "intercepted";
  intercepted?: boolean;
  parallelRouteMap?: Record<string, string>;
}

interface ClientContextSnapshot {
  routeId?: string;
  pathname: string;
  canonicalRouteId: string;
  resolvedRouteId: string;
  renderContextKey: string;
  renderContext: "canonical" | "intercepted";
  intercepted: boolean;
  parallelRouteMap: Record<string, string>;
  hydrationMode: "none" | "full-route" | "mixed-route";
  renderMode: RouteRenderMode;
  shellMode: "document" | "fragment";
  runtimeHref?: string;
  routeAssetHref?: string;
  metadataHref?: string;
  entryAssetHref?: string;
  clientReferenceManifestUrl?: string;
  flightHref?: string;
  rscPayloadFormat: "none" | "react-flight-text";
  rscPayloadChunks: string[];
  boundaryRefs: ClientBoundaryDescriptor[];
  clientReferenceRefs: ClientReferenceRef[];
  renderedSegments: FlightRenderSegment[];
  serverTree: FlightRenderTreeNode;
  flightManifestRefs: FlightManifestRefs;
  sharedChunkHrefs: string[];
  actionEntries: Array<{
    actionId: string;
    exportName: string;
    runtime: "node" | "edge";
    refreshPolicy: "none" | "refresh-current-route-on-revalidate";
    revalidationPolicy: "none" | "track-runtime-revalidation";
  }>;
}

function resolveRenderMode(clientAssets?: DocumentClientAssets): RouteRenderMode {
  return clientAssets?.renderMode
    ?? (clientAssets?.hydrationMode === "full-route" ? "client-root" : "server-components");
}

/** Resolved once at module load; all manifest traversal is bounded to this root. */
const RENDER_PROJECT_ROOT = path.resolve(process.cwd());

/** Per-routeFile manifest path cache for render.tsx (Req 10.4). */
const renderManifestPathCache = new Map<string, string | null>();

/** Module cache for buildRouteTree — avoids repeated dynamic import() of the same file (RF-11). */
const routeModuleCache = new Map<string, unknown>();

/**
 * FIX: Aligned with UTAL - uses resilientImport instead of raw import()
 * FIX: Added generic <T> to function signature.
 */
async function cachedImport<T = unknown>(fileUrl: string): Promise<T> {
  if (routeModuleCache.has(fileUrl)) {
    return routeModuleCache.get(fileUrl) as T;
  }
  const mod = await resilientImport<T>(fileUrl);
  routeModuleCache.set(fileUrl, mod);
  return mod;
}

/** Compiler error for manifest path security violations (render path). */
import { CompilerError } from "./rsc.js";

function resolveClientReferenceManifestPath(): string | null {
  const candidates = [
    path.join(RENDER_PROJECT_ROOT, ".sourceog", "manifests", "client-reference-manifest.json"),
    path.join(RENDER_PROJECT_ROOT, ".sourceog", "client-reference-manifest.json")
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

/**
 * Resolve the client-reference manifest for a given route file, bounded to
 * RENDER_PROJECT_ROOT (Req 10.1, 10.2, 10.3, 10.4).
 */
function resolveClientReferenceManifestPathForRouteFile(routeFile: string): string | null {
  if (renderManifestPathCache.has(routeFile)) {
    return renderManifestPathCache.get(routeFile) ?? null;
  }

  const normalizedRoot = RENDER_PROJECT_ROOT + path.sep;
  const resolvedRouteFile = path.resolve(routeFile);

  if (
    path.isAbsolute(routeFile) &&
    !resolvedRouteFile.startsWith(normalizedRoot) &&
    resolvedRouteFile !== RENDER_PROJECT_ROOT
  ) {
    throw new CompilerError(
      "MANIFEST_PATH_TRAVERSAL",
      `Manifest path resolution rejected: routeFile "${routeFile}" is outside projectRoot "${RENDER_PROJECT_ROOT}".`
    );
  }

  let currentDir = path.dirname(resolvedRouteFile);
  let previousDir = "";

  while (
    currentDir &&
    currentDir !== previousDir &&
    (currentDir.startsWith(normalizedRoot) || currentDir === RENDER_PROJECT_ROOT)
  ) {
    const candidates = [
      path.join(currentDir, ".sourceog", "manifests", "client-reference-manifest.json"),
      path.join(currentDir, ".sourceog", "client-reference-manifest.json")
    ];

    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        renderManifestPathCache.set(routeFile, candidate);
        return candidate;
      }
    }

    previousDir = currentDir;
    currentDir = path.dirname(currentDir);
  }

  const fallback = resolveClientReferenceManifestPath();
  renderManifestPathCache.set(routeFile, fallback);
  return fallback;
}

interface LoadedClientReferenceManifest {
  manifestPath: string;
  distRoot: string;
  registry: Record<string, {
    id?: string;
    chunks?: string[];
    name?: string;
    async?: boolean;
  }>;
}

function resolveDistRootFromManifestPath(manifestPath: string): string {
  const manifestDir = path.dirname(manifestPath);
  return path.basename(manifestDir) === "manifests"
    ? path.dirname(manifestDir)
    : manifestDir;
}

function resolveStaticClientChunkSpecifier(
  distRoot: string,
  moduleId: string,
  chunkHref: string | undefined,
  fallbackFilePath?: string
): string {
  const serverClientReferencePath = path.join(distRoot, "server-client-references", `${moduleId}.js`);
  if (existsSync(serverClientReferencePath)) {
    return pathToFileURL(serverClientReferencePath).href;
  }

  if (chunkHref) {
    const normalizedHref = chunkHref.replace(/^\/+/, "").replaceAll("/", path.sep);
    return pathToFileURL(path.join(distRoot, "static", normalizedHref)).href;
  }

  return pathToFileURL(fallbackFilePath ?? distRoot).href;
}

function createNodeConsumerModuleMap(
  registry: LoadedClientReferenceManifest["registry"],
  distRoot: string
): Record<string, unknown> {
  const moduleMap: Record<string, Record<string, unknown>> = {};

  for (const entry of Object.values(registry) as Array<{
    id?: string;
    chunks?: string[];
    name?: string;
    async?: boolean;
    filepath?: string;
  }>) {
    if (!entry?.id || !entry?.name) {
      continue;
    }

    const moduleRecord = {
      specifier: resolveStaticClientChunkSpecifier(distRoot, entry.id, entry.chunks?.[0], entry.filepath),
      name: entry.name,
      async: entry.async ?? false
    };

    moduleMap[entry.id] = {
      ...(moduleMap[entry.id] ?? {}),
      [entry.name]: moduleRecord,
      "*": moduleRecord
    };
  }

  return moduleMap;
}

function loadClientReferenceManifest(
  routeFile?: string,
  override?: ClientReferenceManifestOverride
): LoadedClientReferenceManifest | null {
  if (override?.clientReferenceManifest) {
    return {
      manifestPath: override.clientReferenceDistRoot ?? "in-memory",
      distRoot: override.clientReferenceDistRoot ?? process.cwd(),
      registry: override.clientReferenceManifest.registry as LoadedClientReferenceManifest["registry"]
    };
  }

  const manifestPath = routeFile
    ? resolveClientReferenceManifestPathForRouteFile(routeFile)
    : resolveClientReferenceManifestPath();
  if (!manifestPath) {
    return null;
  }

  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      registry?: LoadedClientReferenceManifest["registry"];
    };
    return {
      manifestPath,
      distRoot: resolveDistRootFromManifestPath(manifestPath),
      registry: manifest.registry ?? {}
    };
  } catch {
    return null;
  }
}

async function renderDecodedFlightTreeToHtml(tree: React.ReactNode): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const target = new PassThrough();
    const chunks: Buffer[] = [];
    let settled = false;

    const settle = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      callback();
    };

    target.on("data", (chunk) => {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    });
    target.on("end", () => settle(() => resolve(Buffer.concat(chunks).toString("utf8"))));
    target.on("error", (error) => settle(() => reject(error)));

    const stream = renderToPipeableStream(
      React.createElement(React.Fragment, null, tree),
      {
        onAllReady() { stream.pipe(target); },
        onShellError(error) { settle(() => reject(error)); },
        onError(error) { settle(() => reject(error)); }
      }
    );
  });
}

async function renderBodyHtmlFromFlightChunks(
  stream: Readable,
  routeFile?: string,
  override?: ClientReferenceManifestOverride
): Promise<FlightHtmlRenderResult> {
  const loadedManifest = loadClientReferenceManifest(routeFile, override);
  if (!loadedManifest) {
    throw new Error("Client reference manifest is unavailable for Flight HTML rendering.");
  }

  const { createFromNodeStream } = require("react-server-dom-webpack/client.node.unbundled") as {
    createFromNodeStream(
      stream: Readable,
      serverConsumerManifest: {
        moduleMap: Record<string, unknown>;
        serverModuleMap?: Record<string, unknown> | null;
        moduleLoading?: unknown;
      }
    ): Promise<React.ReactNode> | React.ReactNode;
  };

  const model = await createFromNodeStream(stream, {
    moduleMap: createNodeConsumerModuleMap(loadedManifest.registry, loadedManifest.distRoot),
    serverModuleMap: null,
    moduleLoading: null
  });
  const bodyHtml = await renderDecodedFlightTreeToHtml(model as React.ReactNode);
  return {
    bodyHtml,
    shellMode: resolveShellMode(bodyHtml)
  };
}

function toCanonicalRenderResult(
  routeId: string | undefined,
  pathname: string,
  metadata: Metadata,
  bodyHtml: string,
  renderedSegments: FlightRenderSegment[],
  serverTree: FlightRenderTreeNode,
  clientAssets?: DocumentClientAssets,
  routeIdentity?: RouteRenderIdentityInput,
  rscPayload?: {
    format: "none" | "react-flight-text";
    chunks: string[];
  }
): CanonicalRenderResult {
  const attachedServerTree = attachBoundaryIds(serverTree, clientAssets?.boundaryRefs ?? []);
  const shellMode = resolveShellMode(bodyHtml);
  const resolvedRouteId = routeIdentity?.resolvedRouteId ?? routeId ?? "";
  const canonicalRouteId = routeIdentity?.canonicalRouteId ?? resolvedRouteId;
  const renderContext = routeIdentity?.renderContext ?? (routeIdentity?.intercepted ? "intercepted" : "canonical");
  const intercepted = routeIdentity?.intercepted ?? renderContext === "intercepted";
  const renderContextKey = routeIdentity?.renderContextKey
    ?? computeRenderContextKey(canonicalRouteId, "", intercepted);
  const parallelRouteMap = routeIdentity?.parallelRouteMap ?? {};
  return {
    routeId,
    pathname,
    canonicalRouteId,
    resolvedRouteId,
    renderContextKey,
    renderContext,
    intercepted,
    parallelRouteMap: parallelRouteMap,
    renderMode: resolveRenderMode(clientAssets),
    headHtml: renderMetadataToHead(metadata),
    shellHtmlStart: shellMode === "document" ? "<html><body>" : `<div id="sourceog-root">`,
    shellHtmlEnd: shellMode === "document" ? "</body></html>" : `</div>`,
    shellMode,
    bodyHtml,
    rscPayloadFormat: rscPayload?.format ?? "none",
    rscPayloadChunks: rscPayload?.chunks ?? [],
    renderedSegments,
    serverTree: attachedServerTree,
    boundaryRefs: clientAssets?.boundaryRefs ?? [],
    clientReferenceRefs: clientAssets?.clientReferenceRefs ?? [],
    flightManifestRefs: createFlightManifestRefs(clientAssets),
    actionEntries: clientAssets?.actionEntries ?? []
  };
}

export function createDocumentHtml(
  rendered: RenderedPage | CanonicalRenderResult,
  locale?: string,
  options?: {
    routeId?: string;
    clientAssets?: DocumentClientAssets;
  }
): string {
  const head = "metadata" in rendered ? renderMetadataToHead(rendered.metadata) : rendered.headHtml;
  const routeId = options?.routeId ?? rendered.routeId;
  const clientAssets = options?.clientAssets;
  const clientHead = renderClientAssetHead(clientAssets);
  const clientScript = renderClientAssetTail({
    routeId,
    pathname: "pathname" in rendered ? rendered.pathname : "",
    canonicalRouteId: "canonicalRouteId" in rendered ? rendered.canonicalRouteId : routeId ?? "",
    resolvedRouteId: "resolvedRouteId" in rendered ? rendered.resolvedRouteId : routeId ?? "",
    renderContextKey: "renderContextKey" in rendered ? rendered.renderContextKey : `canonical:${"pathname" in rendered ? rendered.pathname : ""}`,
    renderContext: "renderContext" in rendered ? rendered.renderContext : "canonical",
    intercepted: "intercepted" in rendered ? rendered.intercepted : false,
    parallelRouteMap: "parallelRouteMap" in rendered ? rendered.parallelRouteMap : {},
    headHtml: head,
    bodyHtml: rendered.bodyHtml,
    shellHtmlStart: rendered.shellMode === "document" ? "<html><body>" : `<div id="sourceog-root">`,
    shellHtmlEnd: rendered.shellMode === "document" ? "</body></html>" : "</div>",
    shellMode: rendered.shellMode,
    rscPayloadFormat: "rscPayloadFormat" in rendered ? rendered.rscPayloadFormat : "none",
    rscPayloadChunks: "rscPayloadChunks" in rendered ? rendered.rscPayloadChunks : [],
    renderedSegments: rendered.renderedSegments,
    serverTree: attachBoundaryIds(rendered.serverTree, clientAssets?.boundaryRefs ?? []),
    renderMode: "renderMode" in rendered ? rendered.renderMode : resolveRenderMode(clientAssets),
    boundaryRefs: clientAssets?.boundaryRefs ?? [],
    clientReferenceRefs: clientAssets?.clientReferenceRefs ?? [],
    flightManifestRefs: createFlightManifestRefs(clientAssets),
    actionEntries: clientAssets?.actionEntries ?? []
  }, clientAssets);
  if (rendered.shellMode === "document") {
    const withHead = rendered.bodyHtml.includes("<head>")
      ? rendered.bodyHtml.replace("<head>", `<head>${head}${clientHead}`)
      : rendered.bodyHtml.replace("<body", `<head>${head}${clientHead}</head><body`);

    const withRoot = withHead
      .replace("<body>", `<body><div id="sourceog-root">`)
      .replace("</body>", `</div></body>`);

    const withClient = withRoot.includes(clientScript)
      ? withRoot
      : withRoot.replace("</body>", `${clientScript}</body>`);

    return `<!DOCTYPE html>${withClient}`;
  }

  return `<!DOCTYPE html><html lang="${escapeHtmlAttr(locale ?? "en")}"><head><meta charSet="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />${head}${clientHead}</head><body><div id="sourceog-root">${rendered.bodyHtml}</div>${clientScript}</body></html>`;
}

export async function renderRouteToString(
  route: RouteDefinition,
  context: SourceOGRequestContext,
  options?: RouteRenderOptions
): Promise<RenderedPage> {
  const prepared = await prepareRouteRender(route, context, options);
  const { metadata, canonicalResult } = prepared;
  return {
    routeId: route.id,
    metadata,
    bodyHtml: canonicalResult.bodyHtml,
    shellMode: canonicalResult.shellMode,
    renderedSegments: canonicalResult.renderedSegments,
    serverTree: canonicalResult.serverTree
  };
}

export async function renderRouteToCanonicalResult(
  route: RouteDefinition,
  context: SourceOGRequestContext,
  options?: RouteRenderOptions
): Promise<CanonicalRenderResult> {
  const prepared = await prepareRouteRender(route, context, options);
  return prepared.canonicalResult;
}

export async function renderRouteToFlightPayload(
  route: RouteDefinition,
  context: SourceOGRequestContext,
  options?: RouteRenderOptions
): Promise<RouteFlightPayload> {
  const rendered = await renderRouteToCanonicalResult(route, context, options);
  return createClientRouteSnapshot(rendered, options?.clientAssets, options?.pathname ?? context.request.url.pathname);
}

// ---------------------------------------------------------------------------
// Phase 3: Real Streaming Flight Transport (INV-001)
// ---------------------------------------------------------------------------

export function teeReadableStream(
  stream: ReadableStream
): [ReadableStream, ReadableStream] {
  return stream.tee();
}

export function computeCanonicalRouteId(
  routePattern: string,
  params: Record<string, string>
): string {
  const sortedParams = Object.keys(params)
    .sort()
    .reduce<Record<string, string>>((acc, k) => {
      acc[k] = params[k]!;
      return acc;
    }, {});
  return createHash("sha256")
    .update(routePattern + JSON.stringify(sortedParams))
    .digest("hex")
    .slice(0, 12);
}

export function computeRenderContextKey(
  canonicalRouteId: string,
  slotId: string,
  intercepted: boolean
): string {
  return createHash("sha256")
    .update(canonicalRouteId + slotId + String(intercepted))
    .digest("hex")
    .slice(0, 16);
}

export async function renderRouteToFlightStream(
  route: RouteDefinition,
  context: SourceOGRequestContext,
  options?: RouteRenderOptions & { parallelRoutes?: Record<string, RouteDefinition>; timeoutMs?: number }
): Promise<ReadableStream<Uint8Array>> {
  const rscPayload = await renderRouteToOfficialRscPayload(route, context, {
    parallelRoutes: options?.parallelRoutes,
    timeoutMs: options?.timeoutMs
  });

  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of rscPayload.chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    }
  });
}

export async function renderRouteToHtml(
  route: RouteDefinition,
  context: SourceOGRequestContext,
  options?: RouteRenderOptions & { parallelRoutes?: Record<string, RouteDefinition>; timeoutMs?: number }
): Promise<FlightHtmlRenderResult> {
  const flightStream = await renderRouteToFlightStream(route, context, options);
  const [streamForHtml] = teeReadableStream(flightStream);

  const nodeStream = Readable.fromWeb(streamForHtml as import("stream/web").ReadableStream<Uint8Array>);

  return await renderBodyHtmlFromFlightChunks(
    nodeStream,
    route.file,
    {
      clientReferenceManifest: options?.clientReferenceManifest,
      clientReferenceDistRoot: options?.clientReferenceDistRoot
    }
  );
}

export async function renderRouteToResponse(
  route: RouteDefinition,
  context: SourceOGRequestContext,
  options?: RouteRenderOptions
): Promise<SourceOGResponse> {
  try {
    const prepared = await prepareRouteRender(route, context, options);
    return await streamRouteResponse(prepared, context, options?.clientAssets);
  } catch (error) {
    if (isRedirectInterrupt(error)) {
      return redirect(error.location, error.status);
    }

    if (isNotFoundInterrupt(error)) {
      return renderNotFound(route.notFoundFile, context);
    }

    throw error;
  }
}

export async function renderNotFound(notFoundFile: string | undefined, context: SourceOGRequestContext): Promise<SourceOGResponse> {
  if (!notFoundFile) {
    return html("<!DOCTYPE html><html><body><h1>404</h1><p>Page not found.</p></body></html>", { status: 404 });
  }

  // FIX: Aligned with UTAL - resilientImport instead of raw import()
  const module = await resilientImport<RouteModule>(pathToFileURL(notFoundFile).href);
  const NotFoundComponent = module.default;
  if (!NotFoundComponent) {
    return html("<!DOCTYPE html><html><body><h1>404</h1><p>Page not found.</p></body></html>", { status: 404 });
  }

  const syntheticRoute: import("@sourceog/router").RouteDefinition = {
    id: "__not-found__",
    pathname: context.request.url.pathname,
    file: notFoundFile,
    layouts: [],
    templateFile: undefined,
    notFoundFile: undefined,
    errorFile: undefined,
    middlewareFiles: [],
    segments: [],
    urlSegments: [],
    segmentPath: [],
    capabilities: [],
    isParallelSlot: false,
    isIntercepting: false,
    score: 0,
    kind: "page" as import("@sourceog/router").RouteKind,
    modules: { layouts: [], middleware: [] }
  };

  try {
    const { bodyHtml } = await renderRouteToHtml(syntheticRoute, context);
    const metadata = await resolveMetadata([module], context);
    const headHtml = renderMetadataToHead(metadata);
    const fullHtml = bodyHtml.startsWith("<html")
      ? `<!DOCTYPE html>${bodyHtml.replace("<head>", `<head>${headHtml}`).replace("<body", bodyHtml.includes("<head>") ? "<body" : `<head>${headHtml}</head><body`)}`
      : `<!DOCTYPE html><html><head>${headHtml}</head><body>${bodyHtml}</body></html>`;
    return html(fullHtml, { status: 404 });
  } catch {
    const metadata = await resolveMetadata([module], context);
    const bodyHtml = await renderDecodedFlightTreeToHtml(
      <NotFoundComponent params={{}} query={context.query} />
    );
    return html(
      `<!DOCTYPE html><html><head>${renderMetadataToHead(metadata)}</head><body>${bodyHtml}</body></html>`,
      { status: 404 }
    );
  }
}

export async function renderError(errorFile: string | undefined, context: SourceOGRequestContext, error: Error): Promise<SourceOGResponse> {
  if (!errorFile) {
    return html(
      `<!DOCTYPE html><html><body><h1>500</h1><pre>${escapeHtml(error.message)}</pre></body></html>`,
      { status: 500 }
    );
  }

  // FIX: Aligned with UTAL - resilientImport instead of raw import()
  const module = await resilientImport<RouteModule>(pathToFileURL(errorFile).href);
  const ErrorComponent = module.default;
  if (!ErrorComponent) {
    return html(
      `<!DOCTYPE html><html><body><h1>500</h1><pre>${escapeHtml(error.message)}</pre></body></html>`,
      { status: 500 }
    );
  }

  const syntheticRoute: import("@sourceog/router").RouteDefinition = {
    id: "__error__",
    pathname: context.request.url.pathname,
    file: errorFile,
    layouts: [],
    templateFile: undefined,
    notFoundFile: undefined,
    errorFile: undefined,
    middlewareFiles: [],
    segments: [],
    urlSegments: [],
    segmentPath: [],
    capabilities: [],
    isParallelSlot: false,
    isIntercepting: false,
    score: 0,
    kind: "page" as import("@sourceog/router").RouteKind,
    modules: { layouts: [], middleware: [] }
  };

  try {
    const { bodyHtml } = await renderRouteToHtml(syntheticRoute, context);
    const metadata = await resolveMetadata([module], context);
    const headHtml = renderMetadataToHead(metadata);
    const fullHtml = bodyHtml.startsWith("<html")
      ? `<!DOCTYPE html>${bodyHtml.replace("<head>", `<head>${headHtml}`).replace("<body", bodyHtml.includes("<head>") ? "<body" : `<head>${headHtml}</head><body`)}`
      : `<!DOCTYPE html><html><head>${headHtml}</head><body>${bodyHtml}</body></html>`;
    return html(fullHtml, { status: 500 });
  } catch {
    const metadata = await resolveMetadata([module], context);
    const bodyHtml = await renderDecodedFlightTreeToHtml(
      <ErrorComponent error={error} params={context.params} query={context.query} />
    );
    return html(
      `<!DOCTYPE html><html><head>${renderMetadataToHead(metadata)}</head><body>${bodyHtml}</body></html>`,
      { status: 500 }
    );
  }
}

async function buildRouteTree(
  route: RouteDefinition,
  context: SourceOGRequestContext,
  parallelRoutes?: Record<string, RouteDefinition>
): Promise<{
  metadata: Metadata;
  element: React.JSX.Element;
  renderTimeoutMs: number;
  renderedSegments: FlightRenderSegment[];
  serverTree: FlightRenderTreeNode;
}> {
  // Now safely uses UTAL-backed cachedImport
  const pageModule = await cachedImport<RouteModule>(pathToFileURL(route.file).href);
  const PageComponent = pageModule.default;

  if (!PageComponent) {
    throw new SourceOGError(
      SOURCEOG_ERROR_CODES.RENDER_FAILED,
      `Page module "${route.file}" does not export a default React component.`
    );
  }

  const renderedSegments: FlightRenderSegment[] = [];
  const parallelRouteResult = parallelRoutes
    ? await buildParallelRouteElements(route, parallelRoutes, context)
    : { elements: {}, renderedSegments: [], renderedTreeNodes: [] };
  const parallelRouteElements = parallelRouteResult.elements;
  renderedSegments.push(...parallelRouteResult.renderedSegments);
  let element: React.ReactNode = <PageComponent params={context.params} query={context.query} request={context.request} />;

  const layoutMetadataModules: RouteModule[] = [];

  if (route.templateFile) {
    const templateModule = await cachedImport<LayoutModule>(pathToFileURL(route.templateFile).href);
    renderedSegments.push({
      kind: "template",
      routeId: route.id,
      filePath: route.templateFile,
      pathname: route.pathname,
      segmentKey: `template:${route.templateFile}`
    });
    layoutMetadataModules.push(templateModule as unknown as RouteModule);
    element = React.createElement(templateModule.default, {
      children: element,
      params: context.params,
      query: context.query,
      ...parallelRouteElements
    });
  }

  for (const layoutFile of [...route.layouts].reverse()) {
    const layoutModule = await cachedImport<LayoutModule>(pathToFileURL(layoutFile).href);
    renderedSegments.push({
      kind: "layout",
      routeId: route.id,
      filePath: layoutFile,
      pathname: route.pathname,
      segmentKey: `layout:${layoutFile}`
    });
    layoutMetadataModules.unshift(layoutModule as unknown as RouteModule);
    element = React.createElement(layoutModule.default, {
      children: element,
      params: context.params,
      query: context.query,
      ...parallelRouteElements
    });
  }

  const metadataModules: RouteModule[] = [...layoutMetadataModules, pageModule];

  renderedSegments.push({
    kind: "page",
    routeId: route.id,
    filePath: route.file,
    pathname: route.pathname,
    segmentKey: `page:${route.file}`
  });

  const metadata = await resolveMetadata(metadataModules, context);
  return {
    metadata,
    element: element as React.JSX.Element,
    renderTimeoutMs: pageModule.renderTimeoutMs ?? 10_000,
    renderedSegments,
    serverTree: buildServerTree(route, parallelRouteResult.renderedTreeNodes)
  };
}

async function prepareRouteRender(
  route: RouteDefinition,
  context: SourceOGRequestContext,
  options?: RouteRenderOptions
): Promise<PreparedRouteRender> {
  const renderState = await buildRouteTree(route, context, options?.parallelRoutes);
  const renderMode = resolveRenderMode(options?.clientAssets);
  const rscPayload = renderMode === "server-components"
    ? await renderRouteToOfficialRscPayload(route, context, {
      parallelRoutes: options?.parallelRoutes,
      timeoutMs: renderState.renderTimeoutMs
    })
    : {
      format: "none" as const,
      chunks: []
    };
  const clientRootBodyHtml = renderMode === "client-root"
    ? renderToStaticMarkup(renderState.element)
    : "";
  let flightHtml: FlightHtmlRenderResult;
  if (renderMode === "server-components") {
    try {
      const chunksStream = Readable.from(rscPayload.chunks.map(c => Buffer.from(c, "utf8")));
      flightHtml = await renderBodyHtmlFromFlightChunks(chunksStream, route.file, {
        clientReferenceManifest: options?.clientReferenceManifest,
        clientReferenceDistRoot: options?.clientReferenceDistRoot
      });
    } catch (error) {
      const fallbackBodyHtml = renderToStaticMarkup(renderState.element);
      console.error("[SOURCEOG-FALLBACK] Failed to derive HTML from Flight output. Falling back to route-tree HTML render.", error);
      flightHtml = {
        bodyHtml: fallbackBodyHtml,
        shellMode: resolveShellMode(fallbackBodyHtml)
      };
    }
  } else {
    flightHtml = {
      bodyHtml: clientRootBodyHtml,
      shellMode: resolveShellMode(clientRootBodyHtml)
    };
  }
  return {
    ...renderState,
    canonicalResult: toCanonicalRenderResult(
      route.id,
      options?.pathname ?? context.request.url.pathname,
      renderState.metadata,
      flightHtml.bodyHtml,
      renderState.renderedSegments,
      renderState.serverTree,
      options?.clientAssets,
      options?.routeIdentity ?? {
        canonicalRouteId: computeCanonicalRouteId(
          route.pathname,
          Object.fromEntries(
            Object.entries(context.params).map(([k, v]) => [k, Array.isArray(v) ? v.join("/") : v])
          )
        )
      },
      rscPayload
    )
  };
}

async function buildParallelRouteElements(
  primaryRoute: RouteDefinition,
  parallelRoutes: Record<string, RouteDefinition>,
  context: SourceOGRequestContext
): Promise<{
  elements: Record<string, React.ReactNode>;
  renderedSegments: FlightRenderSegment[];
  renderedTreeNodes: FlightRenderTreeNode[];
}> {
  const entries = await Promise.all(
    Object.entries(parallelRoutes).map(async ([slotName, slotRoute]) => {
      // FIX: Aligned with UTAL - resilientImport instead of raw import()
      const slotPageModule = await resilientImport<RouteModule>(pathToFileURL(slotRoute.file).href);
      const SlotPageComponent = slotPageModule.default;
      if (!SlotPageComponent) {
        return { slotName, element: null, renderedSegment: null, renderedTreeNode: null };
      }

      let element: React.ReactNode = (
        <SlotPageComponent params={context.params} query={context.query} request={context.request} />
      );

      if (slotRoute.templateFile && slotRoute.templateFile !== primaryRoute.templateFile) {
        // FIX: Aligned with UTAL - resilientImport instead of raw import()
        const templateModule = await resilientImport<LayoutModule>(pathToFileURL(slotRoute.templateFile).href);
        element = React.createElement(templateModule.default, {
          children: element,
          params: context.params,
          query: context.query
        });
      }

      const sharedLayoutCount = countSharedLayouts(primaryRoute.layouts, slotRoute.layouts);
      for (const layoutFile of [...slotRoute.layouts].slice(sharedLayoutCount).reverse()) {
        const layoutModule = await cachedImport<LayoutModule>(pathToFileURL(layoutFile).href);
        element = React.createElement(layoutModule.default, {
          children: element,
          params: context.params,
          query: context.query
        });
      }

      return {
        slotName,
        element,
        renderedSegment: {
          kind: "parallel-page" as const,
          routeId: slotRoute.id,
          filePath: slotRoute.file,
          pathname: slotRoute.pathname,
          segmentKey: `parallel:${slotName}:${slotRoute.file}`,
          slotName
        },
        renderedTreeNode: {
          id: `parallel-slot:${primaryRoute.id}:${slotName}`,
          kind: "parallel-slot" as const,
          routeId: primaryRoute.id,
          pathname: primaryRoute.pathname,
          segmentKey: `parallel-slot:${slotName}`,
          slotName,
          boundaryIds: [],
          children: [{
            id: `parallel-page:${slotRoute.id}:${slotName}`,
            kind: "parallel-page",
            routeId: slotRoute.id,
            pathname: slotRoute.pathname,
            filePath: slotRoute.file,
            segmentKey: `parallel:${slotName}:${slotRoute.file}`,
            slotName,
            boundaryIds: [],
            children: []
          }]
        }
      };
    })
  );

  const filteredEntries = entries.filter((entry) => entry.element !== null);
  return {
    elements: Object.fromEntries(filteredEntries.map((entry) => [entry.slotName, entry.element as React.ReactNode])),
    renderedSegments: filteredEntries.map((entry) => entry.renderedSegment as FlightRenderSegment),
    renderedTreeNodes: filteredEntries.map((entry) => entry.renderedTreeNode as FlightRenderTreeNode)
  };
}

function buildServerTree(route: RouteDefinition, parallelRouteNodes: FlightRenderTreeNode[]): FlightRenderTreeNode {
  const rootNode: FlightRenderTreeNode = {
    id: `render-tree:${route.id}`, kind: "root", routeId: route.id, pathname: route.pathname,
    segmentKey: `root:${route.id}`, boundaryIds: [], children: []
  };

  let cursor = rootNode;
  for (const layoutFile of route.layouts) {
    const layoutNode: FlightRenderTreeNode = {
      id: `layout:${route.id}:${layoutFile}`, kind: "layout", routeId: route.id, pathname: route.pathname,
      filePath: layoutFile, segmentKey: `layout:${layoutFile}`, boundaryIds: [], children: []
    };
    cursor.children.push(layoutNode);
    cursor = layoutNode;
  }

  if (route.templateFile) {
    const templateNode: FlightRenderTreeNode = {
      id: `template:${route.id}:${route.templateFile}`, kind: "template", routeId: route.id, pathname: route.pathname,
      filePath: route.templateFile, segmentKey: `template:${route.templateFile}`, boundaryIds: [], children: []
    };
    cursor.children.push(templateNode);
    cursor = templateNode;
  }

  cursor.children.push({
    id: `page-node:${route.id}`, kind: "page", routeId: route.id, pathname: route.pathname,
    filePath: route.file, segmentKey: `page:${route.file}`, boundaryIds: [], children: []
  });
  cursor.children.push(...parallelRouteNodes);
  return rootNode;
}

function countSharedLayouts(primaryLayouts: string[], slotLayouts: string[]): number {
  const max = Math.min(primaryLayouts.length, slotLayouts.length);
  let count = 0;
  while (count < max && primaryLayouts[count] === slotLayouts[count]) count += 1;
  return count;
}

async function resolveMetadata(modules: RouteModule[], context: SourceOGRequestContext): Promise<Metadata> {
  const metadataParts = await Promise.all(modules.map(async (module) => {
    if (module.generateMetadata) return module.generateMetadata(context);
    return module.metadata;
  }));
  return mergeMetadata(...metadataParts);
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\"", "&quot;");
}

export function escapeHtmlAttr(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("\"", "&quot;").replaceAll(">", "&gt;");
}

export function escapeScriptContent(value: string): string {
  return value.replaceAll("</", "<\\/").replaceAll("<!--", "<\\!--").replaceAll("-->", "--\\>");
}

async function streamRouteResponse(
  renderState: PreparedRouteRender,
  context: SourceOGRequestContext,
  clientAssets?: DocumentClientAssets
): Promise<SourceOGResponse> {
  if (renderState.canonicalResult.renderMode === "server-components") {
    return streamServerComponentsResponse(renderState, context, clientAssets);
  }

  const isDocument = renderState.canonicalResult.shellMode === "document";
  const body = new PassThrough();
  const renderSnapshot = {
    routeId: renderState.canonicalResult.routeId,
    pathname: renderState.canonicalResult.pathname,
    canonicalRouteId: renderState.canonicalResult.canonicalRouteId,
    resolvedRouteId: renderState.canonicalResult.resolvedRouteId,
    renderContextKey: renderState.canonicalResult.renderContextKey,
    renderContext: renderState.canonicalResult.renderContext,
    intercepted: renderState.canonicalResult.intercepted,
    parallelRouteMap: renderState.canonicalResult.parallelRouteMap,
    headHtml: renderState.canonicalResult.headHtml,
    bodyHtml: renderState.canonicalResult.bodyHtml,
    shellHtmlStart: renderState.canonicalResult.shellHtmlStart,
    shellHtmlEnd: renderState.canonicalResult.shellHtmlEnd,
    shellMode: renderState.canonicalResult.shellMode,
    rscPayloadFormat: renderState.canonicalResult.rscPayloadFormat,
    rscPayloadChunks: renderState.canonicalResult.rscPayloadChunks,
    renderedSegments: renderState.canonicalResult.renderedSegments,
    serverTree: renderState.canonicalResult.serverTree,
    renderMode: renderState.canonicalResult.renderMode,
    boundaryRefs: renderState.canonicalResult.boundaryRefs,
    clientReferenceRefs: renderState.canonicalResult.clientReferenceRefs,
    flightManifestRefs: renderState.canonicalResult.flightManifestRefs,
    actionEntries: renderState.canonicalResult.actionEntries
  };
  const tailScript = renderClientAssetTail(renderSnapshot, clientAssets);
  const headMarkup = `${renderState.canonicalResult.headHtml}${renderClientAssetHead(clientAssets)}`;

  return await new Promise<SourceOGResponse>((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      stream.abort();
      resolve(html(createDocumentHtml(renderState.canonicalResult, context.locale, { routeId: renderState.canonicalResult.routeId, clientAssets }), {
        status: 200,
        headers: {
          "x-sourceog-render-mode": "timeout-fallback",
          "x-sourceog-render-runtime": renderState.canonicalResult.renderMode,
          "x-sourceog-rsc-payload-format": renderState.canonicalResult.rscPayloadFormat
        }
      }));
    }, renderState.renderTimeoutMs);

    const resolveStreamResponse = (streamBody: PassThrough): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(new SourceOGResponse(streamBody, {
        status: 200,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "x-sourceog-render-mode": "stream",
          "x-sourceog-render-runtime": renderState.canonicalResult.renderMode,
          "x-sourceog-rsc-payload-format": renderState.canonicalResult.rscPayloadFormat
        }
      }));
    };

    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    };

    const stream = renderToPipeableStream(renderState.element, {
      onAllReady() {
        body.write("<!DOCTYPE html>");
        if (isDocument) {
          const transform = createDocumentInjectionTransform(headMarkup, tailScript);
          stream.pipe(transform).pipe(body);
          resolveStreamResponse(body);
          return;
        }
        body.write(`<html lang="${context.locale ?? "en"}"><head><meta charSet="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />${headMarkup}</head><body><div id="sourceog-root">`);
        const transform = new PassThrough();
        stream.pipe(transform);
        transform.on("data", (chunk) => body.write(chunk));
        transform.on("end", () => { body.end(`</div>${tailScript}</body></html>`); });
        transform.on("error", fail);
        resolveStreamResponse(body);
      },
      onShellError(error) { fail(error); },
      onError(error) { fail(error); }
    });
  });
}

async function streamServerComponentsResponse(
  renderState: PreparedRouteRender,
  context: SourceOGRequestContext,
  clientAssets?: DocumentClientAssets
): Promise<SourceOGResponse> {
  const body = new PassThrough();
  const renderSnapshot = {
    routeId: renderState.canonicalResult.routeId,
    pathname: renderState.canonicalResult.pathname,
    canonicalRouteId: renderState.canonicalResult.canonicalRouteId,
    resolvedRouteId: renderState.canonicalResult.resolvedRouteId,
    renderContextKey: renderState.canonicalResult.renderContextKey,
    renderContext: renderState.canonicalResult.renderContext,
    intercepted: renderState.canonicalResult.intercepted,
    parallelRouteMap: renderState.canonicalResult.parallelRouteMap,
    headHtml: renderState.canonicalResult.headHtml,
    bodyHtml: renderState.canonicalResult.bodyHtml,
    shellHtmlStart: renderState.canonicalResult.shellHtmlStart,
    shellHtmlEnd: renderState.canonicalResult.shellHtmlEnd,
    shellMode: renderState.canonicalResult.shellMode,
    rscPayloadFormat: renderState.canonicalResult.rscPayloadFormat,
    rscPayloadChunks: [],
    renderedSegments: renderState.canonicalResult.renderedSegments,
    serverTree: renderState.canonicalResult.serverTree,
    renderMode: renderState.canonicalResult.renderMode,
    boundaryRefs: renderState.canonicalResult.boundaryRefs,
    clientReferenceRefs: renderState.canonicalResult.clientReferenceRefs,
    flightManifestRefs: renderState.canonicalResult.flightManifestRefs,
    actionEntries: renderState.canonicalResult.actionEntries
  };

  const headMarkup = `${renderState.canonicalResult.headHtml}${renderClientAssetHead(clientAssets)}`;
  const contextScript = renderClientContextScript(renderSnapshot, clientAssets);
  const runtimeScript = clientAssets
    ? `<script type="module" src="${clientAssets.runtimeHref}"></script>`
    : `<script type="module" src="/__sourceog/client.js"></script>`;

  const isDocument = renderState.canonicalResult.shellMode === "document";
  let shellHtml: string;
  if (isDocument) {
    const bodyHtml = renderState.canonicalResult.bodyHtml;
    const withHead = bodyHtml.includes("<head>")
      ? bodyHtml.replace("<head>", `<head>${headMarkup}`)
      : bodyHtml.replace("<body", `<head>${headMarkup}</head><body`);
    const withRoot = withHead.replace("<body>", `<body><div id="sourceog-root">`).replace("</body>", `</div></body>`);
    shellHtml = `<!DOCTYPE html>${withRoot}`;
  } else {
    shellHtml = `<!DOCTYPE html><html lang="${context.locale ?? "en"}"><head><meta charSet="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />${headMarkup}</head><body><div id="sourceog-root">${renderState.canonicalResult.bodyHtml}</div>`;
  }

  body.write(shellHtml);
  for (const chunk of renderState.canonicalResult.rscPayloadChunks) {
    body.write(`<script type="text/x-component">${escapeScriptContent(chunk)}</script>`);
  }
  
  const hydrationReadyScript = `<script>window.__SOURCEOG_RSC_READY__=true;</script>`;
  body.write(hydrationReadyScript);
  body.write(contextScript);
  body.write(runtimeScript);

  if (!isDocument) {
    body.write(`</body></html>`);
  }
  body.end();

  return new SourceOGResponse(body, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "transfer-encoding": "chunked",
      "x-sourceog-render-mode": "flight-derived",
      "x-sourceog-render-runtime": renderState.canonicalResult.renderMode,
      "x-sourceog-rsc-payload-format": renderState.canonicalResult.rscPayloadFormat
    }
  });
}

function renderClientContextScript(
  rendered: Pick<CanonicalRenderResult, "routeId" | "pathname" | "canonicalRouteId" | "resolvedRouteId" | "renderContextKey" | "renderContext" | "intercepted" | "parallelRouteMap" | "headHtml" | "bodyHtml" | "shellHtmlStart" | "shellHtmlEnd" | "shellMode" | "rscPayloadFormat" | "rscPayloadChunks" | "renderedSegments" | "serverTree" | "renderMode" | "boundaryRefs" | "clientReferenceRefs" | "flightManifestRefs" | "actionEntries">,
  clientAssets?: DocumentClientAssets
): string {
  if (!clientAssets) return "";
  const snapshot = createClientRouteSnapshot(rendered, clientAssets, rendered.pathname);
  return `<script>window.__SOURCEOG_INITIAL_RENDER_SNAPSHOT__=${escapeScriptContent(JSON.stringify(snapshot))};window.__SOURCEOG_LAST_RENDER_SNAPSHOT__=window.__SOURCEOG_INITIAL_RENDER_SNAPSHOT__;window.__SOURCEOG_CLIENT_CONTEXT__=${escapeScriptContent(JSON.stringify(projectClientContextFromSnapshot(snapshot)))};${rendered.routeId ? `document.documentElement.dataset.sourceogRoute=${JSON.stringify(rendered.routeId)};` : ""}</script>`;
}

function renderClientAssetHead(clientAssets?: DocumentClientAssets): string {
  if (!clientAssets) return "";
  const modulePreloads = new Set<string>([clientAssets.runtimeHref]);
  const fetchPreloads = new Set<string>();
  for (const href of clientAssets.preloadHrefs ?? []) {
    if (href.endsWith(".json")) { fetchPreloads.add(href); continue; }
    modulePreloads.add(href);
  }
  if (clientAssets.routeAssetHref) modulePreloads.add(clientAssets.routeAssetHref);
  if (clientAssets.entryAssetHref) modulePreloads.add(clientAssets.entryAssetHref);
  for (const boundaryRef of clientAssets.boundaryRefs ?? []) { if (boundaryRef.assetHref) modulePreloads.add(boundaryRef.assetHref); }
  if (clientAssets.metadataHref) fetchPreloads.add(clientAssets.metadataHref);
  if (clientAssets.clientReferenceManifestUrl) fetchPreloads.add(clientAssets.clientReferenceManifestUrl);
  if (clientAssets.flightHref) fetchPreloads.add(clientAssets.flightHref);
  for (const href of clientAssets.sharedChunkHrefs ?? []) modulePreloads.add(href);
  return [
    ...[...modulePreloads].map((href) => `<link rel="modulepreload" href="${escapeHtmlAttr(href)}" />`),
    ...[...fetchPreloads].map((href) => `<link rel="preload" as="fetch" href="${escapeHtmlAttr(href)}" crossorigin="anonymous" />`)
  ].join("");
}

function renderClientAssetTail(
  rendered: Pick<CanonicalRenderResult, "routeId" | "pathname" | "canonicalRouteId" | "resolvedRouteId" | "renderContextKey" | "renderContext" | "intercepted" | "parallelRouteMap" | "headHtml" | "bodyHtml" | "shellHtmlStart" | "shellHtmlEnd" | "shellMode" | "rscPayloadFormat" | "rscPayloadChunks" | "renderedSegments" | "serverTree" | "renderMode" | "boundaryRefs" | "clientReferenceRefs" | "flightManifestRefs" | "actionEntries">,
  clientAssets?: DocumentClientAssets
): string {
  if (!clientAssets) return `<script type="module" src="/__sourceog/client.js"></script>`;
  const snapshot = createClientRouteSnapshot(rendered, clientAssets, rendered.pathname);
  const contextScript = `<script>window.__SOURCEOG_INITIAL_RENDER_SNAPSHOT__=${escapeScriptContent(JSON.stringify(snapshot))};window.__SOURCEOG_LAST_RENDER_SNAPSHOT__=window.__SOURCEOG_INITIAL_RENDER_SNAPSHOT__;window.__SOURCEOG_CLIENT_CONTEXT__=${escapeScriptContent(JSON.stringify(projectClientContextFromSnapshot(snapshot)))};${rendered.routeId ? `document.documentElement.dataset.sourceogRoute=${JSON.stringify(rendered.routeId)};` : ""}</script>`;
  return `${contextScript}<script type="module" src="${escapeHtmlAttr(clientAssets.runtimeHref)}"></script>`;
}

function createFlightManifestRefs(clientAssets?: DocumentClientAssets): FlightManifestRefs {
  return {
    runtimeHref: clientAssets?.runtimeHref,
    routeAssetHref: clientAssets?.routeAssetHref,
    metadataHref: clientAssets?.metadataHref,
    entryAssetHref: clientAssets?.entryAssetHref,
    sharedChunkHrefs: clientAssets?.sharedChunkHrefs ?? [],
    boundaryAssetHrefs: (clientAssets?.boundaryRefs ?? []).map((boundary) => boundary.assetHref).filter((value): value is string => Boolean(value)),
    actionIds: (clientAssets?.actionEntries ?? []).map((entry) => entry.actionId)
  };
}

function createClientRouteSnapshot(
  rendered: Pick<CanonicalRenderResult, "routeId" | "pathname" | "canonicalRouteId" | "resolvedRouteId" | "renderContextKey" | "renderContext" | "intercepted" | "parallelRouteMap" | "headHtml" | "bodyHtml" | "shellHtmlStart" | "shellHtmlEnd" | "shellMode" | "rscPayloadFormat" | "rscPayloadChunks" | "renderedSegments" | "serverTree" | "renderMode" | "boundaryRefs" | "clientReferenceRefs" | "flightManifestRefs" | "actionEntries">,
  clientAssets?: DocumentClientAssets,
  pathname?: string
): ClientRouteSnapshot {
  return {
    version: SOURCEOG_MANIFEST_VERSION,
    routeId: rendered.routeId,
    pathname: pathname ?? rendered.pathname,
    canonicalRouteId: rendered.canonicalRouteId,
    resolvedRouteId: rendered.resolvedRouteId,
    renderContextKey: rendered.renderContextKey,
    renderContext: rendered.renderContext,
    intercepted: rendered.intercepted,
    parallelRouteMap: rendered.parallelRouteMap,
    headHtml: rendered.headHtml,
    bodyHtml: rendered.bodyHtml,
    shellHtmlStart: rendered.shellHtmlStart,
    shellHtmlEnd: rendered.shellHtmlEnd,
    shellMode: rendered.shellMode,
    rscPayloadFormat: rendered.rscPayloadFormat,
    rscPayloadChunks: rendered.rscPayloadChunks,
    renderedSegments: rendered.renderedSegments,
    serverTree: rendered.serverTree,
    renderMode: rendered.renderMode,
    hydrationMode: clientAssets?.hydrationMode ?? (rendered.renderMode === "client-root" ? "full-route" : "mixed-route"),
    runtimeHref: clientAssets?.runtimeHref,
    routeAssetHref: clientAssets?.routeAssetHref,
    metadataHref: clientAssets?.metadataHref,
    entryAssetHref: clientAssets?.entryAssetHref,
    clientReferenceManifestUrl: clientAssets?.clientReferenceManifestUrl ?? "/__sourceog/client-refs.json",
    flightHref: clientAssets?.flightHref,
    flightManifestRefs: rendered.flightManifestRefs,
    boundaryRefs: rendered.boundaryRefs,
    clientReferenceRefs: rendered.clientReferenceRefs,
    sharedChunkHrefs: clientAssets?.sharedChunkHrefs ?? [],
    preloadHrefs: clientAssets?.preloadHrefs ?? [],
    actionEntries: rendered.actionEntries
  };
}

function projectClientContextFromSnapshot(snapshot: ClientRouteSnapshot): ClientContextSnapshot {
  return {
    routeId: snapshot.routeId,
    pathname: snapshot.pathname,
    canonicalRouteId: snapshot.canonicalRouteId,
    resolvedRouteId: snapshot.resolvedRouteId,
    renderContextKey: snapshot.renderContextKey,
    renderContext: snapshot.renderContext,
    intercepted: snapshot.intercepted,
    parallelRouteMap: snapshot.parallelRouteMap,
    hydrationMode: snapshot.hydrationMode,
    renderMode: snapshot.renderMode,
    shellMode: snapshot.shellMode,
    rscPayloadFormat: snapshot.rscPayloadFormat,
    rscPayloadChunks: snapshot.rscPayloadChunks,
    runtimeHref: snapshot.runtimeHref,
    routeAssetHref: snapshot.routeAssetHref,
    metadataHref: snapshot.metadataHref,
    entryAssetHref: snapshot.entryAssetHref,
    clientReferenceManifestUrl: snapshot.clientReferenceManifestUrl,
    flightHref: snapshot.flightHref,
    boundaryRefs: snapshot.boundaryRefs,
    clientReferenceRefs: snapshot.clientReferenceRefs,
    renderedSegments: snapshot.renderedSegments,
    serverTree: snapshot.serverTree,
    flightManifestRefs: snapshot.flightManifestRefs,
    sharedChunkHrefs: snapshot.sharedChunkHrefs,
    actionEntries: snapshot.actionEntries
  };
}

function attachBoundaryIds(node: FlightRenderTreeNode, boundaryRefs: ClientBoundaryDescriptor[]): FlightRenderTreeNode {
  const childNodes = node.children.map((child) => attachBoundaryIds(child, boundaryRefs));
  const boundaryIds = node.kind === "page" || node.kind === "parallel-page"
    ? boundaryRefs.filter((boundaryRef) => boundaryRef.routeId === node.routeId).map((boundaryRef) => boundaryRef.boundaryId)
    : [];
  return { ...node, boundaryIds, children: childNodes };
}

function resolveShellMode(bodyHtml: string): "document" | "fragment" {
  return bodyHtml.startsWith("<html") ? "document" : "fragment";
}

function createDocumentInjectionTransform(headMarkup: string, tailMarkup: string): Transform {
  let buffer = "";
  let insertedHead = false;
  let insertedRootStart = false;
  let insertedTail = false;
  const markerLookbehind = 64;

  const flushBuffer = (final: boolean): string => {
    let output = buffer;
    if (output.startsWith("<!DOCTYPE html>")) output = output.slice("<!DOCTYPE html>".length);

    if (!insertedHead) {
      if (output.includes("<head>")) { output = output.replace("<head>", `<head>${headMarkup}`); insertedHead = true; }
      else if (output.includes("<body")) { output = output.replace("<body", `<head>${headMarkup}</head><body`); insertedHead = true; }
      else if (!final && output.length > markerLookbehind) { const emit = output.slice(0, -markerLookbehind); buffer = output.slice(-markerLookbehind); return emit; }
      else if (final) { output = `<head>${headMarkup}</head>${output}`; insertedHead = true; }
    }

    if (!insertedRootStart) {
      const bodyMatch = output.match(/<body([^>]*)>/);
      if (bodyMatch) { output = output.replace(/<body([^>]*)>/, `<body$1><div id="sourceog-root">`); insertedRootStart = true; }
      else if (!final && output.length > markerLookbehind) { const emit = output.slice(0, -markerLookbehind); buffer = output.slice(-markerLookbehind); return emit; }
      else if (final) { output = `<div id="sourceog-root">${output}`; insertedRootStart = true; }
    }

    if (!insertedTail) {
      if (output.includes("</body>")) { output = output.replace("</body>", `</div>${tailMarkup}</body>`); insertedTail = true; }
      else if (!final && output.length > markerLookbehind) { const emit = output.slice(0, -markerLookbehind); buffer = output.slice(-markerLookbehind); return emit; }
      else if (final) { output = `${output}</div>${tailMarkup}`; insertedTail = true; }
    }

    buffer = "";
    return output;
  };

  return new Transform({
    transform(chunk, _encoding, callback) { buffer += chunk.toString(); callback(null, flushBuffer(false)); },
    flush(callback) { callback(null, flushBuffer(true)); }
  });
}