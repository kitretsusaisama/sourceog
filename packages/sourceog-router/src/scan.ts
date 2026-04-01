import { promises as fs } from "node:fs";
import path from "node:path";
import type { ResolvedSourceOGConfig } from "@sourceog/platform";
import {
  createDiagnosticsEnvelope,
  SOURCEOG_MANIFEST_VERSION,
  SourceOGError,
  SOURCEOG_ERROR_CODES,
  type DiagnosticIssue
} from "@sourceog/runtime";
import { buildPathname, parseSegment } from "./segments.js";
import type {
  RouteDefinition,
  RouteGraphDefinition,
  RouteManifest,
  RouteSegment
} from "./types.js";

interface WalkState {
  segments: RouteSegment[];
  layouts: string[];
  middlewareFiles: string[];
  templateFile?: string;
  errorFile?: string;
  loadingFile?: string;
  notFoundFile?: string;
}

function computeScore(segments: RouteSegment[]): number {
  return segments.reduce((total, segment) => {
    switch (segment.kind) {
      case "static": return total + 100;
      case "dynamic": return total + 10;
      case "catchall": return total + 1;
      case "optional-catchall": return total;
      default: return total;
    }
  }, 0);
}

export async function scanRoutes(config: ResolvedSourceOGConfig): Promise<RouteManifest> {
  const pages: RouteDefinition[] = [];
  const handlers: RouteDefinition[] = [];
  const layoutFiles = new Set<string>();
  const diagnostics: DiagnosticIssue[] = [];

  await walkDirectory(config.appRoot, {
    segments: [],
    layouts: [],
    middlewareFiles: []
  });

  pages.sort((left, right) => computeScore(right.segments) - computeScore(left.segments));
  handlers.sort((left, right) => computeScore(right.segments) - computeScore(left.segments));

  assertNoConflicts(pages);
  assertNoConflicts(handlers);

  return {
    version: SOURCEOG_MANIFEST_VERSION,
    appRoot: config.appRoot,
    pages,
    handlers,
    layoutFiles: [...layoutFiles],
    routeGraph: createRouteGraph([...pages, ...handlers]),
    generatedAt: new Date().toISOString(),
    diagnostics: createDiagnosticsEnvelope(diagnostics)
  };

  async function walkDirectory(directory: string, inherited: WalkState): Promise<void> {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const files = new Set(entries.filter((entry) => entry.isFile()).map((entry) => entry.name));

    const localLayout = files.has("layout.tsx") ? path.join(directory, "layout.tsx") : undefined;
    const localTemplate = files.has("template.tsx") ? path.join(directory, "template.tsx") : inherited.templateFile;
    const localError = files.has("error.tsx") ? path.join(directory, "error.tsx") : inherited.errorFile;
    const localLoading = files.has("loading.tsx") ? path.join(directory, "loading.tsx") : inherited.loadingFile;
    const localNotFound = files.has("not-found.tsx") ? path.join(directory, "not-found.tsx") : inherited.notFoundFile;
    const localMiddleware = files.has("middleware.ts") ? path.join(directory, "middleware.ts") : undefined;

    const nextLayouts = localLayout ? [...inherited.layouts, localLayout] : inherited.layouts;
    if (localLayout) {
      layoutFiles.add(localLayout);
    }

    const nextMiddleware = localMiddleware ? [...inherited.middlewareFiles, localMiddleware] : inherited.middlewareFiles;
    const pathname = buildPathname(inherited.segments);

    if (files.has("page.tsx")) {
      const slotName = findParallelSlotName(inherited.segments);
      const interceptTarget = findInterceptTarget(inherited.segments);
      const urlSegments = inherited.segments.filter((s) => s.pathAffectsRouting);
      pages.push({
        id: buildRouteId("page", pathname, slotName, interceptTarget),
        kind: "page",
        pathname,
        file: path.join(directory, "page.tsx"),
        slotName,
        isParallelSlot: Boolean(slotName),
        interceptTarget,
        isIntercepting: Boolean(interceptTarget),
        segmentPath: inherited.segments.map((segment) => segment.raw),
        segments: inherited.segments,
        urlSegments,
        score: computeScore(inherited.segments),
        layouts: nextLayouts,
        templateFile: localTemplate,
        errorFile: localError,
        loadingFile: localLoading,
        notFoundFile: localNotFound,
        middlewareFiles: nextMiddleware,
        capabilities: buildCapabilities(inherited.segments, nextMiddleware),
        modules: {
          page: path.join(directory, "page.tsx"),
          layouts: nextLayouts,
          template: localTemplate,
          error: localError,
          loading: localLoading,
          notFound: localNotFound,
          middleware: nextMiddleware
        }
      });
    }

    if (files.has("route.ts")) {
      const slotName = findParallelSlotName(inherited.segments);
      const interceptTarget = findInterceptTarget(inherited.segments);
      const urlSegments = inherited.segments.filter((s) => s.pathAffectsRouting);
      handlers.push({
        id: buildRouteId("route", pathname, slotName, interceptTarget),
        kind: "route",
        pathname,
        file: path.join(directory, "route.ts"),
        slotName,
        isParallelSlot: Boolean(slotName),
        interceptTarget,
        isIntercepting: Boolean(interceptTarget),
        segmentPath: inherited.segments.map((segment) => segment.raw),
        segments: inherited.segments,
        urlSegments,
        score: computeScore(inherited.segments),
        layouts: nextLayouts,
        templateFile: localTemplate,
        errorFile: localError,
        loadingFile: localLoading,
        notFoundFile: localNotFound,
        middlewareFiles: nextMiddleware,
        capabilities: buildCapabilities(inherited.segments, nextMiddleware, true),
        modules: {
          route: path.join(directory, "route.ts"),
          layouts: nextLayouts,
          template: localTemplate,
          error: localError,
          loading: localLoading,
          notFound: localNotFound,
          middleware: nextMiddleware
        }
      });
    }

    for (const entry of entries.filter((item) => item.isDirectory())) {
      const segment = parseSegment(entry.name);
      await walkDirectory(path.join(directory, entry.name), {
        segments: [...inherited.segments, segment],
        layouts: nextLayouts,
        middlewareFiles: nextMiddleware,
        templateFile: localTemplate,
        errorFile: localError,
        loadingFile: localLoading,
        notFoundFile: localNotFound
      });
    }
  }
}

