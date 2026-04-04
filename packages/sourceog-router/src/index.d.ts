export { scanRoutes } from "./scan.js";
export { matchPageRoute, matchHandlerRoute } from "./match.js";
export { parseSegment, buildPathname, routeSortWeight, normalizeSegments } from "./segments.js";
export { rankRoutes } from "./rank.js";
export { applyI18nExpansion } from "./i18n.js";
export type { RouteSegment, RouteSegmentSemanticKind, SegmentKind, RouteCapability, RouteKind, RouteRenderContext, RouteDefinition, RouteModuleFiles, RouteDynamicInfo, RouteDiscoveryInfo, RouteManifest, RouteMatch, RouteGraphNodeDefinition, RouteGraphRouteDefinition, RouteGraphDefinition, RouteGraphLookup, RouteScanResult, RenderMode, RouteFiles, DesignRouteSegment, CachePolicy, StaticParam, RouteNode, RouteCollision, RouteTree, DesignRouteMatch, I18nConfig, } from "./types.js";
export type { ParsedRouteSegment } from "./segments.js";
export declare function writeRouteManifest(manifest: import("./types.js").RouteManifest, outputDir: string): Promise<void>;
export declare function readRouteManifest(outputDir: string): Promise<import("./types.js").RouteManifest>;
