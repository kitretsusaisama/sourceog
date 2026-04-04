import type { DiagnosticsEnvelope } from "@sourceog/runtime";
export type RenderMode = "ssr" | "ssg" | "isr" | "static" | "edge";
export interface RouteFiles {
    page?: string;
    layout?: string;
    template?: string;
    loading?: string;
    error?: string;
    notFound?: string;
    route?: string;
    default?: string;
}
export interface DesignRouteSegment {
    segment: string;
    type: "static" | "dynamic" | "catch-all" | "optional-catch-all" | "group" | "parallel" | "intercepting";
    fsPath: string;
    children: DesignRouteSegment[];
    files: RouteFiles;
    locale?: string;
}
export interface CachePolicy {
    ttl: number;
    swr: number;
    tags: string[];
    scope: "route" | "shared";
}
export interface StaticParam {
    [key: string]: string | string[];
}
export interface RouteNode {
    routeKey: string;
    pattern: string;
    segment: DesignRouteSegment;
    parent: RouteNode | null;
    children: RouteNode[];
    layoutChain: string[];
    renderMode: RenderMode;
    staticParams?: StaticParam[][];
    cachePolicy?: CachePolicy;
    edgeCompatible: boolean;
    locale?: string;
}
export interface RouteCollision {
    a: RouteNode;
    b: RouteNode;
}
export interface RouteTree {
    root: RouteNode;
    index: Map<string, RouteNode>;
    localeVariants: Map<string, RouteNode[]>;
    collisions: RouteCollision[];
}
export interface DesignRouteMatch {
    pattern: string;
    params: Record<string, string | string[]>;
    segments: DesignRouteSegment[];
    layoutChain: string[];
    renderMode: RenderMode;
    locale?: string;
    routeKey: string;
}
export interface I18nConfig {
    locales: string[];
    defaultLocale: string;
    localeDetection?: "header" | "cookie" | "path" | "none";
    localePrefix?: "always" | "as-needed" | "never";
    localePathnames?: Record<string, string>;
    messages?: Record<string, () => Promise<unknown>>;
}
export type SegmentKind = "static" | "dynamic" | "catchall" | "optional-catchall";
export type RouteSegmentSemanticKind = "static" | "dynamic" | "catchall" | "optional-catchall" | "group" | "parallel" | "intercepting" | "invalid";
export type RouteCapability = "static-capable" | "dynamic-only" | "edge-capable" | "export-capable" | "middleware-bound" | "static-params-capable";
export type RouteKind = "page" | "route";
export type RouteRenderContext = "canonical" | "intercepted";
export interface RouteSegment {
    raw: string;
    value: string;
    kind: SegmentKind;
    pathPart: string | null;
    semanticKind: RouteSegmentSemanticKind;
    pathAffectsRouting: boolean;
    slotName?: string;
    interceptTarget?: string;
    isValid?: boolean;
}
export interface RouteModuleFiles {
    page?: string;
    route?: string;
    layouts: string[];
    template?: string;
    error?: string;
    loading?: string;
    notFound?: string;
    default?: string;
    middleware: string[];
}
export interface RouteDynamicInfo {
    hasDynamicParams: boolean;
    hasCatchAll: boolean;
    hasOptionalCatchAll: boolean;
    paramKeys: string[];
    staticParamEligible: boolean;
    specificityScore: number;
}
export interface RouteDiscoveryInfo {
    manifestKey: string;
    patchKey: string;
    lazy: boolean;
}
export interface RouteDefinition {
    id: string;
    kind: RouteKind;
    pathname: string;
    file: string;
    slotName?: string;
    isParallelSlot: boolean;
    interceptTarget?: string;
    isIntercepting: boolean;
    segmentPath: string[];
    segments: RouteSegment[];
    layouts: string[];
    templateFile?: string;
    errorFile?: string;
    loadingFile?: string;
    notFoundFile?: string;
    defaultFile?: string;
    middlewareFiles: string[];
    capabilities: RouteCapability[];
    dynamicInfo?: RouteDynamicInfo;
    modules: RouteModuleFiles;
    urlSegments: RouteSegment[];
    score: number;
    renderMode?: "ssg" | "isr" | "csr" | "server";
}
export interface RouteGraphNodeDefinition {
    id: string;
    kind: "root" | "segment" | "group" | "parallel" | "intercepting" | "page" | "layout" | "template" | "loading" | "error" | "not-found" | "default" | "route";
    parentId?: string;
    routeId?: string;
    pathname: string;
    rawSegment?: string;
    segmentValue?: string;
    visible: boolean;
    slotName?: string;
    interceptTarget?: string;
    filePath?: string;
}
export interface RouteGraphRouteDefinition {
    routeId: string;
    canonicalRouteId: string;
    resolvedRouteId: string;
    pathname: string;
    kind: RouteKind;
    slotName?: string;
    slotDefaultRouteId?: string;
    interceptTarget?: string;
    primaryRouteId?: string;
    renderContextKey: string;
    materialized: boolean;
    segmentNodeIds: string[];
    fileNodeIds: string[];
    groupSegments: string[];
    slotSegments: string[];
    interceptSegments: string[];
    discovery?: RouteDiscoveryInfo;
}
export interface RouteGraphDefinition {
    nodes: RouteGraphNodeDefinition[];
    routes: RouteGraphRouteDefinition[];
}
export interface RouteManifest {
    version: string | number;
    appRoot: string;
    pages: RouteDefinition[];
    handlers: RouteDefinition[];
    layoutFiles: string[];
    routeGraph: RouteGraphDefinition;
    generatedAt: string;
    diagnostics: DiagnosticsEnvelope;
}
export interface RouteMatch {
    route: RouteDefinition;
    params: Record<string, string | string[]>;
    parallelRoutes: Record<string, RouteDefinition>;
    parallelRouteMap: Record<string, string>;
    canonicalRouteId: string;
    resolvedRouteId: string;
    renderContextKey: string;
    renderContext: RouteRenderContext;
    intercepted: boolean;
}
export interface RouteGraphLookup {
    nodesById: Map<string, RouteGraphNodeDefinition>;
    routesById: Map<string, RouteGraphRouteDefinition>;
}
export interface RouteScanResult {
    manifest: RouteManifest;
    lookup?: RouteGraphLookup;
}
