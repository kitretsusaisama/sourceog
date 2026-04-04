import type { RouteDefinition } from "@sourceog/router";
import type { SourceOGRequestContext } from "@sourceog/runtime";
import type { WorkerRenderResponse } from "./types/internal.js";
import type { RenderRouteOptions, Renderer } from "./types/public.js";
import { createRenderer } from "./orchestrator/renderer-orchestrator.js";
import { RenderError } from "./core/errors.js";

export const renderer: Renderer = createRenderer();

export async function renderRouteToOfficialRscPayload(
  route: RouteDefinition,
  context: SourceOGRequestContext,
  options: RenderRouteOptions = {},
): Promise<WorkerRenderResponse> {
  if (!route?.id || !route.file) {
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
