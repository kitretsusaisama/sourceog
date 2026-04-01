// packages/sourceog-router/src/match.ts
import type {
  RouteDefinition,
  RouteManifest,
  RouteMatch,
  RouteSegment
} from "./types.js";

export function matchPageRoute(
  manifest: RouteManifest,
  pathname: string,
  options?: MatchRouteOptions
): RouteMatch | null {
  return matchRouteCollection(manifest, manifest.pages, pathname, options);
}

export function matchHandlerRoute(
  manifest: RouteManifest,
  pathname: string,
  options?: MatchRouteOptions
): RouteMatch | null {
  return matchRouteCollection(manifest, manifest.handlers, pathname, options);
}

export interface MatchRouteOptions {
  intercept?: boolean;
  preferredSlotNames?: string[];
}

interface CandidateMatch {
  route: RouteDefinition;
  graph: RouteManifest["routeGraph"]["routes"][number];
  params: Record<string, string | string[]>;
  score: number;
}

function matchRouteCollection(
  manifest: RouteManifest,
  routes: RouteDefinition[],
  pathname: string,
  options?: MatchRouteOptions
): RouteMatch | null {
  const normalizedPathname = normalizePathname(pathname);
  const pathSegments = normalizedPathname.split("/").filter(Boolean);

  const matchingCandidates: CandidateMatch[] = [];

  for (const route of routes) {
    const params = matchSegments(route.segments, pathSegments);
    if (!params) {
      continue;
    }

    const graph = manifest.routeGraph.routes.find((entry) => entry.routeId === route.id);
    if (!graph) {
      continue;
    }

    const score = scoreRouteMatch(route.segments, graph, options);
    matchingCandidates.push({ route, graph, params, score });
  }

  if (matchingCandidates.length === 0) {
    return null;
  }

  matchingCandidates.sort(compareCandidates);

  const primaryMatch = selectPrimaryMatch(matchingCandidates, options);
  const relatedParallelCandidates = selectParallelCandidates(
    matchingCandidates,
    primaryMatch,
    options
  );

  const parallelRoutes = Object.fromEntries(
    relatedParallelCandidates.map((candidate) => [candidate.graph.slotName!, candidate.route])
  );

  const parallelRouteMap = Object.fromEntries(
    relatedParallelCandidates.map((candidate) => [candidate.graph.slotName!, candidate.route.id])
  );

  return {
    route: primaryMatch.route,
    params: primaryMatch.params,
    parallelRoutes,
    parallelRouteMap,
    canonicalRouteId: primaryMatch.graph.canonicalRouteId,
    resolvedRouteId: primaryMatch.graph.resolvedRouteId,
    renderContextKey: primaryMatch.graph.renderContextKey,
    renderContext: primaryMatch.graph.interceptTarget ? "intercepted" : "canonical",
    intercepted: Boolean(primaryMatch.graph.interceptTarget)
  };
}

function selectPrimaryMatch(
  candidates: CandidateMatch[],
  options?: MatchRouteOptions
): CandidateMatch {
  const interceptMode = Boolean(options?.intercept);

  return (
    candidates.find((candidate) =>
      !candidate.graph.slotName &&
      Boolean(candidate.graph.interceptTarget) === interceptMode
    ) ??
    candidates.find((candidate) =>
      !candidate.graph.slotName &&
      !candidate.graph.interceptTarget
    ) ??
    candidates.find((candidate) => !candidate.route.isParallelSlot) ??
    candidates[0]
  );
}

function selectParallelCandidates(
  candidates: CandidateMatch[],
  primaryMatch: CandidateMatch,
  options?: MatchRouteOptions
): CandidateMatch[] {
  const preferredSlotNames = new Set(options?.preferredSlotNames ?? []);

  const parallelCandidates = candidates.filter((candidate) =>
    candidate.graph.slotName &&
    candidate.graph.canonicalRouteId === primaryMatch.graph.canonicalRouteId &&
    candidate.graph.interceptTarget === primaryMatch.graph.interceptTarget
  );

  if (preferredSlotNames.size === 0) {
    return parallelCandidates;
  }

  return parallelCandidates.filter((candidate) =>
    candidate.graph.slotName ? preferredSlotNames.has(candidate.graph.slotName) : false
  );
}

function compareCandidates(left: CandidateMatch, right: CandidateMatch): number {
  if (right.score !== left.score) {
    return right.score - left.score;
  }

  if (right.route.segments.length !== left.route.segments.length) {
    return right.route.segments.length - left.route.segments.length;
  }

  if (left.route.isParallelSlot !== right.route.isParallelSlot) {
    return left.route.isParallelSlot ? 1 : -1;
  }

  if (left.route.isIntercepting !== right.route.isIntercepting) {
    return left.route.isIntercepting ? 1 : -1;
  }

  return left.route.id.localeCompare(right.route.id);
}

function scoreRouteMatch(
  segments: RouteSegment[],
  graph: RouteManifest["routeGraph"]["routes"][number],
  options?: MatchRouteOptions
): number {
  let score = 0;

  for (const segment of segments) {
    if (!segment.pathAffectsRouting) {
      score += 2;
      continue;
    }

    switch (segment.kind) {
      case "static":
        score += 100;
        break;
      case "dynamic":
        score += 20;
        break;
      case "catchall":
        score += 5;
        break;
      case "optional-catchall":
        score += 1;
        break;
      default:
        score += 0;
        break;
    }

    switch (segment.semanticKind) {
      case "group":
        score += 1;
        break;
      case "parallel":
        score -= 2;
        break;
      case "intercepting":
        score += Boolean(options?.intercept) ? 25 : -10;
        break;
      default:
        break;
    }
  }

  if (!graph.slotName) {
    score += 10;
  }

  if (!graph.interceptTarget) {
    score += 5;
  } else if (options?.intercept) {
    score += 15;
  }

  return score;
}

function matchSegments(
  routeSegments: RouteSegment[],
  pathSegments: string[]
): Record<string, string | string[]> | null {
  const params: Record<string, string | string[]> = {};
  let pathIndex = 0;

  for (let routeIndex = 0; routeIndex < routeSegments.length; routeIndex += 1) {
    const segment = routeSegments[routeIndex];

    if (segment.pathPart === null && segment.kind === "static") {
      continue;
    }

    if (segment.kind === "static") {
      if (pathSegments[pathIndex] !== segment.value) {
        return null;
      }
      pathIndex += 1;
      continue;
    }

    if (segment.kind === "dynamic") {
      const value = pathSegments[pathIndex];
      if (!value) {
        return null;
      }
      params[segment.value] = decodeURIComponent(value);
      pathIndex += 1;
      continue;
    }

    if (segment.kind === "catchall") {
      const value = pathSegments.slice(pathIndex).map((item) => decodeURIComponent(item));
      if (value.length === 0) {
        return null;
      }
      params[segment.value] = value;
      pathIndex = pathSegments.length;
      continue;
    }

    if (segment.kind === "optional-catchall") {
      const value = pathSegments.slice(pathIndex).map((item) => decodeURIComponent(item));
      params[segment.value] = value;
      pathIndex = pathSegments.length;
      continue;
    }
  }

  return pathIndex === pathSegments.length ? params : null;
}

function normalizePathname(pathname: string): string {
  if (!pathname) {
    return "/";
  }

  const withoutQuery = pathname.split("?")[0]?.split("#")[0] ?? "/";
  const normalized = withoutQuery.startsWith("/") ? withoutQuery : `/${withoutQuery}`;
  return normalized !== "/" ? normalized.replace(/\/+$/, "") || "/" : "/";
}
