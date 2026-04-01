// ---------------------------------------------------------------------------
// Public Types (Pure Types — Erased at Compile Time)
// ---------------------------------------------------------------------------

// Types from pure utilities (No side effects)
export type {
  ClientManifestEntry,
  ClientManifestRecord,
} from "./rsc-worker-utils";

// Runtime functions from pure utilities
export {
  loadManifestFromPath,
  normalizeClientManifest,
  toError,
} from "./rsc-worker-utils";

// Types from worker core (Contains RSC logic, but safe as `export type`)
export type {
  WorkerRenderResponse,
} from "./rsc-worker-core";

// Types from main render pipeline (Contains React, but safe as `export type`)
export type {
  RenderedPage,
  RouteFlightPayload,
  DocumentClientAssets,
  FlightHtmlRenderResult,
} from "./render";

// Types from worker pool manager (Safe as `export type`)
export type {
  RscWorkerPoolStats,
} from "./rsc";

// ---------------------------------------------------------------------------
// Public Runtime Functions
// ---------------------------------------------------------------------------

// Main render pipeline functions
export {
  createDocumentHtml,
  renderRouteToCanonicalResult,
  renderRouteToFlightPayload,
  computeCanonicalRouteId,
  computeRenderContextKey,
} from "./render";

// Worker pool management
export {
  shutdownRscWorkerPool,
} from "./rsc";