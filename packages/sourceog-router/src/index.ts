// packages/sourceog-router/src/index.ts
// =============================================================================
// @sourceog/router
// File-system route scanning, route manifest, and URL matching.
// =============================================================================

import path from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";

// Core exports
export { scanRoutes } from "./scan.js";
export { matchPageRoute, matchHandlerRoute } from "./match.js";
export { parseSegment, buildPathname, routeSortWeight, normalizeSegments } from "./segments.js";
export { rankRoutes } from "./rank.js";
export { applyI18nExpansion } from "./i18n.js";

// Types
export type {
  RouteSegment,
  RouteSegmentSemanticKind,
  SegmentKind,
  RouteCapability,
  RouteKind,
  RouteRenderContext,
  RouteDefinition,
  RouteModuleFiles,
  RouteDynamicInfo,
  RouteDiscoveryInfo,
  RouteManifest,
  RouteMatch,
  RouteGraphNodeDefinition,
  RouteGraphRouteDefinition,
  RouteGraphDefinition,
  RouteGraphLookup,
  RouteScanResult,
  // Design-doc types
  RenderMode,
  RouteFiles,
  DesignRouteSegment,
  CachePolicy,
  StaticParam,
  RouteNode,
  RouteCollision,
  RouteTree,
  DesignRouteMatch,
  I18nConfig,
} from "./types.js";

export type { ParsedRouteSegment } from "./segments.js";

// ---------------------------------------------------------------------------
// Manifest persistence helpers (used by compiler)
// ---------------------------------------------------------------------------

export async function writeRouteManifest(
  manifest: import("./types.js").RouteManifest,
  outputDir: string
): Promise<void> {
  await mkdir(outputDir, { recursive: true });
  await writeFile(
    path.join(outputDir, "route-manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf8"
  );
}

export async function readRouteManifest(outputDir: string): Promise<import("./types.js").RouteManifest> {
  const raw = await readFile(
    path.join(outputDir, "route-manifest.json"),
    "utf8"
  );
  return JSON.parse(raw) as import("./types.js").RouteManifest;
}
