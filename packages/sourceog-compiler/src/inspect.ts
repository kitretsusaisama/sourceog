import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { resolveConfig } from "@sourceog/platform";
import type {
  ActionManifest,
  ActionManifestEntry,
  ArtifactSignatureManifest,
  CacheManifest,
  CacheManifestEntry,
  CacheManifestInvalidationLink,
  ClientBoundaryDescriptor,
  ClientBoundaryManifest,
  ControlPlaneManifest,
  DeploymentSignatureManifest,
  DeploymentManifest,
  DeploymentManifestRoute,
  DoctorBaselineManifest,
  GraphEdge,
  GraphNode,
  GovernanceAuditManifest,
  PolicyReplayManifest,
  PrerenderManifest,
  PrerenderManifestEntry,
  RenderManifest,
  RenderManifestEntry,
  RouteGraphManifest,
  RouteGraphNode,
  RouteGraphRouteEntry,
  TunerSnapshotManifest,
  TuningHints,
} from "@sourceog/runtime";
import { buildApplication } from "./build.js";
import { runDoctor, type DoctorFinding, type DoctorReport } from "./doctor.js";

interface InspectionContext {
  cwd: string;
  distRoot: string;
  deploymentManifest: DeploymentManifest;
  renderManifest: RenderManifest;
  routeGraphManifest: RouteGraphManifest;
  prerenderManifest: PrerenderManifest;
  cacheManifest: CacheManifest;
  clientBoundaryManifest: ClientBoundaryManifest;
  actionManifest: ActionManifest;
  controlPlaneManifest?: ControlPlaneManifest;
  policyReplayManifest?: PolicyReplayManifest;
  tunerSnapshotManifest?: TunerSnapshotManifest;
  consistencyGraphManifest?: {
    version: string;
    generatedAt: string;
    nodes: GraphNode[];
    edges: GraphEdge[];
  };
  doctorReport?: DoctorReport;
  doctorBaselineManifest?: DoctorBaselineManifest;
  artifactSignatureManifest?: ArtifactSignatureManifest;
  deploymentSignatureManifest?: DeploymentSignatureManifest;
  governanceAuditManifest?: GovernanceAuditManifest;
}

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
  stability: DeploymentManifest["stability"];
  routeCount: number;
  pageRouteCount: number;
  handlerRouteCount: number;
  prerenderedRouteCount: number;
  manifestNames: string[];
  manifestPaths: DeploymentManifest["manifests"];
  runtimeTargets: Array<DeploymentManifestRoute["runtime"]>;
  signatureSummary?: {
    compiler: string;
    runtime: string;
    deployment: string;
    artifactCount: number;
  };
  doctorBaseline?: DoctorBaselineManifest;
  doctor?: DoctorInspectionSummary;
  governance?: {
    packageContract: GovernanceAuditManifest["packageContract"];
    runtimeContract: GovernanceAuditManifest["runtimeContract"];
    laws: GovernanceAuditManifest["laws"];
    decisionCounts: GovernanceAuditManifest["decisions"];
    artifactPaths: GovernanceAuditManifest["artifactPaths"];
  };
  policyMesh?: {
    objective: PolicyReplayManifest["objective"];
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
  signatures?: ArtifactSignatureManifest["signatures"];
  packageContract: GovernanceAuditManifest["packageContract"];
  runtimeContract: GovernanceAuditManifest["runtimeContract"];
  laws: GovernanceAuditManifest["laws"];
  decisionCounts: GovernanceAuditManifest["decisions"];
  artifactPaths: GovernanceAuditManifest["artifactPaths"];
  signatureAlignment: {
    compiler: boolean;
    runtime: boolean;
    deployment: boolean;
  };
}

export interface RouteInspectionReport {
  selector: string;
  buildId: string;
  route: DeploymentManifestRoute;
  render?: RenderManifestEntry;
  prerender?: PrerenderManifestEntry;
  graph: {
    route?: RouteGraphRouteEntry;
    nodes: RouteGraphNode[];
    consistencyNodes: GraphNode[];
    consistencyEdges: GraphEdge[];
  };
  cache: {
    entries: CacheManifestEntry[];
    invalidationLinks: CacheManifestInvalidationLink[];
  };
  boundaries: {
    hydrationMode: ClientBoundaryManifest["entries"][number]["hydrationMode"] | null;
    count: number;
    entries: ClientBoundaryDescriptor[];
  };
  actions: ActionManifestEntry[];
  doctor: {
    summary?: DoctorInspectionSummary;
    findings: DoctorFinding[];
  };
  policyDiagnostics: PolicyDiagnostics;
  decision: {
    controlPlane?: ControlPlaneManifest["entries"][number]["decision"];
    replay?: PolicyReplayManifest["routeDecisions"][number];
    base?: TunerSnapshotManifest["decisionTraces"][number]["baseDecision"];
    tuned?: TunerSnapshotManifest["decisionTraces"][number]["tunedDecision"];
    tuningHints?: TuningHints | null;
    reducerPhases: string[];
    loopNames: string[];
  };
}