function buildCapabilities(segments: RouteSegment[], middlewareFiles: string[], isRouteHandler = false): RouteDefinition["capabilities"] {
  const capabilities: RouteDefinition["capabilities"] = [];
  const hasDynamicSegment = segments.some((segment) => segment.kind !== "static");

  capabilities.push(hasDynamicSegment ? "dynamic-only" : "static-capable");
  if (!hasDynamicSegment && !isRouteHandler) {
    capabilities.push("export-capable");
  }
  capabilities.push("edge-capable");
  if (middlewareFiles.length > 0) {
    capabilities.push("middleware-bound");
  }

  return capabilities;
}

function assertNoConflicts(routes: RouteDefinition[]): void {
  const seen = new Map<string, string>();
  for (const route of routes) {
    const key = `${route.pathname}::${route.slotName ?? "children"}::${route.interceptTarget ?? "canonical"}`;
    const existing = seen.get(key);
    if (existing) {
      throw new SourceOGError(
        SOURCEOG_ERROR_CODES.ROUTE_CONFLICT,
        `Route conflict detected for "${key}".`,
        { files: [existing, route.file] }
      );
    }
    seen.set(key, route.file);
  }
}

function findParallelSlotName(segments: RouteSegment[]): string | undefined {
  return [...segments].reverse().find((segment) => segment.semanticKind === "parallel")?.slotName;
}

function findInterceptTarget(segments: RouteSegment[]): string | undefined {
  return [...segments].reverse().find((segment) => segment.semanticKind === "intercepting")?.interceptTarget;
}

function buildRouteId(
  kind: "page" | "route",
  pathname: string,
  slotName?: string,
  interceptTarget?: string
): string {
  const suffixParts = [
    slotName ? `slot:${slotName}` : undefined,
    interceptTarget ? `intercept:${interceptTarget}` : undefined
  ].filter((value): value is string => Boolean(value));

  return suffixParts.length > 0
    ? `${kind}:${pathname}#${suffixParts.join("#")}`
    : `${kind}:${pathname}`;
}

