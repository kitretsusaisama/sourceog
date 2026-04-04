export type RenderStrategy = "stream" | "cache" | "hybrid";

export type QueuePriority = "critical" | "high" | "normal" | "low";

export type RuntimeTarget = "node" | "edge";

export type CachePosture = "hot" | "warm" | "cold";

export type HydrationPosture = "server-only" | "incremental-flight" | "client-root";

export type InvalidationMode = "graph" | "compat-path" | "compat-tag";

export type FallbackStage =
  | "full-stream"
  | "incremental-stream"
  | "hybrid-cache"
  | "cache-serve"
  | "shell-only"
  | "typed-error";

export type SafetyProfile = "strict" | "balanced" | "latency-biased" | "resilience-biased";

export type RouteClass =
  | "static"
  | "semi-static"
  | "auth-sensitive"
  | "mutation-heavy"
  | "latency-critical"
  | "edge-friendly"
  | "graph-hot";

export type TrafficSegment =
  | "anonymous"
  | "authenticated"
  | "bot"
  | "warm-cache"
  | "cold-cache"
  | "degraded-mode";

export interface ControlPlaneRouteInput {
  id: string;
  pathname: string;
  kind?: "page" | "route";
  capabilities?: string[];
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface ControlPlaneRequestInput {
  pathname: string;
  isAuthenticated?: boolean;
  headers?: Record<string, string>;
  runtimeTargetHint?: RuntimeTarget;
  degraded?: boolean;
}

export interface RenderDecision {
  strategy: RenderStrategy;
  cachePosture: CachePosture;
  runtimeTarget: RuntimeTarget;
  queuePriority: QueuePriority;
  hydrationPosture: HydrationPosture;
  invalidationMode: InvalidationMode;
  fallbackLadder: FallbackStage[];
  observabilitySampleRate: number;
  safetyProfile: SafetyProfile;
  ttlSeconds: number | null;
  routeClass: RouteClass;
  trafficSegment: TrafficSegment;
  reason: string;
}

export interface RenderOutcomeMetrics {
  routeId: string;
  durationMs: number;
  cacheHit: boolean;
  queueDepth?: number;
  workerRecycled?: boolean;
  errorCode?: string;
}

export interface RouteMetrics {
  routeId: string;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  cacheHitRate: number;
  errorRate: number;
  queueDepth: number;
  cpuUsage: number;
  memUsageMb: number;
  workerRecycles: number;
}

export interface TuningHints {
  cacheTTL?: number;
  runtimeTarget?: RuntimeTarget;
  queuePriority?: QueuePriority;
  preferStrategy?: RenderStrategy;
  pinRoute?: boolean;
  degradeTo?: FallbackStage;
  explainability: string[];
}

export interface DecisionTraceEntry {
  routeId: string;
  pathname: string;
  generatedAt: string;
  baseDecision: RenderDecision;
  tunedDecision: RenderDecision;
  hints: TuningHints | null;
}

export interface ControlPlaneManifestEntry {
  routeId: string;
  pathname: string;
  decision: RenderDecision;
}

export interface ControlPlaneManifest {
  version: string;
  generatedAt: string;
  entries: ControlPlaneManifestEntry[];
}

export type GraphNodeType = "data" | "component" | "route" | "optimistic";

export interface GraphNode {
  id: string;
  type: GraphNodeType;
  deps: string[];
  dependents: string[];
  lastInvalidated?: number;
  quarantined?: boolean;
}

export interface GraphEdge {
  from: string;
  to: string;
}

export interface ConsistencyGraphManifest {
  version: string;
  generatedAt: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface InvalidationResult {
  affected: string[];
  serverRoutes: string[];
  clientNodes: string[];
  cacheKeys: string[];
  propagationMs: number;
}

export interface OptimisticAction<TState> {
  id: string;
  resourceId: string;
  apply(state: TState): TState;
  reconcile?(optimisticState: TState, serverPayload: unknown): TState;
  rollback?(optimisticState: TState, error: unknown): TState;
}

export interface PatchLogEntry {
  actionId: string;
  resourceId: string;
  appliedAt: number;
  status: "pending" | "resolved" | "rolled-back" | "conflict";
}

export interface TunerSnapshotManifest {
  version: string;
  generatedAt: string;
  routeHints: Record<string, TuningHints>;
  decisionTraces: DecisionTraceEntry[];
}

export interface MetricsSnapshot {
  counters: Array<{ name: string; labels: Record<string, string>; value: number }>;
  gauges: Array<{ name: string; labels: Record<string, string>; value: number }>;
  histograms: Array<{ name: string; labels: Record<string, string>; count: number; sum: number }>;
}