export interface GraphInspectionReport {
  selector: string;
  buildId: string;
  route?: DeploymentManifestRoute;
  routeGraphRoute?: RouteGraphRouteEntry;
  routeNodes: RouteGraphNode[];
  consistencyNodes: GraphNode[];
  consistencyEdges: GraphEdge[];
}

export interface CacheInspectionReport {
  selector: string;
  buildId: string;
  matchedBy: "all" | "route" | "tag" | "key";
  entries: CacheManifestEntry[];
  invalidationLinks: CacheManifestInvalidationLink[];
}

export interface ActionInspectionReport {
  selector: string;
  buildId: string;
  entries: ActionManifestEntry[];
}

export interface DecisionExplanationReport {
  selector: string;
  buildId: string;
  routeId: string;
  pathname: string;
  summary: string;
  reducerPhases: string[];
  loopNames: string[];
  reasons: string[];
  doctor?: {
    summary: DoctorInspectionSummary;
    findings: DoctorFinding[];
  };
  policyDiagnostics: PolicyDiagnostics;
  decision: {
    strategy: string;
    runtimeTarget: string;
    queuePriority: string;
    ttlSeconds: number | null;
    routeClass?: string;
    trafficSegment?: string;
    safetyProfile?: string;
    cachePosture?: string;
    hydrationPosture?: string;
    invalidationMode?: string;
    fallbackLadder?: string[];
  };
  tuningHints?: TuningHints | null;
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

export async function inspectBuildArtifacts(cwd: string = process.cwd()): Promise<ArtifactInspectionSummary> {
  const context = await loadInspectionContext(cwd);
  const runtimeTargets = new Set<DeploymentManifestRoute["runtime"]>();
  for (const route of context.deploymentManifest.routes) {
    runtimeTargets.add(route.runtime);
  }

  return {
    cwd: context.cwd,
    distRoot: context.distRoot,
    buildId: context.deploymentManifest.buildId,
    stability: context.deploymentManifest.stability,
    routeCount: context.deploymentManifest.routes.length,
    pageRouteCount: context.deploymentManifest.routes.filter((route) => route.kind === "page").length,
    handlerRouteCount: context.deploymentManifest.routes.filter((route) => route.kind === "route").length,
    prerenderedRouteCount: context.deploymentManifest.routes.filter((route) => route.prerendered).length,
    manifestNames: Object.keys(context.deploymentManifest.manifests).sort(),
    manifestPaths: context.deploymentManifest.manifests,
    runtimeTargets: [...runtimeTargets].sort(),
    signatureSummary: context.artifactSignatureManifest
      ? {
          compiler: context.artifactSignatureManifest.signatures.compiler,
          runtime: context.artifactSignatureManifest.signatures.runtime,
          deployment: context.artifactSignatureManifest.signatures.deployment,
          artifactCount: context.artifactSignatureManifest.artifacts.length,
        }
      : undefined,
    doctorBaseline: context.doctorBaselineManifest,
    doctor: summarizeDoctorReport(context),
    governance: context.governanceAuditManifest
      ? {
          packageContract: context.governanceAuditManifest.packageContract,
          runtimeContract: context.governanceAuditManifest.runtimeContract,
          laws: context.governanceAuditManifest.laws,
          decisionCounts: context.governanceAuditManifest.decisions,
          artifactPaths: context.governanceAuditManifest.artifactPaths,
        }
      : undefined,
    policyMesh: context.policyReplayManifest
      ? {
          objective: context.policyReplayManifest.objective,
          reducerPhases: context.policyReplayManifest.reducerPhases,
          loopNames: context.policyReplayManifest.loopNames,
          routeDecisionCount: context.policyReplayManifest.routeDecisions.length,
          decisionTraceCount: context.tunerSnapshotManifest?.decisionTraces.length ?? 0,
        }
      : undefined,
  };
}

export async function inspectGovernance(
  cwd: string = process.cwd(),
): Promise<GovernanceInspectionReport> {
  const context = await loadInspectionContext(cwd);
  if (!context.governanceAuditManifest) {
    throw new Error("SourceOG governance audit manifest is missing from the inspected build output.");
  }

  return {
    cwd: context.cwd,
    distRoot: context.distRoot,
    buildId: context.deploymentManifest.buildId,
    selectedAdapter: context.deploymentSignatureManifest?.selectedAdapter,
    runtimeFingerprint: context.deploymentSignatureManifest?.runtimeFingerprint,
    signatures: context.artifactSignatureManifest?.signatures,
    packageContract: context.governanceAuditManifest.packageContract,
    runtimeContract: context.governanceAuditManifest.runtimeContract,
    laws: context.governanceAuditManifest.laws,
    decisionCounts: context.governanceAuditManifest.decisions,
    artifactPaths: context.governanceAuditManifest.artifactPaths,
    signatureAlignment: {
      compiler:
        context.deploymentSignatureManifest?.signatures.compiler ===
        context.artifactSignatureManifest?.signatures.compiler,
      runtime:
        context.deploymentSignatureManifest?.signatures.runtime ===
        context.artifactSignatureManifest?.signatures.runtime,
      deployment:
        context.deploymentSignatureManifest?.signatures.deployment ===
        context.artifactSignatureManifest?.signatures.deployment,
    },
  };
}

export async function inspectRoute(
  cwd: string = process.cwd(),
  selector: string,
): Promise<RouteInspectionReport> {
  const context = await loadInspectionContext(cwd);
  const route = findRoute(context, selector);
  const routeGraphRoute = context.routeGraphManifest.routes.find((entry) => entry.routeId === route.routeId);
  const graphNodes = routeGraphRoute
    ? context.routeGraphManifest.nodes.filter(
        (node) =>
          routeGraphRoute.segmentNodeIds.includes(node.id) ||
          routeGraphRoute.fileNodeIds.includes(node.id),
      )
    : [];
  const consistencyNodeId = `route:${route.pathname}`;
  const consistencyNodes = (context.consistencyGraphManifest?.nodes ?? []).filter(
    (node) => node.id === consistencyNodeId,
  );
  const consistencyEdges = (context.consistencyGraphManifest?.edges ?? []).filter(
    (edge) => edge.from === consistencyNodeId || edge.to === consistencyNodeId,
  );
  const boundaryEntry = context.clientBoundaryManifest.entries.find((entry) => entry.routeId === route.routeId);
  const actions = context.actionManifest.entries.filter((entry) => entry.routeIds.includes(route.routeId));
  const cacheEntries = context.cacheManifest.entries.filter(
    (entry) => entry.routeId === route.routeId || entry.pathname === route.pathname || entry.linkedRouteIds.includes(route.routeId),
  );
  const invalidationLinks = context.cacheManifest.invalidationLinks.filter(
    (entry) => entry.routeIds.includes(route.routeId) || entry.pathnames.includes(route.pathname),
  );
  const trace = context.tunerSnapshotManifest?.decisionTraces.find((entry) => entry.routeId === route.routeId);
  const replayDecision = context.policyReplayManifest?.routeDecisions.find((entry) => entry.routeId === route.routeId);
  const controlPlaneEntry = context.controlPlaneManifest?.entries.find((entry) => entry.routeId === route.routeId);
  const relevantDoctorFindings = findRelevantDoctorFindings(context, route, graphNodes);
  const policyDiagnostics = createPolicyDiagnostics(context, trace?.baseDecision, trace?.tunedDecision, trace?.hints ?? null);

  return {
    selector,
    buildId: context.deploymentManifest.buildId,
    route,
    render: context.renderManifest.entries.find((entry) => entry.routeId === route.routeId),
    prerender: context.prerenderManifest.prerendered.find((entry) => entry.routeId === route.routeId),
    graph: {
      route: routeGraphRoute,
      nodes: graphNodes,
      consistencyNodes,
      consistencyEdges,
    },
    cache: {
      entries: cacheEntries,
      invalidationLinks,
    },
    boundaries: {
      hydrationMode: boundaryEntry?.hydrationMode ?? null,
      count: boundaryEntry?.boundaries.length ?? 0,
      entries: boundaryEntry?.boundaries ?? [],
    },
    actions,
    doctor: {
      summary: summarizeDoctorReport(context),
      findings: relevantDoctorFindings,
    },
    policyDiagnostics,
    decision: {
      controlPlane: controlPlaneEntry?.decision,
      replay: replayDecision,
      base: trace?.baseDecision,
      tuned: trace?.tunedDecision,
      tuningHints: trace?.hints ?? null,
      reducerPhases: context.policyReplayManifest?.reducerPhases ?? [],
      loopNames: context.policyReplayManifest?.loopNames ?? [],
    },
  };
}

export async function inspectGraph(
  cwd: string = process.cwd(),
  selector: string,
): Promise<GraphInspectionReport> {
  const context = await loadInspectionContext(cwd);

  if (selector.startsWith("node:")) {
    const nodeId = selector.slice("node:".length);
    const consistencyNodes = (context.consistencyGraphManifest?.nodes ?? []).filter((node) => node.id === nodeId);
    const consistencyEdges = (context.consistencyGraphManifest?.edges ?? []).filter(
      (edge) => edge.from === nodeId || edge.to === nodeId,
    );
    return {
      selector,
      buildId: context.deploymentManifest.buildId,
      routeNodes: [],
      consistencyNodes,
      consistencyEdges,
    };
  }

  const route = findRoute(context, selector);
  const routeGraphRoute = context.routeGraphManifest.routes.find((entry) => entry.routeId === route.routeId);
  const routeNodes = routeGraphRoute
    ? context.routeGraphManifest.nodes.filter(
        (node) =>
          routeGraphRoute.segmentNodeIds.includes(node.id) ||
          routeGraphRoute.fileNodeIds.includes(node.id),
      )
    : [];
  const consistencyNodeId = `route:${route.pathname}`;
  const consistencyNodes = (context.consistencyGraphManifest?.nodes ?? []).filter(
    (node) => node.id === consistencyNodeId,
  );
  const consistencyEdges = (context.consistencyGraphManifest?.edges ?? []).filter(
    (edge) => edge.from === consistencyNodeId || edge.to === consistencyNodeId,
  );

  return {
    selector,
    buildId: context.deploymentManifest.buildId,
    route,
    routeGraphRoute,
    routeNodes,
    consistencyNodes,
    consistencyEdges,
  };
}

export async function inspectCache(
  cwd: string = process.cwd(),
  selector: string = "all",
): Promise<CacheInspectionReport> {
  const context = await loadInspectionContext(cwd);

  if (selector === "all" || selector === "*") {
    return {
      selector,
      buildId: context.deploymentManifest.buildId,
      matchedBy: "all",
      entries: context.cacheManifest.entries,
      invalidationLinks: context.cacheManifest.invalidationLinks,
    };
  }

  if (selector.startsWith("tag:")) {
    const tag = selector.slice("tag:".length);
    return {
      selector,
      buildId: context.deploymentManifest.buildId,
      matchedBy: "tag",
      entries: context.cacheManifest.entries.filter((entry) => entry.tags.includes(tag)),
      invalidationLinks: context.cacheManifest.invalidationLinks.filter((entry) => entry.tags.includes(tag)),
    };
  }

  if (selector.startsWith("key:")) {
    const cacheKey = selector.slice("key:".length);
    return {
      selector,
      buildId: context.deploymentManifest.buildId,
      matchedBy: "key",
      entries: context.cacheManifest.entries.filter((entry) => entry.cacheKey === cacheKey),
      invalidationLinks: context.cacheManifest.invalidationLinks.filter((entry) => entry.targetCacheKeys.includes(cacheKey)),
    };
  }

  const route = findRoute(context, selector);
  return {
    selector,
    buildId: context.deploymentManifest.buildId,
    matchedBy: "route",
    entries: context.cacheManifest.entries.filter(
      (entry) => entry.routeId === route.routeId || entry.pathname === route.pathname || entry.linkedRouteIds.includes(route.routeId),
    ),
    invalidationLinks: context.cacheManifest.invalidationLinks.filter(
      (entry) => entry.routeIds.includes(route.routeId) || entry.pathnames.includes(route.pathname),
    ),
  };
}

export async function inspectAction(
  cwd: string = process.cwd(),
  selector: string,
): Promise<ActionInspectionReport> {
  const context = await loadInspectionContext(cwd);
  const route = findOptionalRoute(context, selector);

  let entries: ActionManifestEntry[];
  if (selector.startsWith("action:")) {
    const actionId = selector.slice("action:".length);
    entries = context.actionManifest.entries.filter((entry) => entry.actionId === actionId);
  } else if (route) {
    entries = context.actionManifest.entries.filter((entry) => entry.routeIds.includes(route.routeId));
  } else {
    entries = context.actionManifest.entries.filter((entry) => entry.actionId === selector);
  }

  return {
    selector,
    buildId: context.deploymentManifest.buildId,
    entries,
  };
}

export async function explainRoute(
  cwd: string = process.cwd(),
  selector: string,
): Promise<DecisionExplanationReport> {
  return explainDecision(cwd, selector);
}

export async function explainDecision(
  cwd: string = process.cwd(),
  selector: string,
): Promise<DecisionExplanationReport> {
  const inspection = await inspectRoute(cwd, selector);
  const route = inspection.route;
  const tunedDecision = inspection.decision.tuned;
  const controlPlaneDecision = inspection.decision.controlPlane;
  const replayDecision = inspection.decision.replay;
  const effectiveDecision = tunedDecision ?? controlPlaneDecision;
  const ttlSeconds = replayDecision?.ttlSeconds ?? effectiveDecision?.ttlSeconds ?? null;
  const strategy = replayDecision?.strategy ?? effectiveDecision?.strategy ?? "unknown";
  const runtimeTarget = replayDecision?.runtimeTarget ?? effectiveDecision?.runtimeTarget ?? route.runtime;
  const queuePriority = replayDecision?.queuePriority ?? effectiveDecision?.queuePriority ?? "normal";
  const reasons = uniqueStrings([
    tunedDecision?.reason,
    controlPlaneDecision?.reason,
    replayDecision?.reason,
    inspection.render?.prerendered ? "Route is currently prerendered." : "Route is currently rendered on demand.",
    inspection.cache.entries.length > 0
      ? `Route is linked to ${inspection.cache.entries.length} cache entr${inspection.cache.entries.length === 1 ? "y" : "ies"}.`
      : "Route is not linked to any cache entries yet.",
  ]);

  return {
    selector,
    buildId: inspection.buildId,
    routeId: route.routeId,
    pathname: route.pathname,
    summary: `${route.pathname} currently resolves to ${strategy} on ${runtimeTarget} with ${queuePriority} priority${ttlSeconds === null ? "" : ` and a ${ttlSeconds}s TTL`}.`,
    reducerPhases: inspection.decision.reducerPhases,
    loopNames: inspection.decision.loopNames,
    reasons,
    doctor: inspection.doctor.summary
      ? {
          summary: inspection.doctor.summary,
          findings: inspection.doctor.findings,
        }
      : undefined,
    policyDiagnostics: inspection.policyDiagnostics,
    decision: {
      strategy,
      runtimeTarget,
      queuePriority,
      ttlSeconds,
      routeClass: effectiveDecision?.routeClass,
      trafficSegment: effectiveDecision?.trafficSegment,
      safetyProfile: effectiveDecision?.safetyProfile,
      cachePosture: effectiveDecision?.cachePosture,
      hydrationPosture: effectiveDecision?.hydrationPosture,
      invalidationMode: effectiveDecision?.invalidationMode,
      fallbackLadder: effectiveDecision?.fallbackLadder,
    },
    tuningHints: inspection.decision.tuningHints ?? null,
  };
}

export async function diffBuildArtifacts(
  cwd: string = process.cwd(),
  compareTarget: string,
): Promise<ArtifactDiffReport> {
  const currentContext = await loadInspectionContext(cwd);
  const baselineContext = await loadInspectionContext(compareTarget);
  const currentSummary = await inspectBuildArtifacts(cwd);
  const baselineSummary = await inspectBuildArtifacts(compareTarget);

  const currentArtifacts = new Map(
    (currentContext.artifactSignatureManifest?.artifacts ?? []).map((artifact) => [artifact.kind, artifact.sha256]),
  );
  const baselineArtifacts = new Map(
    (baselineContext.artifactSignatureManifest?.artifacts ?? []).map((artifact) => [artifact.kind, artifact.sha256]),
  );
  const allManifestNames = new Set<string>([
    ...Object.keys(currentSummary.manifestPaths),
    ...Object.keys(baselineSummary.manifestPaths),
    ...currentArtifacts.keys(),
    ...baselineArtifacts.keys(),
  ]);

  const addedManifests: string[] = [];
  const removedManifests: string[] = [];
  const changedManifests: string[] = [];
  let unchangedCount = 0;

  for (const manifestName of [...allManifestNames].sort()) {
    const currentPath = currentSummary.manifestPaths[manifestName as keyof typeof currentSummary.manifestPaths];
    const baselinePath = baselineSummary.manifestPaths[manifestName as keyof typeof baselineSummary.manifestPaths];
    if (!baselinePath && currentPath) {
      addedManifests.push(manifestName);
      continue;
    }
    if (baselinePath && !currentPath) {
      removedManifests.push(manifestName);
      continue;
    }

    const currentHash = currentArtifacts.get(manifestName);
    const baselineHash = baselineArtifacts.get(manifestName);
    if (currentHash && baselineHash) {
      if (currentHash !== baselineHash) {
        changedManifests.push(manifestName);
      } else {
        unchangedCount += 1;
      }
      continue;
    }

    if (currentPath && baselinePath) {
      unchangedCount += 1;
    }
  }

  const currentRoutes = new Map(currentContext.deploymentManifest.routes.map((route) => [route.pathname, route]));
  const baselineRoutes = new Map(baselineContext.deploymentManifest.routes.map((route) => [route.pathname, route]));
  const allRoutePathnames = new Set<string>([...currentRoutes.keys(), ...baselineRoutes.keys()]);
  const addedRoutes: string[] = [];
  const removedRoutes: string[] = [];
  const changedRoutes: Array<{ pathname: string; changes: string[] }> = [];

  for (const pathnameValue of [...allRoutePathnames].sort()) {
    const currentRoute = currentRoutes.get(pathnameValue);
    const baselineRoute = baselineRoutes.get(pathnameValue);
    if (currentRoute && !baselineRoute) {
      addedRoutes.push(pathnameValue);
      continue;
    }
    if (!currentRoute && baselineRoute) {
      removedRoutes.push(pathnameValue);
      continue;
    }
    if (!currentRoute || !baselineRoute) {
      continue;
    }

    const changes: string[] = [];
    if (currentRoute.runtime !== baselineRoute.runtime) {
      changes.push(`runtime ${baselineRoute.runtime} -> ${currentRoute.runtime}`);
    }
    if (currentRoute.prerendered !== baselineRoute.prerendered) {
      changes.push(`prerendered ${baselineRoute.prerendered} -> ${currentRoute.prerendered}`);
    }
    if (currentRoute.edgeCompatible !== baselineRoute.edgeCompatible) {
      changes.push(`edgeCompatible ${baselineRoute.edgeCompatible} -> ${currentRoute.edgeCompatible}`);
    }

    const currentReplay = currentContext.policyReplayManifest?.routeDecisions.find((entry) => entry.pathname === pathnameValue);
    const baselineReplay = baselineContext.policyReplayManifest?.routeDecisions.find((entry) => entry.pathname === pathnameValue);
    if (currentReplay && baselineReplay) {
      if (currentReplay.strategy !== baselineReplay.strategy) {
        changes.push(`strategy ${baselineReplay.strategy} -> ${currentReplay.strategy}`);
      }
      if (currentReplay.runtimeTarget !== baselineReplay.runtimeTarget) {
        changes.push(`runtimeTarget ${baselineReplay.runtimeTarget} -> ${currentReplay.runtimeTarget}`);
      }
      if (currentReplay.queuePriority !== baselineReplay.queuePriority) {
        changes.push(`queuePriority ${baselineReplay.queuePriority} -> ${currentReplay.queuePriority}`);
      }
      if ((currentReplay.ttlSeconds ?? null) !== (baselineReplay.ttlSeconds ?? null)) {
        changes.push(`ttlSeconds ${baselineReplay.ttlSeconds ?? "null"} -> ${currentReplay.ttlSeconds ?? "null"}`);
      }
    }

    if (changes.length > 0) {
      changedRoutes.push({ pathname: pathnameValue, changes });
    }
  }

  const currentDoctor = summarizeDoctorReport(currentContext);
  const baselineDoctor = summarizeDoctorReport(baselineContext);

  return {
    comparedAt: new Date().toISOString(),
    current: currentSummary,
    baseline: baselineSummary,
    manifests: {
      added: addedManifests,
      removed: removedManifests,
      changed: changedManifests,
      unchangedCount,
    },
    routes: {
      added: addedRoutes,
      removed: removedRoutes,
      changed: changedRoutes,
    },
    policyMesh: {
      objectiveChanged: (currentSummary.policyMesh?.objective ?? null) !== (baselineSummary.policyMesh?.objective ?? null),
      loopNamesAdded: diffStrings(currentSummary.policyMesh?.loopNames ?? [], baselineSummary.policyMesh?.loopNames ?? []),
      loopNamesRemoved: diffStrings(baselineSummary.policyMesh?.loopNames ?? [], currentSummary.policyMesh?.loopNames ?? []),
      reducerPhasesChanged:
        JSON.stringify(currentSummary.policyMesh?.reducerPhases ?? []) !== JSON.stringify(baselineSummary.policyMesh?.reducerPhases ?? []),
      changedRoutes: changedRoutes.filter((entry) => entry.changes.some((change) => change.includes("strategy") || change.includes("runtimeTarget") || change.includes("queuePriority") || change.includes("ttlSeconds"))).length,
    },
    doctor: currentDoctor || baselineDoctor
      ? {
          current: currentDoctor,
          baseline: baselineDoctor,
          regressions: compareDoctorSummaries(currentDoctor, baselineDoctor),
        }
      : undefined,
  };
}

async function loadInspectionContext(cwd: string): Promise<InspectionContext> {
  const distRootCandidate = resolveDistRootCandidate(cwd);
  const distRoot = distRootCandidate ?? (await resolveConfig(cwd)).distRoot;
  const deploymentManifestPath = path.join(distRoot, "deployment-manifest.json");

  if (!existsSync(deploymentManifestPath)) {
    await buildApplication(cwd);
  }

  const deploymentManifest = await readRequiredJson<DeploymentManifest>(
    path.join(distRoot, "deployment-manifest.json"),
    "deployment manifest",
  );

  let doctorReport = await readOptionalJson<DoctorReport>(path.join(distRoot, "doctor", "doctor-report.json"));
  if (!doctorReport && !distRootCandidate) {
    doctorReport = await runDoctor(cwd, { area: "all" });
  }

  return {
    cwd,
    distRoot,
    deploymentManifest,
    renderManifest: await readRequiredJson<RenderManifest>(deploymentManifest.manifests.renderManifest, "render manifest"),
    routeGraphManifest: await readRequiredJson<RouteGraphManifest>(deploymentManifest.manifests.routeGraphManifest, "route graph manifest"),
    prerenderManifest: await readRequiredJson<PrerenderManifest>(deploymentManifest.manifests.prerenderManifest, "prerender manifest"),
    cacheManifest: await readRequiredJson<CacheManifest>(deploymentManifest.manifests.cacheManifest, "cache manifest"),
    clientBoundaryManifest: await readRequiredJson<ClientBoundaryManifest>(
      deploymentManifest.manifests.clientBoundaryManifest,
      "client boundary manifest",
    ),
    actionManifest: await readRequiredJson<ActionManifest>(deploymentManifest.manifests.actionManifest, "action manifest"),
    controlPlaneManifest: deploymentManifest.manifests.controlPlaneManifest
      ? await readOptionalJson<ControlPlaneManifest>(deploymentManifest.manifests.controlPlaneManifest)
      : undefined,
    policyReplayManifest: deploymentManifest.manifests.policyReplayManifest
      ? await readOptionalJson<PolicyReplayManifest>(deploymentManifest.manifests.policyReplayManifest)
      : undefined,
    tunerSnapshotManifest: deploymentManifest.manifests.tunerSnapshotManifest
      ? await readOptionalJson<TunerSnapshotManifest>(deploymentManifest.manifests.tunerSnapshotManifest)
      : undefined,
    consistencyGraphManifest: deploymentManifest.manifests.consistencyGraphManifest
      ? await readOptionalJson<InspectionContext["consistencyGraphManifest"]>(deploymentManifest.manifests.consistencyGraphManifest)
      : undefined,
    doctorReport,
    doctorBaselineManifest: deploymentManifest.manifests.doctorBaselineManifest
      ? await readOptionalJson<DoctorBaselineManifest>(deploymentManifest.manifests.doctorBaselineManifest)
      : undefined,
    artifactSignatureManifest: deploymentManifest.manifests.artifactSignatureManifest
      ? await readOptionalJson<ArtifactSignatureManifest>(deploymentManifest.manifests.artifactSignatureManifest)
      : undefined,
    deploymentSignatureManifest: deploymentManifest.manifests.deploymentSignatureManifest
      ? await readOptionalJson<DeploymentSignatureManifest>(deploymentManifest.manifests.deploymentSignatureManifest)
      : undefined,
    governanceAuditManifest: deploymentManifest.manifests.governanceAuditManifest
      ? await readOptionalJson<GovernanceAuditManifest>(deploymentManifest.manifests.governanceAuditManifest)
      : undefined,
  };
}

function resolveDistRootCandidate(input: string): string | undefined {
  const candidate = path.resolve(input);
  if (existsSync(path.join(candidate, "deployment-manifest.json"))) {
    return candidate;
  }
  if (existsSync(path.join(candidate, ".sourceog", "deployment-manifest.json"))) {
    return path.join(candidate, ".sourceog");
  }
  return undefined;
}

async function readRequiredJson<T>(filePath: string, label: string): Promise<T> {
  if (!existsSync(filePath)) {
    throw new Error(`SourceOG ${label} is missing at ${filePath}.`);
  }
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
}

async function readOptionalJson<T>(filePath: string): Promise<T | undefined> {
  if (!existsSync(filePath)) {
    return undefined;
  }
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
}

function findRoute(context: InspectionContext, selector: string): DeploymentManifestRoute {
  const route = findOptionalRoute(context, selector);
  if (!route) {
    throw new Error(`SourceOG could not find a route matching "${selector}".`);
  }
  return route;
}

function findOptionalRoute(context: InspectionContext, selector: string): DeploymentManifestRoute | undefined {
  return context.deploymentManifest.routes.find(
    (route) => route.routeId === selector || route.pathname === selector,
  );
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function summarizeDoctorReport(context: InspectionContext): DoctorInspectionSummary | undefined {
  if (!context.doctorReport) {
    return undefined;
  }

  const findingsByArea: Record<string, number> = {};
  for (const finding of context.doctorReport.findings) {
    findingsByArea[finding.area] = (findingsByArea[finding.area] ?? 0) + 1;
  }

  return {
    reportPath: path.join(context.distRoot, "doctor", "doctor-report.json"),
    passed: context.doctorReport.passed,
    summary: {
      errors: context.doctorReport.summary.errors,
      warnings: context.doctorReport.summary.warnings,
      infos: context.doctorReport.summary.infos,
    },
    findingsByArea,
  };
}

function findRelevantDoctorFindings(
  context: InspectionContext,
  route: DeploymentManifestRoute,
  graphNodes: RouteGraphNode[],
): DoctorFinding[] {
  if (!context.doctorReport) {
    return [];
  }

  const candidateFragments = new Set<string>([
    route.routeId,
    route.pathname,
    ...graphNodes
      .map((node) => node.filePath)
      .filter((value): value is string => Boolean(value)),
  ]);

  return context.doctorReport.findings.filter((finding) => {
    const text = `${finding.message} ${finding.filePath ?? ""}`;
    for (const fragment of candidateFragments) {
      if (fragment && text.includes(fragment)) {
        return true;
      }
    }
    return false;
  });
}

function createPolicyDiagnostics(
  context: InspectionContext,
  baseDecision: TunerSnapshotManifest["decisionTraces"][number]["baseDecision"] | undefined,
  tunedDecision: TunerSnapshotManifest["decisionTraces"][number]["tunedDecision"] | undefined,
  tuningHints: TuningHints | null,
): PolicyDiagnostics {
  const changedDecisionFields = baseDecision && tunedDecision
    ? [
        "strategy",
        "cachePosture",
        "runtimeTarget",
        "queuePriority",
        "hydrationPosture",
        "invalidationMode",
        "observabilitySampleRate",
        "safetyProfile",
        "ttlSeconds",
        "routeClass",
        "trafficSegment",
      ].filter((field) => JSON.stringify(baseDecision[field as keyof typeof baseDecision]) !== JSON.stringify(tunedDecision[field as keyof typeof tunedDecision]))
    : [];

  return {
    objective: context.policyReplayManifest?.objective,
    reducerPhases: context.policyReplayManifest?.reducerPhases ?? [],
    loopNames: context.policyReplayManifest?.loopNames ?? [],
    decisionTraceCount: context.tunerSnapshotManifest?.decisionTraces.length ?? 0,
    changedDecisionFields,
    tuningHintCount: tuningHints
      ? Object.values(tuningHints).filter((value) => value !== undefined && value !== null).length
      : 0,
    explainabilityHints: tuningHints?.explainability ?? [],
  };
}

function diffStrings(left: string[], right: string[]): string[] {
  const rightSet = new Set(right);
  return left.filter((value) => !rightSet.has(value));
}

function compareDoctorSummaries(
  current: DoctorInspectionSummary | undefined,
  baseline: DoctorInspectionSummary | undefined,
): string[] {
  const regressions: string[] = [];
  if (!current || !baseline) {
    return regressions;
  }
  if (current.summary.errors > baseline.summary.errors) {
    regressions.push(`errors ${baseline.summary.errors} -> ${current.summary.errors}`);
  }
  if (current.summary.warnings > baseline.summary.warnings) {
    regressions.push(`warnings ${baseline.summary.warnings} -> ${current.summary.warnings}`);
  }
  return regressions;
}
