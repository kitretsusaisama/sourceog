import { createHash } from "node:crypto";
import type { RouteDefinition } from "@sourceog/router";
import type {
  CanonicalRenderResult,
  SourceOGRequestContext,
  SourceOGResponse,
} from "@sourceog/runtime";
import {
  RendererOrchestrator,
  createRenderer,
} from "./orchestrator/renderer-orchestrator.js";
import type { WorkerRenderResponse } from "./types/internal.js";
import type {
  RenderRouteOptions,
  Renderer,
  RendererPoolStats,
} from "./types/public.js";

export type {
  ClientManifestEntry,
  ClientManifestRecord,
} from "./rsc-worker-utils.js";
export type { WorkerRenderResponse } from "./types/internal.js";
export type {
  RenderRouteOptions,
  Renderer,
  RendererPoolStats,
} from "./types/public.js";

export {
  loadManifestFromPath,
  normalizeClientManifest,
  toError,
} from "./rsc-worker-utils.js";

export { resolveManifestPathForRouteFile } from "./manifests/manifest-resolver.js";
export { PROJECT_ROOT } from "./core/constants.js";

export {
  RenderError,
  RenderTimeoutError,
  WorkerPoolExhaustedError,
  ManifestTraversalError,
  CompilerError,
  toError as toRendererError,
} from "./core/errors.js";

export { WorkerPool as RscWorkerPool } from "./orchestrator/worker-pool.js";
export { RendererOrchestrator, createRenderer };

export const PACKAGE_VERSION = "0.1.0" as const;

type RenderModule = typeof import("./render.js");

let renderModulePromise: Promise<RenderModule> | undefined;

async function loadRenderModule(): Promise<RenderModule> {
  renderModulePromise ??= import("./render.js");
  return renderModulePromise;
}

let rendererInstance: Renderer | undefined;

function getRendererInstance(): Renderer {
  rendererInstance ??= createRenderer();
  return rendererInstance;
}

export const renderer: Renderer = {
  renderRoute(
    route: RouteDefinition,
    context: SourceOGRequestContext,
    options?: RenderRouteOptions,
  ): Promise<WorkerRenderResponse> {
    return getRendererInstance().renderRoute(route, context, options);
  },
  getStats(): RendererPoolStats {
    return getRendererInstance().getStats();
  },
  shutdown(): Promise<void> {
    return getRendererInstance().shutdown();
  },
};

export async function renderRoute(
  route: RouteDefinition,
  context: SourceOGRequestContext,
  options: RenderRouteOptions = {},
): Promise<SourceOGResponse> {
  const mod = await loadRenderModule();
  return mod.renderRoute(
    route,
    context,
    options as Parameters<RenderModule["renderRoute"]>[2],
  );
}

export async function renderRouteToCanonicalResult(
  route: RouteDefinition,
  context: SourceOGRequestContext,
  options: RenderRouteOptions = {},
): Promise<CanonicalRenderResult & { htmlShell: string; renderTimeMs: number }> {
  const mod = await loadRenderModule();
  return mod.renderRouteToCanonicalResult(
    route,
    context,
    options as Parameters<RenderModule["renderRouteToCanonicalResult"]>[2],
  );
}

export async function renderRouteToFlightPayload(
  route: RouteDefinition,
  context: SourceOGRequestContext,
  options: RenderRouteOptions = {},
) {
  const mod = await loadRenderModule();
  return mod.renderRouteToFlightPayload(
    route,
    context,
    options as Parameters<RenderModule["renderRouteToFlightPayload"]>[2],
  );
}

export async function renderRouteToFlightStream(
  route: RouteDefinition,
  context: SourceOGRequestContext,
  options: RenderRouteOptions = {},
): Promise<ReadableStream<Uint8Array>> {
  const mod = await loadRenderModule();
  return mod.renderRouteToFlightStream(
    route,
    context,
    options as Parameters<RenderModule["renderRouteToFlightStream"]>[2],
  );
}

export async function renderRouteToResponse(
  route: RouteDefinition,
  context: SourceOGRequestContext,
  options: RenderRouteOptions = {},
): Promise<SourceOGResponse> {
  const mod = await loadRenderModule();
  return mod.renderRouteToResponse(
    route,
    context,
    options as Parameters<RenderModule["renderRouteToResponse"]>[2],
  );
}

export async function renderError(
  errorFile: string | undefined,
  context: SourceOGRequestContext,
  error: Error,
): Promise<SourceOGResponse> {
  const mod = await loadRenderModule();
  return mod.renderError(errorFile, context, error);
}

export async function renderNotFound(
  notFoundFile: string | undefined,
  context: SourceOGRequestContext,
): Promise<SourceOGResponse> {
  const mod = await loadRenderModule();
  return mod.renderNotFound(notFoundFile, context);
}

export async function createDocumentHtml(...args: Parameters<RenderModule["createDocumentHtml"]>) {
  const mod = await loadRenderModule();
  return mod.createDocumentHtml(...args);
}

export function computeCanonicalRouteId(
  routePattern: string,
  params: Record<string, string>,
): string {
  const stableParams = Object.keys(params)
    .sort()
    .reduce<Record<string, string>>((accumulator, key) => {
      accumulator[key] = params[key] != null ? params[key] : '';
      return accumulator;
    }, {});
  return createHash("sha256")
    .update(routePattern + JSON.stringify(stableParams))
    .digest("hex")
    .slice(0, 12);
}

export function computeRenderContextKey(
  canonicalRouteId: string,
  slotId: string,
  intercepted: boolean,
): string {
  return createHash("sha256")
    .update(canonicalRouteId + slotId + String(intercepted))
    .digest("hex")
    .slice(0, 16);
}

export function escapeHtmlAttr(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll(">", "&gt;");
}

export function escapeScriptContent(value: string): string {
  return value
    .replaceAll("</", "<\\/")
    .replaceAll("<!--", "<\\!--")
    .replaceAll("-->", "--\\>");
}

export function teeReadableStream(
  stream: ReadableStream<Uint8Array>,
): [ReadableStream<Uint8Array>, ReadableStream<Uint8Array>] {
  return stream.tee();
}

export async function streamServerComponentsResponseForTest(
  ...args: Parameters<RenderModule["streamServerComponentsResponseForTest"]>
): Promise<ReturnType<RenderModule["streamServerComponentsResponseForTest"]>> {
  const mod = await loadRenderModule();
  return mod.streamServerComponentsResponseForTest(...args);
}

export async function renderRouteToOfficialRscPayload(
  route: RouteDefinition,
  context: SourceOGRequestContext,
  options: RenderRouteOptions = {},
): Promise<WorkerRenderResponse> {
  if (!route?.id || !route.file) {
    const { RenderError } = await import("./core/errors.js");
    throw new RenderError("INVALID_ROUTE", "Route missing id or file.");
  }

  return renderer.renderRoute(route, context, {
    collectChunks: true,
    ...options,
  });
}

export async function shutdownRscWorkerPool(): Promise<void> {
  await renderer.shutdown();
}
