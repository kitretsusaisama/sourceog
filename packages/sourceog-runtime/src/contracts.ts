export const SOURCEOG_MANIFEST_VERSION = "2027.1";

export type StabilityLevel = "stable" | "experimental" | "internal";
export type DiagnosticLevel = "info" | "warn" | "error";
export type ArtifactMode = "strict" | "dev-compiled" | "test-harness";

export interface DiagnosticIssue {
  level: DiagnosticLevel;
  code: string;
  message: string;
  file?: string;
  pathname?: string;
  recoveryHint?: string;
  details?: Record<string, unknown>;
}

export interface DiagnosticsEnvelope {
  version: string;
  buildId: string;
  generatedAt: string;
  issues: DiagnosticIssue[];
}

export interface RenderManifestEntry {
  routeId: string;
  pathname: string;
  kind: "page" | "route";
  runtime: "node" | "edge" | "auto";
  dynamic: "force-static" | "force-dynamic" | "auto";
  revalidate?: number;
  prerendered: boolean;
}

export interface RenderManifest {
  version: string;
  buildId: string;
  generatedAt: string;
  entries: RenderManifestEntry[];
}

export interface RouteGraphNode {
  id: string;
  kind:
    | "root"
    | "segment"
    | "group"
    | "parallel"
    | "intercepting"
    | "page"
    | "layout"
    | "template"
    | "loading"
    | "error"
    | "not-found"
    | "default"
    | "route";
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

export interface RouteGraphRouteEntry {
  routeId: string;
  canonicalRouteId: string;
  resolvedRouteId: string;
  pathname: string;
  kind: "page" | "route";
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
}

export interface RouteGraphManifest {
  version: string;
  buildId: string;
  generatedAt: string;
  nodes: RouteGraphNode[];
  routes: RouteGraphRouteEntry[];
}

export interface ClientBoundaryDescriptor {
  boundaryId: string;
  routeId: string;
  moduleId?: string;
  exportName?: string;
  filePath?: string;
  selector?: string;
  propsEncoding?: "uri-json";
  assetFilePath?: string;
  assetHref?: string;
  bootstrapStrategy?: "hydrate-root" | "hydrate-island";
}

export interface ClientBoundaryManifestEntry {
  routeId: string;
  pathname: string;
  hydrationMode: "none" | "full-route" | "mixed-route";
  boundaries: ClientBoundaryDescriptor[];
}

export interface ClientBoundaryManifest {
  version: string;
  buildId: string;
  generatedAt: string;
  entries: ClientBoundaryManifestEntry[];
}

export type RouteRenderMode = "server-components" | "client-root";

export interface FlightRenderSegment {
  kind: "layout" | "template" | "page" | "parallel-page";
  routeId: string;
  filePath: string;
  pathname: string;
  segmentKey: string;
  slotName?: string;
}

export interface FlightRenderTreeNode {
  id: string;
  kind: "root" | "layout" | "template" | "page" | "parallel-slot" | "parallel-page";
  routeId: string;
  pathname: string;
  filePath?: string;
  segmentKey: string;
  slotName?: string;
  boundaryIds: string[];
  children: FlightRenderTreeNode[];
}

export interface FlightManifestRefs {
  runtimeHref?: string;
  routeAssetHref?: string;
  metadataHref?: string;
  entryAssetHref?: string;
  sharedChunkHrefs: string[];
  boundaryAssetHrefs: string[];
  actionIds: string[];
}

export interface ClientReferenceRef {
  referenceId: string;
  moduleId: string;
  filePath?: string;
  routeIds: string[];
  runtimeTargets: Array<"node" | "edge">;
  manifestKey?: string;
  exportName?: string;
  chunks?: string[];
}

export interface RouteRenderIdentity {
  canonicalRouteId: string;
  resolvedRouteId: string;
  renderContextKey: string;
  renderContext: "canonical" | "intercepted";
  intercepted: boolean;
  parallelRouteMap: Record<string, string>;
}

export interface CanonicalRenderResult {
  routeId?: string;
  pathname: string;
  canonicalRouteId: string;
  resolvedRouteId: string;
  renderContextKey: string;
  renderContext: "canonical" | "intercepted";
  intercepted: boolean;
  parallelRouteMap: Record<string, string>;
  renderMode: RouteRenderMode;
  headHtml: string;
  shellHtmlStart: string;
  shellHtmlEnd: string;
  shellMode: "document" | "fragment";
  bodyHtml: string;
  rscPayloadFormat: "none" | "react-flight-text";
  rscPayloadChunks: string[];
  renderedSegments: FlightRenderSegment[];
  serverTree: FlightRenderTreeNode;
  boundaryRefs: ClientBoundaryDescriptor[];
  clientReferenceRefs: ClientReferenceRef[];
  flightManifestRefs: FlightManifestRefs;
  actionEntries: Array<{
    actionId: string;
    exportName: string;
    runtime: "node" | "edge";
    refreshPolicy: "none" | "refresh-current-route-on-revalidate";
    revalidationPolicy: "none" | "track-runtime-revalidation";
  }>;
}

export interface ClientRouteSnapshot {
  version: string;
  routeId?: string;
  pathname: string;
  canonicalRouteId: string;
  resolvedRouteId: string;
  renderContextKey: string;
  renderContext: "canonical" | "intercepted";
  intercepted: boolean;
  parallelRouteMap: Record<string, string>;
  headHtml: string;
  bodyHtml: string;
  shellHtmlStart: string;
  shellHtmlEnd: string;
  shellMode: "document" | "fragment";
  renderedSegments: FlightRenderSegment[];
  serverTree: FlightRenderTreeNode;
  rscPayloadFormat: "none" | "react-flight-text";
  rscPayloadChunks: string[];
  renderMode: RouteRenderMode;
  hydrationMode: "none" | "full-route" | "mixed-route";
  runtimeHref?: string;
  routeAssetHref?: string;
  metadataHref?: string;
  entryAssetHref?: string;
  clientReferenceManifestUrl?: string;
  flightHref?: string;
  flightManifestRefs: FlightManifestRefs;
  boundaryRefs: ClientBoundaryDescriptor[];
  clientReferenceRefs: ClientReferenceRef[];
  sharedChunkHrefs: string[];
  preloadHrefs: string[];
  actionEntries: Array<{
    actionId: string;
    exportName: string;
    runtime: "node" | "edge";
    refreshPolicy: "none" | "refresh-current-route-on-revalidate";
    revalidationPolicy: "none" | "track-runtime-revalidation";
  }>;
}

export interface BundleManifest {
  version: string;
  buildId: string;
  generatedAt: string;
  runtimeAsset: string;
  routes: Array<{
    routeId: string;
    pathname: string;
    serverEntry: string;
    clientEntries: string[];
    middlewareEntries: string[];
    generatedClientEntry?: string;
    declaredClientAsset?: string;
    browserEntryAsset?: string;
    chunkName?: string;
    ownedFiles?: string[];
    routeChunkIds?: string[];
    sharedChunkIds?: string[];
    preloadAssets?: string[];
    hydrationMode?: "none" | "full-route" | "mixed-route";
    renderMode?: RouteRenderMode;
    clientBoundaryFiles?: string[];
    clientBoundaryModuleIds?: string[];
    clientReferenceRefs?: ClientReferenceRef[];
    boundaryRefs?: ClientBoundaryDescriptor[];
    actionIds?: string[];
    actionEntries?: Array<{ actionId: string; exportName: string; runtime: "node" | "edge" }>;
  }>;
}

export interface AdapterManifest {
  version: string;
  buildId: string;
  generatedAt: string;
  defaultRuntime: "node";
  selectedAdapter: string;
  capabilityChecked: boolean;
  supportedAdapters: Array<"node" | "cloudflare" | "vercel-node" | "vercel-edge">;
  supportedFeatures: string[];
  unsupportedFeatures: string[];
  warnings: string[];
}

export interface RouteOwnershipManifestEntry {
  routeId: string;
  pathname: string;
  kind: "page" | "route";
  files: string[];
  chunkName: string;
  generatedClientEntry?: string;
  declaredClientAsset?: string;
  browserEntryAsset?: string;
  metadataAsset?: string;
  ownershipHash?: string;
  routeChunkIds?: string[];
  sharedChunkIds?: string[];
  hydrationMode?: "none" | "full-route" | "mixed-route";
  renderMode?: RouteRenderMode;
  clientBoundaryFiles?: string[];
  clientBoundaryModuleIds?: string[];
  clientReferenceRefs?: ClientReferenceRef[];
  boundaryRefs?: ClientBoundaryDescriptor[];
  actionIds?: string[];
  actionEntries?: Array<{ actionId: string; exportName: string; runtime: "node" | "edge" }>;
}

export interface RouteOwnershipManifest {
  version: string;
  buildId: string;
  generatedAt: string;
  entries: RouteOwnershipManifestEntry[];
}

export interface AssetManifestEntry {
  kind: "runtime" | "client-entry" | "client-browser-entry" | "client-boundary-entry" | "client-metadata" | "shared-chunk" | "prerendered" | "flight" | "public";
  filePath: string;
  routeId?: string;
  pathname?: string;
  chunkId?: string;
  routeIds?: string[];
}

export interface AssetManifest {
  version: string;
  buildId: string;
  generatedAt: string;
  runtimeAsset: string;
  assets: AssetManifestEntry[];
}

export interface PrerenderManifestEntry {
  routeId: string;
  pathname: string;
  filePath: string;
  flightFilePath?: string;
  revalidate?: number;
  invalidated?: boolean;
  hash: string;
  generatedAt: string;
  tags: string[];
}

export interface PrerenderManifest {
  version: string;
  buildId: string;
  generatedAt: string;
  prerendered: PrerenderManifestEntry[];
}

export interface CacheManifestEntry {
  cacheKey: string;
  kind: "route" | "data";
  scope: "route" | "shared";
  source: "prerender" | "runtime-fetch";
  routeId?: string;
  pathname?: string;
  tags: string[];
  linkedRouteIds: string[];
  linkedTagIds: string[];
  revalidate?: number;
  actionIds: string[];
}

export interface CacheManifestInvalidationLink {
  actionId: string;
  routeIds: string[];
  pathnames: string[];
  targetCacheKeys: string[];
  tags: string[];
  refreshPolicy: "none" | "refresh-current-route-on-revalidate";
  revalidationPolicy: "none" | "track-runtime-revalidation";
}

export interface CacheManifest {
  version: string;
  buildId: string;
  generatedAt: string;
  entries: CacheManifestEntry[];
  invalidationLinks: CacheManifestInvalidationLink[];
}

export interface DeploymentManifestRoute {
  routeId: string;
  pathname: string;
  kind: "page" | "route";
  runtime: "node" | "edge" | "auto";
  prerendered: boolean;
  edgeCompatible: boolean;
  supportedRuntimeTargets?: Array<"node" | "edge">;
  unsupportedRuntimeReasons?: RuntimeCapabilityIssue[];
}

export interface DeploymentManifest {
  version: string;
  buildId: string;
  generatedAt: string;
  stability: StabilityLevel;
  routes: DeploymentManifestRoute[];
  manifests: {
    routeManifest: string;
    routeGraphManifest: string;
    renderManifest: string;
    bundleManifest: string;
    routeOwnershipManifest: string;
    assetManifest: string;
    adapterManifest: string;
    diagnosticsManifest: string;
    prerenderManifest: string;
    cacheManifest: string;
    controlPlaneManifest?: string;
    consistencyGraphManifest?: string;
    tunerSnapshotManifest?: string;
    policyReplayManifest?: string;
    automationManifest: string;
    clientManifest: string;
    clientReferenceManifest: string;
    clientBoundaryManifest: string;
    rscReferenceManifest: string;
    serverReferenceManifest: string;
    actionManifest: string;
    artifactSignatureManifest?: string;
    deploymentSignatureManifest?: string;
    doctorBaselineManifest?: string;
    governanceAuditManifest?: string;
    releaseEvidenceIndexManifest?: string;
  };
}

export interface ArtifactSignatureManifestEntry {
  kind: string;
  filePath: string;
  sha256: string;
  bytes: number;
}

export interface ArtifactSignatureManifest {
  version: string;
  buildId: string;
  generatedAt: string;
  signatures: {
    compiler: string;
    runtime: string;
    deployment: string;
  };
  artifacts: ArtifactSignatureManifestEntry[];
}

export interface DeploymentSignatureManifest {
  version: string;
  buildId: string;
  generatedAt: string;
  artifactSignatureManifestPath: string;
  deploymentManifestPath: string;
  runtimeFingerprint: string;
  selectedAdapter: string;
  routeCount: number;
  manifestCount: number;
  signatures: {
    compiler: string;
    runtime: string;
    deployment: string;
  };
}

export interface DoctorBaselineManifest {
  version: string;
  buildId: string;
  generatedAt: string;
  routeCount: number;
  pageRouteCount: number;
  handlerRouteCount: number;
  prerenderedRouteCount: number;
  clientReferenceCount: number;
  actionCount: number;
  manifestNames: string[];
}

export interface PolicyReplayManifest {
  version: string;
  buildId: string;
  generatedAt: string;
  objective: "latency" | "throughput" | "cost" | "stability";
  reducerPhases: string[];
  loopNames: string[];
  controlPlaneManifestPath: string;
  tunerSnapshotManifestPath: string;
  routeDecisions: Array<{
    routeId: string;
    pathname: string;
    strategy: string;
    runtimeTarget: string;
    queuePriority: string;
    ttlSeconds: number | null;
    reason: string;
  }>;
}

export interface GovernanceAuditManifest {
  version: string;
  buildId: string;
  generatedAt: string;
  packageContract: {
    publicPackage: "sourceog";
    internalPackagesRemainPrivate: true;
  };
  runtimeContract: {
    artifactOnlyProduction: true;
    sourceProbingDisallowed: true;
    transpilerFallbackDisallowed: true;
  };
  laws: {
    doctorLaw: true;
    replayLaw: true;
    policyLaw: true;
    runtimeLaw: true;
    governanceLaw: true;
  };
  decisions: {
    routeCount: number;
    prerenderedRouteCount: number;
    cacheEntryCount: number;
    invalidationLinkCount: number;
    graphNodeCount: number;
    graphRouteCount: number;
    ownershipEntryCount: number;
    actionCount: number;
  };
  artifactPaths: {
    routeOwnershipManifest: string;
    cacheManifest: string;
    routeGraphManifest: string;
    artifactSignatureManifest: string;
    deploymentSignatureManifest: string;
    doctorBaselineManifest: string;
    policyReplayManifest?: string;
    deploymentManifest: string;
  };
}

export type SupportClassification = "stable" | "preview" | "internal";

export interface SupportMatrixEntryEvidence {
  packageExported: boolean;
  runtimeImplemented: boolean;
  hasTypes: boolean;
  docsCovered: boolean;
  testsCovered: boolean;
  docRefs: string[];
  testRefs: string[];
}

export interface SupportMatrixEntry {
  id: string;
  kind: "subpath" | "api";
  source: string;
  exportName?: string;
  sourceFile?: string;
  status: SupportClassification;
  notes: string[];
  evidence: SupportMatrixEntryEvidence;
}

export interface SupportMatrixSummary {
  total: number;
  stable: number;
  preview: number;
  internal: number;
}

export interface SupportMatrix {
  version: string;
  buildId: string;
  generatedAt: string;
  summary: SupportMatrixSummary;
  entries: SupportMatrixEntry[];
}

export interface ReleaseEvidenceIndex {
  version: string;
  buildId: string;
  generatedAt: string;
  packageContract: GovernanceAuditManifest["packageContract"];
  runtimeContract: GovernanceAuditManifest["runtimeContract"];
  laws: GovernanceAuditManifest["laws"];
  decisionCounts: GovernanceAuditManifest["decisions"];
  selectedAdapter?: string;
  runtimeFingerprint?: string;
  signatures?: ArtifactSignatureManifest["signatures"];
  artifacts: {
    deploymentManifest: string;
    artifactSignatureManifest?: string;
    deploymentSignatureManifest?: string;
    doctorBaselineManifest?: string;
    governanceAuditManifest?: string;
    policyReplayManifest?: string;
    doctorReport?: string;
    doctorRemediation?: string;
    parityScoreboard?: string;
    milestoneDashboard?: string;
    supportMatrix?: string;
    benchmarkReport?: string;
    publishReadiness?: string;
    auditFindings?: string;
    packageGovernance?: string;
  };
  completeness: {
    requiredForBuild: string[];
    requiredForRelease: string[];
    present: string[];
    missingForBuild: string[];
    missingForRelease: string[];
    doctorPresent: boolean;
    verificationPresent: boolean;
    supportMatrixPresent: boolean;
    benchmarkProofPresent: boolean;
    publishReadinessPresent: boolean;
  };
}

export interface ExecutionPlan {
  buildId?: string;
  routeId?: string;
  pathname?: string;
  requestId?: string;
  runtime: "node" | "edge" | "auto";
  artifactMode: ArtifactMode;
  decisionWindow: number;
  capabilities: string[];
  reasons: string[];
}

export interface DecisionTrace {
  generatedAt: string;
  plan: ExecutionPlan;
  reducerPhases: string[];
  overrides: string[];
  confidence: number;
}

export interface ClientReferenceManifestEntry {
  referenceId: string;
  moduleId: string;
  filePath: string;
  manifestKey: string;
  exportName: string;
  exports: string[];
  chunks: string[];
  async: boolean;
  routeIds: string[];
  pathnames: string[];
  importSpecifiers: string[];
  directive: "use-client";
  runtimeTargets: Array<"node" | "edge">;
}

export interface ClientReferenceManifestRegistryEntry {
  id: string;
  chunks: string[];
  name: string;
  async: boolean;
  filepath: string;
  exports: string[];
}

export interface ClientReferenceManifest {
  version: string;
  buildId: string;
  generatedAt: string;
  entries: ClientReferenceManifestEntry[];
  registry: Record<string, ClientReferenceManifestRegistryEntry>;
}

export interface ServerReferenceManifestEntry {
  referenceId: string;
  moduleId: string;
  filePath: string;
  routeIds: string[];
  pathnames: string[];
  importSpecifiers: string[];
  directive: "server-default" | "use-server";
  actionIds: string[];
  runtimeTargets: Array<"node" | "edge">;
}

export interface ServerReferenceManifest {
  version: string;
  buildId: string;
  generatedAt: string;
  entries: ServerReferenceManifestEntry[];
}

export interface RscReferenceManifestEntry {
  routeId: string;
  pathname: string;
  renderMode: RouteRenderMode;
  runtimeTargets: Array<"node" | "edge">;
  supportedRuntimeTargets: Array<"node" | "edge">;
  unsupportedRuntimeReasons: RuntimeCapabilityIssue[];
  clientReferenceIds: string[];
  serverReferenceIds: string[];
  actionIds: string[];
}

export interface RuntimeCapabilityIssue {
  runtime: "node" | "edge";
  code: string;
  message: string;
  filePath?: string;
}

export interface RscReferenceManifest {
  version: string;
  buildId: string;
  generatedAt: string;
  entries: RscReferenceManifestEntry[];
}

export interface ActionManifestEntry {
  actionId: string;
  exportName: string;
  filePath: string;
  routeIds: string[];
  pathnames: string[];
  runtime: "node" | "edge";
  refreshPolicy: "none" | "refresh-current-route-on-revalidate";
  revalidationPolicy: "none" | "track-runtime-revalidation";
}

export interface ActionManifest {
  version: string;
  buildId: string;
  generatedAt: string;
  entries: ActionManifestEntry[];
}

export function createDiagnosticsEnvelope(issues: DiagnosticIssue[] = [], buildId = "dev"): DiagnosticsEnvelope {
  return {
    version: SOURCEOG_MANIFEST_VERSION,
    buildId,
    generatedAt: new Date().toISOString(),
    issues
  };
}

// ---------------------------------------------------------------------------
// Budget types (Requirements 5.x, 11.x)
// ---------------------------------------------------------------------------

export interface BudgetViolation {
  routeKey: string;
  pattern: string;
  actualBytes: number;
  budgetBytes: number;
}

export interface BudgetReport {
  violations: BudgetViolation[];
  passed: boolean;
}

export type ParitySubsystemId =
  | "rendering"
  | "routing"
  | "server-client-boundary"
  | "server-actions"
  | "cache"
  | "compiler"
  | "dev-runtime"
  | "platform"
  | "deployment"
  | "migration-dx";

export type ParityBlockerCategory =
  | "rendering"
  | "routing"
  | "boundary"
  | "actions"
  | "cache"
  | "compiler"
  | "dev-runtime"
  | "platform"
  | "deployment"
  | "migration-dx";

export interface ParitySubsystemScore {
  id: ParitySubsystemId;
  label: string;
  score: number;
  currentStrength: string;
  hardMissingSystem: string;
  breakpoint: string;
  observedSignals: string[];
  blockers: string[];
}

export interface ParityScoreboard {
  version: string;
  buildId: string;
  generatedAt: string;
  overallCompetitiveReadiness: number;
  remainingWorkEstimate: number;
  readinessClassification: "weak" | "promising" | "strong" | "competitive" | "dominant";
  hardMissingSystems: string[];
  subsystemScores: ParitySubsystemScore[];
  blockersByCategory: Array<{
    category: ParityBlockerCategory;
    blockers: string[];
  }>;
  evidence: {
    routeCount: number;
    prerenderedRouteCount: number;
    flightAssetCount: number;
    clientBoundaryRouteCount: number;
    actionCount: number;
    routeGraphNodeCount: number;
    checkedManifestCount: number;
    ranTypecheck: boolean;
    ranTests: boolean;
  };
}

export type MilestoneStatus = "completed" | "in_progress" | "blocked" | "pending";

export interface MilestoneDashboardMetric {
  name: "buildDurationMs" | "typecheckDurationMs" | "testDurationMs" | "devStartupMs" | "routeLatencyP99Ms";
  current: number | null;
  baseline: number | null;
  delta: number | null;
  status: "measured" | "pending_instrumentation";
}

export interface MilestoneDashboardEntry {
  id: string;
  title: string;
  status: MilestoneStatus;
  readinessScore: number;
  blockedBy: string[];
  exitCriteria: string[];
}

export interface MilestoneDashboard {
  version: string;
  buildId: string;
  generatedAt: string;
  currentMilestone: string;
  overallReadiness: number;
  metrics: MilestoneDashboardMetric[];
  failingParityFixtures: string[];
  milestones: MilestoneDashboardEntry[];
}
