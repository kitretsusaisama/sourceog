import type { ControlPlaneManifest, ConsistencyGraphManifest, TunerSnapshotManifest } from "../types/adosf.js";

export interface AdosfDebugSnapshot {
  controlPlane?: ControlPlaneManifest;
  consistencyGraph?: ConsistencyGraphManifest;
  tuner?: TunerSnapshotManifest;
}

export function createDebugPayload(snapshot: AdosfDebugSnapshot): Record<string, unknown> {
  return {
    generatedAt: new Date().toISOString(),
    controlPlaneRoutes: snapshot.controlPlane?.entries.length ?? 0,
    graphNodes: snapshot.consistencyGraph?.nodes.length ?? 0,
    graphEdges: snapshot.consistencyGraph?.edges.length ?? 0,
    tunerRoutes: Object.keys(snapshot.tuner?.routeHints ?? {}).length,
    snapshot,
  };
}