function createRouteGraph(routes: RouteDefinition[]): RouteGraphDefinition {
  const nodeMap = new Map<string, RouteGraphDefinition["nodes"][number]>();
  const routeEntries: RouteGraphDefinition["routes"] = [];

  nodeMap.set("root", {
    id: "root",
    kind: "root",
    pathname: "/",
    visible: true
  });

  for (const route of routes) {
    const segmentNodeIds: string[] = [];
    const fileNodeIds: string[] = [];
    const groupSegments: string[] = [];
    const slotSegments: string[] = [];
    const interceptSegments: string[] = [];

    for (let index = 0; index < route.segments.length; index += 1) {
      const segment = route.segments[index];
      const currentPath = route.segmentPath.slice(0, index + 1);
      const parentPath = route.segmentPath.slice(0, index);
      const nodeId = toSegmentNodeId(currentPath);
      const pathname = normalizeVisiblePathname(route.segments.slice(0, index + 1));

      if (!nodeMap.has(nodeId)) {
        nodeMap.set(nodeId, {
          id: nodeId,
          kind: toSegmentNodeKind(segment),
          parentId: toSegmentNodeId(parentPath),
          pathname,
          rawSegment: segment.raw,
          segmentValue: segment.value,
          visible: segment.pathAffectsRouting,
          slotName: segment.slotName,
          interceptTarget: segment.interceptTarget
        });
      }

      segmentNodeIds.push(nodeId);
      if (segment.semanticKind === "group") {
        groupSegments.push(segment.value);
      }
      if (segment.semanticKind === "parallel" && segment.slotName) {
        slotSegments.push(segment.slotName);
      }
      if (segment.semanticKind === "intercepting" && segment.interceptTarget) {
        interceptSegments.push(segment.interceptTarget);
      }
    }

    const leafParentId = segmentNodeIds.at(-1) ?? "root";
    const registerFileNode = (
      kind: RouteGraphDefinition["nodes"][number]["kind"],
      filePath: string | undefined,
      suffix: string
    ): void => {
      if (!filePath) {
        return;
      }

      const nodeId = `${kind}:${route.id}:${suffix}`;
      if (!nodeMap.has(nodeId)) {
        nodeMap.set(nodeId, {
          id: nodeId,
          kind,
          parentId: leafParentId,
          routeId: route.id,
          pathname: route.pathname,
          filePath,
          visible: true
        });
      }
      fileNodeIds.push(nodeId);
    };

    registerFileNode(route.kind === "page" ? "page" : "route", route.file, "entry");
    route.layouts.forEach((layoutFile, layoutIndex) => registerFileNode("layout", layoutFile, `${layoutIndex}`));
    registerFileNode("template", route.templateFile, "template");
    registerFileNode("loading", route.loadingFile, "loading");
    registerFileNode("error", route.errorFile, "error");
    registerFileNode("not-found", route.notFoundFile, "not-found");

    const primaryRouteId = routes.find((entry) =>
      entry.kind === route.kind &&
      entry.pathname === route.pathname &&
      !entry.isParallelSlot &&
      !entry.isIntercepting
    )?.id;
    const canonicalRouteId = primaryRouteId ?? route.id;

    routeEntries.push({
      routeId: route.id,
      canonicalRouteId,
      resolvedRouteId: route.id,
      pathname: route.pathname,
      kind: route.kind,
      slotName: route.slotName,
      slotDefaultRouteId: undefined,
      interceptTarget: route.interceptTarget,
      primaryRouteId: route.id === canonicalRouteId ? undefined : canonicalRouteId,
      renderContextKey: route.isIntercepting
        ? `intercept:${route.interceptTarget ?? "unknown"}`
        : route.slotName
          ? `slot:${route.slotName}`
          : `canonical:${route.pathname}`,
      materialized: !route.isParallelSlot && !route.isIntercepting,
      segmentNodeIds,
      fileNodeIds,
      groupSegments,
      slotSegments,
      interceptSegments
    });
  }

  return {
    nodes: [...nodeMap.values()],
    routes: routeEntries
  };
}

function normalizeVisiblePathname(segments: RouteSegment[]): string {
  const pathname = segments
    .map((segment) => segment.pathPart)
    .filter((segment): segment is string => Boolean(segment))
    .join("/");

  return pathname ? `/${pathname}` : "/";
}

function toSegmentNodeId(segmentPath: string[]): string {
  return segmentPath.length === 0 ? "root" : `segment:${segmentPath.join("/")}`;
}

function toSegmentNodeKind(segment: RouteSegment): RouteGraphDefinition["nodes"][number]["kind"] {
  switch (segment.semanticKind) {
    case "group":
      return "group";
    case "parallel":
      return "parallel";
    case "intercepting":
      return "intercepting";
    default:
      return "segment";
  }
}
