export interface DoctorInspectionSummary {
  reportPath?: string;
  passed: boolean;
  summary: {
    errors: number;
    warnings: number;
    infos: number;
  };
  findingsByArea: Record<string, number>;
}

export interface PolicyDiagnostics {
  objective?: string;
  reducerPhases: string[];
  loopNames: string[];
  decisionTraceCount: number;
  changedDecisionFields: string[];
  tuningHintCount: number;
  explainabilityHints: string[];
}

export interface ArtifactInspectionSummary {
  cwd: string;
  distRoot: string;
  buildId: string;
  stability: string;
  routeCount: number;
  pageRouteCount: number;
  handlerRouteCount: number;
  prerenderedRouteCount: number;
  manifestNames: string[];
  manifestPaths: Record<string, string | undefined>;
  runtimeTargets: string[];
  signatureSummary?: {
    compiler: string;
    runtime: string;
    deployment: string;
    artifactCount: number;
  };
  doctorBaseline?: Record<string, unknown>;
  doctor?: DoctorInspectionSummary;
  policyMesh?: {
    objective: string;
    reducerPhases: string[];
    loopNames: string[];
    routeDecisionCount: number;
    decisionTraceCount: number;
  };
}

export interface GovernanceInspectionReport {
  cwd: string;
  distRoot: string;
  buildId: string;
  selectedAdapter?: string;
  runtimeFingerprint?: string;
  signatures?: {
    compiler: string;
    runtime: string;
    deployment: string;
  };
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
  decisionCounts: {
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
  signatureAlignment: {
    compiler: boolean;
    runtime: boolean;
    deployment: boolean;
  };
}

export interface RouteInspectionReport {
  selector: string;
  buildId: string;
  route: Record<string, unknown>;
  render?: Record<string, unknown>;
  prerender?: Record<string, unknown>;
  graph: {
    route?: Record<string, unknown>;
    nodes: Array<Record<string, unknown>>;
    consistencyNodes: Array<Record<string, unknown>>;
    consistencyEdges: Array<Record<string, unknown>>;
  };
  cache: {
    entries: Array<Record<string, unknown>>;
    invalidationLinks: Array<Record<string, unknown>>;
  };
  boundaries: {
    hydrationMode: string | null;
    count: number;
    entries: Array<Record<string, unknown>>;
  };
  actions: Array<Record<string, unknown>>;
  doctor: {
    summary?: DoctorInspectionSummary;
    findings: Array<Record<string, unknown>>;
  };
  policyDiagnostics: PolicyDiagnostics;
  decision: {
    controlPlane?: Record<string, unknown>;
    replay?: Record<string, unknown>;
    base?: Record<string, unknown>;
    tuned?: Record<string, unknown>;
    tuningHints?: Record<string, unknown> | null;
    reducerPhases: string[];
    loopNames: string[];
  };
}

export interface GraphInspectionReport {
  selector: string;
  buildId: string;
  route?: Record<string, unknown>;
  routeGraphRoute?: Record<string, unknown>;
  routeNodes: Array<Record<string, unknown>>;
  consistencyNodes: Array<Record<string, unknown>>;
  consistencyEdges: Array<Record<string, unknown>>;
}

export interface CacheInspectionReport {
  selector: string;
  buildId: string;
  matchedBy: "all" | "route" | "tag" | "key";
  entries: Array<Record<string, unknown>>;
  invalidationLinks: Array<Record<string, unknown>>;
}

export interface ActionInspectionReport {
  selector: string;
  buildId: string;
  entries: Array<Record<string, unknown>>;
}

export interface ArtifactDiffReport {
  comparedAt: string;
  current: ArtifactInspectionSummary;
  baseline: ArtifactInspectionSummary;
  manifests: {
    added: string[];
    removed: string[];
    changed: string[];
    unchangedCount: number;
  };
  routes: {
    added: string[];
    removed: string[];
    changed: Array<{
      pathname: string;
      changes: string[];
    }>;
  };
  policyMesh: {
    objectiveChanged: boolean;
    loopNamesAdded: string[];
    loopNamesRemoved: string[];
    reducerPhasesChanged: boolean;
    changedRoutes: number;
  };
  doctor?: {
    current?: DoctorInspectionSummary;
    baseline?: DoctorInspectionSummary;
    regressions: string[];
  };
}

export declare function inspectBuildArtifacts(cwd?: string): Promise<ArtifactInspectionSummary>;
export declare function inspectGovernance(cwd?: string): Promise<GovernanceInspectionReport>;
export declare function inspectRoute(cwd: string | undefined, selector: string): Promise<RouteInspectionReport>;
export declare function inspectGraph(cwd: string | undefined, selector: string): Promise<GraphInspectionReport>;
export declare function inspectCache(cwd?: string, selector?: string): Promise<CacheInspectionReport>;
export declare function inspectAction(cwd: string | undefined, selector: string): Promise<ActionInspectionReport>;
export declare function diffBuildArtifacts(cwd: string | undefined, compareTarget: string): Promise<ArtifactDiffReport>;
