import type { ConsistencyGraphManifest } from "../types/adosf.js";

export function createConsistencyGraphManifestFromRouteGraph(routeGraph: {
  routes: Array<{ routeId: string; pathname: string }>;
}): ConsistencyGraphManifest {
  const nodes = routeGraph.routes.map((route) => ({
    id: `route:${route.pathname}`,
    type: "route" as const,
    deps: [],
    dependents: [],
  }));

  return {
    version: "adosf-x/1",
    generatedAt: new Date().toISOString(),
    nodes,
    edges: [],
  };
}

export function serializeConsistencyGraphManifest(manifest: ConsistencyGraphManifest): string {
  return JSON.stringify(manifest, null, 2);
}
