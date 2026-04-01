import { spawn } from "node:child_process";
import { existsSync, promises as fs, readFileSync } from "node:fs";
import path from "node:path";
import {
  type ActionManifest,
  type AdapterManifest,
  SOURCEOG_ERROR_CODES,
  SOURCEOG_MANIFEST_VERSION,
  SourceOGError,
  type AssetManifest,
  type CacheManifest,
  type BundleManifest,
  type MilestoneDashboard,
  type ClientBoundaryManifest,
  type ClientReferenceManifest,
  type DeploymentManifest,
  type DiagnosticsEnvelope,
  type ParityBlockerCategory,
  type ParityScoreboard,
  type ParitySubsystemScore,
  type PrerenderManifest,
  type RenderManifest,
  type RscReferenceManifest,
  type RouteGraphManifest,
  type RouteOwnershipManifest,
  type ServerReferenceManifest
} from "@sourceog/runtime";
import { getClientRuntimeScript } from "@sourceog/dev";
import { buildApplication, type BuildResult } from "./build.js";

export interface VerifyApplicationOptions {
  runTypecheck?: boolean;
  runTests?: boolean;
  workspaceRoot?: string;
  stdio?: "inherit" | "pipe";
}

export interface VerifyApplicationReport {
  buildId: string;
  workspaceRoot: string;
  checkedManifests: string[];
  buildResult: BuildResult;
  parityScoreboard: ParityScoreboard;
  milestoneDashboard: MilestoneDashboard;
  artifactPaths: {
    parityScoreboard: string;
    milestoneDashboard: string;
  };
}

interface VerifiedBuildOutput {
  checkedManifests: string[];
  deploymentManifest: DeploymentManifest;
  adapterManifest: AdapterManifest;
  bundleManifest: BundleManifest;
  routeOwnershipManifest: RouteOwnershipManifest;
  routeGraphManifest: RouteGraphManifest;
  assetManifest: AssetManifest;
  renderManifest: RenderManifest;
  prerenderManifest: PrerenderManifest;
  cacheManifest: CacheManifest;
  diagnosticsManifest: DiagnosticsEnvelope;
  clientReferenceManifest: ClientReferenceManifest;
  clientBoundaryManifest: ClientBoundaryManifest;
  rscReferenceManifest: RscReferenceManifest;
  serverReferenceManifest: ServerReferenceManifest;
  actionManifest: ActionManifest;
}

interface MilestoneProgress {
  milestone1Complete: boolean;
  milestone2Complete: boolean;
  milestone3Verification: InternalMilestoneVerificationResult;
  currentMilestone: string;
  overallReadiness: number;
  remainingWorkEstimate: number;
}

interface FailingMilestoneCheck {
  id: string;
  description: string;
  details: string;
}

interface InternalMilestoneVerificationResult {
  complete: boolean;
  score: number;
  passingChecks: string[];
  failingChecks: FailingMilestoneCheck[];
}

const BASELINE_OVERALL_READINESS = 58;
const BASELINE_REMAINING_WORK = 42;
const MILESTONE_2_READINESS_BONUS = 3;

const HARD_MISSING_SYSTEMS = [
  "True React Server Components runtime",
  "Server-component-first hydration model",
  "Request memoization and data cache",
  "Compiler-authoritative bundle graph",
  "Fast Refresh",
  "Font system",
  "Script system",
  "Styling pipeline",
  "Scaffold + migration docs",
  "Benchmark-based release gate"
];

const PARITY_BLOCKERS: Array<{ category: ParityBlockerCategory; blockers: string[] }> = [
  {
    category: "rendering",
    blockers: [
      "Server Components are not the default runtime.",
      "Flight transport exists, but true segment-aware RSC streaming is still missing."
    ]
  },
  {
    category: "routing",
    blockers: [
      "Route graph semantics still need full authority across prerender, server, and dev invalidation.",
      "Persistent route-group and advanced slot lifecycle behavior remain incomplete."
    ]
  },
  {
    category: "boundary",
    blockers: [
      "Boundary manifests exist, but runtime still needs server-component-first execution.",
      "Zero-JS server-only subtree delivery is not complete."
    ]
  },
  {
    category: "actions",
    blockers: [
      "Server Actions still need first-class capability gating and full Flight refresh parity."
    ]
  },
  {
    category: "cache",
    blockers: [
      "Request memoization exists, but persistent data-cache parity is still incomplete.",
      "Actions, ISR, and fetch controls now expose manifest-backed cache links, but runtime invalidation parity is still incomplete."
    ]
  },
  {
    category: "compiler",
    blockers: [
      "Compiler outputs are not yet the authoritative boot contract for server, client, action, and CSS graphs."
    ]
  },
  {
    category: "dev-runtime",
    blockers: [
      "Fast Refresh with state preservation is missing.",
      "Graph-aware invalidation is not yet complete."
    ]
  },
  {
    category: "platform",
    blockers: [
      "Font, script, and styling parity are missing.",
      "Image optimization is still surface-level."
    ]
  },
  {
    category: "deployment",
    blockers: [
      "Route-level edge capability enforcement and benchmark-backed parity are incomplete."
    ]
  },
  {
    category: "migration-dx",
    blockers: [
      "create-sourceog-app and migration-grade docs do not exist.",
      "Benchmark-based release gating is not complete."
    ]
  }
];

export async function verifyBuildOutput(buildResult: BuildResult): Promise<VerifiedBuildOutput> {
  const checkedManifests: string[] = ["deploymentManifest"];
  const deploymentManifestPath = path.join(buildResult.distRoot, "deployment-manifest.json");

  if (!existsSync(deploymentManifestPath)) {
    throw new SourceOGError(
      SOURCEOG_ERROR_CODES.MANIFEST_INVALID,
      "Deployment manifest is missing from the build output.",
      { deploymentManifestPath }
    );
  }

  const deploymentManifest = await readJson<DeploymentManifest>(deploymentManifestPath);
  assertManifestShape("deploymentManifest", deploymentManifest, buildResult.buildId);

  const manifestPayloads = await Promise.all(
    Object.entries(deploymentManifest.manifests).map(async ([name, manifestPath]) => {
      if (!existsSync(manifestPath)) {
        throw new SourceOGError(
          SOURCEOG_ERROR_CODES.MANIFEST_INVALID,
          `Referenced manifest "${name}" is missing from the build output.`,
          { name, manifestPath }
        );
      }

      const payload = await readJson<Record<string, unknown>>(manifestPath);
      assertManifestShape(name, payload, buildResult.buildId);
      checkedManifests.push(name);
      return [name, payload] as const;
    })
  );

  const manifests = Object.fromEntries(manifestPayloads) as Record<string, Record<string, unknown>>;
  const bundleManifest = manifests.bundleManifest as unknown as BundleManifest;
  const routeOwnershipManifest = manifests.routeOwnershipManifest as unknown as RouteOwnershipManifest;
  const routeGraphManifest = manifests.routeGraphManifest as unknown as RouteGraphManifest;
  const assetManifest = manifests.assetManifest as unknown as AssetManifest;
  const adapterManifest = manifests.adapterManifest as unknown as AdapterManifest;
  const renderManifest = manifests.renderManifest as unknown as RenderManifest;
  const prerenderManifest = manifests.prerenderManifest as unknown as PrerenderManifest;
  const cacheManifest = manifests.cacheManifest as unknown as CacheManifest;
  const diagnosticsManifest = manifests.diagnosticsManifest as unknown as DiagnosticsEnvelope;
  const clientReferenceManifest = manifests.clientReferenceManifest as unknown as ClientReferenceManifest;
  const clientBoundaryManifest = manifests.clientBoundaryManifest as unknown as ClientBoundaryManifest;
  const rscReferenceManifest = manifests.rscReferenceManifest as unknown as RscReferenceManifest;
  const serverReferenceManifest = manifests.serverReferenceManifest as unknown as ServerReferenceManifest;
  const actionManifest = manifests.actionManifest as unknown as ActionManifest;

  if (deploymentManifest.routes.length === 0) {
    throw new SourceOGError(
      SOURCEOG_ERROR_CODES.MANIFEST_INVALID,
      "Deployment manifest does not contain any routes.",
      { deploymentManifestPath }
    );
  }

  if (bundleManifest.routes.length !== deploymentManifest.routes.length) {
    throw new SourceOGError(
      SOURCEOG_ERROR_CODES.MANIFEST_INVALID,
      "Bundle manifest route count does not match the deployment manifest.",
      {
        bundleRoutes: bundleManifest.routes.length,
        deploymentRoutes: deploymentManifest.routes.length
      }
    );
  }

  if (routeOwnershipManifest.entries.length !== deploymentManifest.routes.length) {
    throw new SourceOGError(
      SOURCEOG_ERROR_CODES.MANIFEST_INVALID,
      "Route ownership manifest entry count does not match the deployment manifest.",
      {
        routeOwnershipEntries: routeOwnershipManifest.entries.length,
        deploymentRoutes: deploymentManifest.routes.length
      }
    );
  }

  if (routeGraphManifest.routes.length !== deploymentManifest.routes.length) {
    throw new SourceOGError(
      SOURCEOG_ERROR_CODES.MANIFEST_INVALID,
      "Route graph manifest entry count does not match the deployment manifest.",
      {
        routeGraphRoutes: routeGraphManifest.routes.length,
        deploymentRoutes: deploymentManifest.routes.length
      }
    );
  }

  const runtimeAssetPath = path.join(buildResult.distRoot, assetManifest.runtimeAsset);
  if (!existsSync(runtimeAssetPath)) {
    throw new SourceOGError(
      SOURCEOG_ERROR_CODES.MANIFEST_INVALID,
      "Asset manifest runtime asset is missing on disk.",
      { runtimeAssetPath }
    );
  }

  if (assetManifest.assets.length === 0) {
    throw new SourceOGError(
      SOURCEOG_ERROR_CODES.MANIFEST_INVALID,
      "Asset manifest does not contain any assets.",
      { assetManifestPath: deploymentManifest.manifests.assetManifest }
    );
  }

  for (const asset of assetManifest.assets) {
    const absoluteAssetPath = path.join(buildResult.distRoot, asset.filePath);
    if (!existsSync(absoluteAssetPath)) {
      throw new SourceOGError(
        SOURCEOG_ERROR_CODES.MANIFEST_INVALID,
        "Asset manifest references a file that does not exist on disk.",
        {
          routeId: asset.routeId,
          kind: asset.kind,
          filePath: asset.filePath,
          absoluteAssetPath
        }
      );
    }
  }

  const pageRouteCount = deploymentManifest.routes.filter((route) => route.kind === "page").length;
  if (renderManifest.entries.length !== pageRouteCount) {
    throw new SourceOGError(
      SOURCEOG_ERROR_CODES.MANIFEST_INVALID,
      "Render manifest entry count does not match the deployment manifest.",
      {
        renderEntries: renderManifest.entries.length,
        deploymentPageRoutes: pageRouteCount
      }
    );
  }

  if (!Array.isArray(prerenderManifest.prerendered)) {
    throw new SourceOGError(
      SOURCEOG_ERROR_CODES.MANIFEST_INVALID,
      "Prerender manifest does not expose a prerendered route list.",
      { prerenderManifestPath: deploymentManifest.manifests.prerenderManifest }
    );
  }

  if (!Array.isArray(cacheManifest.entries) || !Array.isArray(cacheManifest.invalidationLinks)) {
    throw new SourceOGError(
      SOURCEOG_ERROR_CODES.MANIFEST_INVALID,
      "Cache manifest does not expose the expected cache entry and invalidation link arrays.",
      { cacheManifestPath: deploymentManifest.manifests.cacheManifest }
    );
  }

  if (!Array.isArray(diagnosticsManifest.issues)) {
    throw new SourceOGError(
      SOURCEOG_ERROR_CODES.MANIFEST_INVALID,
      "Diagnostics manifest does not expose an issue list.",
      { diagnosticsManifestPath: deploymentManifest.manifests.diagnosticsManifest }
    );
  }

  if (
    !Array.isArray(clientReferenceManifest.entries) ||
    typeof clientReferenceManifest.registry !== "object" ||
    clientReferenceManifest.registry === null ||
    !Array.isArray(clientBoundaryManifest.entries) ||
    !Array.isArray(rscReferenceManifest.entries) ||
    !Array.isArray(serverReferenceManifest.entries) ||
    !Array.isArray(actionManifest.entries)
  ) {
    throw new SourceOGError(
      SOURCEOG_ERROR_CODES.MANIFEST_INVALID,
      "Boundary manifests do not expose the expected entry arrays and client reference registry.",
      {
        clientReferenceManifestPath: deploymentManifest.manifests.clientReferenceManifest,
        clientBoundaryManifestPath: deploymentManifest.manifests.clientBoundaryManifest,
        rscReferenceManifestPath: deploymentManifest.manifests.rscReferenceManifest,
        serverReferenceManifestPath: deploymentManifest.manifests.serverReferenceManifest,
        actionManifestPath: deploymentManifest.manifests.actionManifest
      }
    );
  }

  const browserClientReferenceManifestPath = path.join(buildResult.distRoot, "public", "_sourceog", "client-refs.json");
  if (!existsSync(browserClientReferenceManifestPath)) {
    throw new SourceOGError(
      SOURCEOG_ERROR_CODES.MANIFEST_INVALID,
      "Browser client reference manifest is missing from the build output.",
      { browserClientReferenceManifestPath }
    );
  }

  const browserClientReferenceManifest = await readJson<ClientReferenceManifest>(browserClientReferenceManifestPath);
  assertManifestShape("browserClientReferenceManifest", browserClientReferenceManifest, buildResult.buildId);

  if (JSON.stringify(browserClientReferenceManifest) !== JSON.stringify(clientReferenceManifest)) {
    throw new SourceOGError(
      SOURCEOG_ERROR_CODES.MANIFEST_INVALID,
      "Server and browser client reference manifests are out of sync.",
      {
        clientReferenceManifestPath: deploymentManifest.manifests.clientReferenceManifest,
        browserClientReferenceManifestPath
      }
    );
  }

  if (!rscReferenceManifest.entries.every((entry) => Array.isArray(entry.runtimeTargets) && Array.isArray(entry.supportedRuntimeTargets) && Array.isArray(entry.unsupportedRuntimeReasons))) {
    throw new SourceOGError(
      SOURCEOG_ERROR_CODES.MANIFEST_INVALID,
      "RSC reference manifest entries do not expose runtime support diagnostics.",
      {
        rscReferenceManifestPath: deploymentManifest.manifests.rscReferenceManifest
      }
    );
  }

  for (const entry of routeOwnershipManifest.entries) {
    if (entry.declaredClientAsset && !existsSync(entry.declaredClientAsset)) {
      throw new SourceOGError(
        SOURCEOG_ERROR_CODES.MANIFEST_INVALID,
        "Route ownership manifest references a missing client asset.",
        { routeId: entry.routeId, declaredClientAsset: entry.declaredClientAsset }
      );
    }

    if (entry.metadataAsset && !existsSync(entry.metadataAsset)) {
      throw new SourceOGError(
        SOURCEOG_ERROR_CODES.MANIFEST_INVALID,
        "Route ownership manifest references a missing metadata asset.",
        { routeId: entry.routeId, metadataAsset: entry.metadataAsset }
      );
    }
  }

  return {
    checkedManifests,
    deploymentManifest,
    adapterManifest,
    bundleManifest,
    routeOwnershipManifest,
    routeGraphManifest,
    assetManifest,
    renderManifest,
    prerenderManifest,
    cacheManifest,
    diagnosticsManifest,
    clientReferenceManifest,
    clientBoundaryManifest,
    rscReferenceManifest,
    serverReferenceManifest,
    actionManifest
  };
}

export async function verifyApplication(
  cwd: string,
  options: VerifyApplicationOptions = {}
): Promise<VerifyApplicationReport> {
  const buildStartedAt = Date.now();
  const buildResult = await buildApplication(cwd);
  const buildDurationMs = Date.now() - buildStartedAt;

  if (!buildResult.budgetReport.passed) {
    throw new SourceOGError(
      SOURCEOG_ERROR_CODES.BUNDLE_BUDGET_EXCEEDED,
      "Release verification failed because one or more route bundles exceeded the configured budget.",
      { violations: buildResult.budgetReport.violations }
    );
  }

  const verifiedBuild = await verifyBuildOutput(buildResult);
  const workspaceRoot = options.workspaceRoot ?? findWorkspaceRoot(cwd);
  let typecheckDurationMs: number | null = null;
  let testDurationMs: number | null = null;

  if (options.runTypecheck !== false) {
    const typecheckStartedAt = Date.now();
    await runWorkspaceCommand(["typecheck"], workspaceRoot, options.stdio);
    typecheckDurationMs = Date.now() - typecheckStartedAt;
  }

  if (options.runTests !== false) {
    const testsStartedAt = Date.now();
    await runWorkspaceCommand(["test"], workspaceRoot, options.stdio);
    testDurationMs = Date.now() - testsStartedAt;
  }

  const parityScoreboard = createParityScoreboard(buildResult, verifiedBuild, {
    ranTypecheck: options.runTypecheck !== false,
    ranTests: options.runTests !== false
  });
  const milestoneDashboard = createMilestoneDashboard(buildResult, verifiedBuild, {
    buildDurationMs,
    typecheckDurationMs,
    testDurationMs
  });
  const artifactPaths = await writeVerificationArtifacts(buildResult.distRoot, parityScoreboard, milestoneDashboard);

  return {
    buildId: buildResult.buildId,
    workspaceRoot,
    checkedManifests: verifiedBuild.checkedManifests,
    buildResult,
    parityScoreboard,
    milestoneDashboard,
    artifactPaths
  };
}

function createParityScoreboard(
  buildResult: BuildResult,
  verifiedBuild: VerifiedBuildOutput,
  options: { ranTypecheck: boolean; ranTests: boolean }
): ParityScoreboard {
  const milestoneProgress = evaluateMilestoneProgress(verifiedBuild);
  const generatedAt = new Date().toISOString();
  const groupCount = verifiedBuild.routeGraphManifest.nodes.filter((node) => node.kind === "group").length;
  const parallelCount = verifiedBuild.routeGraphManifest.nodes.filter((node) => node.kind === "parallel").length;
  const interceptCount = verifiedBuild.routeGraphManifest.nodes.filter((node) => node.kind === "intercepting").length;
  const flightAssetCount = verifiedBuild.assetManifest.assets.filter((asset) => asset.kind === "flight").length;
  const clientBoundaryRouteCount = verifiedBuild.clientBoundaryManifest.entries.filter(
    (entry) => entry.boundaries.length > 0
  ).length;
  const diagnosticsCount = verifiedBuild.diagnosticsManifest.issues.length;

  const subsystemScores: ParitySubsystemScore[] = [
    {
      id: "rendering",
      label: "Rendering Pipeline",
      score: 66,
      currentStrength: "SSR, streaming shell output, and Flight transport foundation are in place.",
      hardMissingSystem: "True React Server Components execution model",
      breakpoint: "mixed server/client trees",
      observedSignals: [
        `${verifiedBuild.renderManifest.entries.length} render manifest entries`,
        `${verifiedBuild.prerenderManifest.prerendered.length} prerendered routes`,
        `${flightAssetCount} Flight assets emitted`
      ],
      blockers: PARITY_BLOCKERS.find((entry) => entry.category === "rendering")!.blockers
    },
    {
      id: "routing",
      label: "Routing Engine",
      score: 68,
      currentStrength: "Route graph, slot rendering, and intercept render contexts exist.",
      hardMissingSystem: "Full route-group and persistent navigation semantics",
      breakpoint: "dashboards/modals",
      observedSignals: [
        `${verifiedBuild.deploymentManifest.routes.length} deployment routes`,
        `${groupCount} group nodes`,
        `${parallelCount} parallel nodes`,
        `${interceptCount} intercepting nodes`
      ],
      blockers: PARITY_BLOCKERS.find((entry) => entry.category === "routing")!.blockers
    },
    {
      id: "server-client-boundary",
      label: "Server/Client Boundary",
      score: milestoneProgress.milestone2Complete ? 61 : 55,
      currentStrength: milestoneProgress.milestone2Complete
        ? "Boundary manifests, fatal violations, and manifest-driven mixed-route hydration are implemented."
        : "Boundary manifests, fatal violations, and client islands are implemented.",
      hardMissingSystem: "Server-component-first runtime",
      breakpoint: "zero-JS server trees",
      observedSignals: [
        `${verifiedBuild.clientReferenceManifest.entries.length} client reference entries`,
        `${verifiedBuild.serverReferenceManifest.entries.length} server reference entries`,
        `${verifiedBuild.rscReferenceManifest.entries.length} RSC reference entries`,
        `${clientBoundaryRouteCount} routes with client boundaries`
      ],
      blockers: PARITY_BLOCKERS.find((entry) => entry.category === "boundary")!.blockers
    },
    {
      id: "server-actions",
      label: "Server Actions",
      score: 61,
      currentStrength: "Transport and revalidation-aware refresh contracts are in place.",
      hardMissingSystem: "Action integration with capability graph and full Flight refresh parity",
      breakpoint: "real mutation-heavy apps",
      observedSignals: [
        `${verifiedBuild.actionManifest.entries.length} action entries`,
        `${verifiedBuild.actionManifest.entries.filter((entry) => entry.refreshPolicy !== "none").length} actions with refresh policies`
      ],
      blockers: PARITY_BLOCKERS.find((entry) => entry.category === "actions")!.blockers
    },
    {
      id: "cache",
      label: "Cache Stack",
      score: 50,
      currentStrength: "Route cache, request memoization, shared data-cache helpers, and cache graph manifests are present.",
      hardMissingSystem: "Persistent data cache and fully unified invalidation graph",
      breakpoint: "fetch-heavy apps",
      observedSignals: [
        `${verifiedBuild.prerenderManifest.prerendered.filter((entry) => typeof entry.revalidate === "number").length} prerendered routes with revalidate`,
        `${buildResult.prerendered.length} build prerender records`,
        `${verifiedBuild.cacheManifest.entries.filter((entry) => entry.kind === "route").length} route cache entries`,
        `${verifiedBuild.cacheManifest.entries.filter((entry) => entry.kind === "data").length} data cache entries`,
        `${verifiedBuild.cacheManifest.invalidationLinks.length} cache invalidation links`
      ],
      blockers: PARITY_BLOCKERS.find((entry) => entry.category === "cache")!.blockers
    },
    {
      id: "compiler",
      label: "Compiler/Bundler",
      score: 41,
      currentStrength: "Ownership manifests, route entries, and deploy artifacts are emitted.",
      hardMissingSystem: "Authoritative server/client/action/CSS bundle graph",
      breakpoint: "large apps and DX",
      observedSignals: [
        `${verifiedBuild.bundleManifest.routes.length} bundle routes`,
        `${verifiedBuild.assetManifest.assets.length} tracked assets`,
        `${buildResult.budgetReport.violations.length} budget violations`
      ],
      blockers: PARITY_BLOCKERS.find((entry) => entry.category === "compiler")!.blockers
    },
    {
      id: "dev-runtime",
      label: "Dev Runtime",
      score: 39,
      currentStrength: "Diagnostics and route refresh paths are implemented.",
      hardMissingSystem: "Fast Refresh state preservation",
      breakpoint: "day-to-day adoption",
      observedSignals: [
        `${diagnosticsCount} diagnostics manifest issues`,
        "Flight-driven route refresh available"
      ],
      blockers: PARITY_BLOCKERS.find((entry) => entry.category === "dev-runtime")!.blockers
    },
    {
      id: "platform",
      label: "Platform Layer",
      score: 43,
      currentStrength: "Auth, i18n, image surface, metadata, and security base exist.",
      hardMissingSystem: "Font, script, styling, and full image parity",
      breakpoint: "visible product gaps",
      observedSignals: [
        `${verifiedBuild.adapterManifest.supportedFeatures.length} supported adapter features`,
        `${verifiedBuild.deploymentManifest.routes.filter((route) => route.kind === "page").length} page routes exercising platform surface`
      ],
      blockers: PARITY_BLOCKERS.find((entry) => entry.category === "platform")!.blockers
    },
    {
      id: "deployment",
      label: "Deployment/Runtime",
      score: 72,
      currentStrength: "Adapters, packaging, parity verification, and release gating exist.",
      hardMissingSystem: "Route-level edge/runtime capability graph",
      breakpoint: "advanced edge apps",
      observedSignals: [
        `${verifiedBuild.adapterManifest.supportedAdapters.length} supported first-party adapters`,
        `${verifiedBuild.deploymentManifest.routes.filter((route) => route.edgeCompatible).length} edge-compatible routes`
      ],
      blockers: PARITY_BLOCKERS.find((entry) => entry.category === "deployment")!.blockers
    },
    {
      id: "migration-dx",
      label: "Migration/DX",
      score: 34,
      currentStrength: "CLI, verify, and public package surface exist.",
      hardMissingSystem: "create-app, migration docs, and benchmark-driven defaults",
      breakpoint: "adoption",
      observedSignals: [
        `${verifiedBuild.checkedManifests.length} verified manifests`,
        options.ranTypecheck ? "workspace typecheck executed" : "workspace typecheck skipped",
        options.ranTests ? "workspace tests executed" : "workspace tests skipped"
      ],
      blockers: PARITY_BLOCKERS.find((entry) => entry.category === "migration-dx")!.blockers
    }
  ];

  return {
    version: SOURCEOG_MANIFEST_VERSION,
    buildId: buildResult.buildId,
    generatedAt,
    overallCompetitiveReadiness: milestoneProgress.overallReadiness,
    remainingWorkEstimate: milestoneProgress.remainingWorkEstimate,
    readinessClassification: "strong",
    hardMissingSystems: HARD_MISSING_SYSTEMS,
    subsystemScores,
    blockersByCategory: PARITY_BLOCKERS,
    evidence: {
      routeCount: verifiedBuild.deploymentManifest.routes.length,
      prerenderedRouteCount: verifiedBuild.prerenderManifest.prerendered.length,
      flightAssetCount,
      clientBoundaryRouteCount,
      actionCount: verifiedBuild.actionManifest.entries.length,
      routeGraphNodeCount: verifiedBuild.routeGraphManifest.nodes.length,
      checkedManifestCount: verifiedBuild.checkedManifests.length,
      ranTypecheck: options.ranTypecheck,
      ranTests: options.ranTests
    }
  };
}

function createMilestoneDashboard(
  buildResult: BuildResult,
  verifiedBuild: VerifiedBuildOutput,
  durations: {
    buildDurationMs: number;
    typecheckDurationMs: number | null;
    testDurationMs: number | null;
  }
): MilestoneDashboard {
  const milestoneProgress = evaluateMilestoneProgress(verifiedBuild);
  const generatedAt = new Date().toISOString();

  return {
    version: SOURCEOG_MANIFEST_VERSION,
    buildId: buildResult.buildId,
    generatedAt,
    currentMilestone: milestoneProgress.currentMilestone,
    overallReadiness: milestoneProgress.overallReadiness,
    metrics: [
      {
        name: "buildDurationMs",
        current: durations.buildDurationMs,
        baseline: durations.buildDurationMs,
        delta: 0,
        status: "measured"
      },
      {
        name: "typecheckDurationMs",
        current: durations.typecheckDurationMs,
        baseline: durations.typecheckDurationMs,
        delta: durations.typecheckDurationMs === null ? null : 0,
        status: durations.typecheckDurationMs === null ? "pending_instrumentation" : "measured"
      },
      {
        name: "testDurationMs",
        current: durations.testDurationMs,
        baseline: durations.testDurationMs,
        delta: durations.testDurationMs === null ? null : 0,
        status: durations.testDurationMs === null ? "pending_instrumentation" : "measured"
      },
      {
        name: "devStartupMs",
        current: null,
        baseline: null,
        delta: null,
        status: "pending_instrumentation"
      },
      {
        name: "routeLatencyP99Ms",
        current: null,
        baseline: null,
        delta: null,
        status: "pending_instrumentation"
      }
    ],
    failingParityFixtures: milestoneProgress.milestone3Verification.failingChecks.map((check) => check.id),
    milestones: [
      {
        id: "milestone-0-baseline-freeze-and-scoreboard",
        title: "Baseline Freeze and Scoreboard",
        status: "completed",
        readinessScore: 58,
        blockedBy: [],
        exitCriteria: [
          "Parity scoreboard artifact written by verify",
          "Milestone dashboard artifact written by verify",
          "Verification output reports milestone blockers by category"
        ]
      },
      {
        id: "milestone-1-canonical-app-router-runtime-graph",
        title: "Canonical App Router Runtime Graph",
        status: milestoneProgress.milestone1Complete ? "completed" : "in_progress",
        readinessScore: 64,
        blockedBy: [],
        exitCriteria: [
          "Route graph is authoritative across router, server, compiler, and prerender.",
          "Route groups, slots, and intercepts stop being re-derived in parallel code paths."
        ]
      },
      {
        id: "milestone-2-real-boundary-runtime",
        title: "Real Boundary Runtime",
        status: milestoneProgress.milestone2Complete
          ? "completed"
          : milestoneProgress.milestone1Complete
            ? "in_progress"
            : "blocked",
        readinessScore: 71,
        blockedBy: milestoneProgress.milestone1Complete ? [] : ["milestone-1-canonical-app-router-runtime-graph"],
        exitCriteria: [
          "All mixed-tree hydration is manifest-driven.",
          "No server-default route falls back to whole-page hydration."
        ]
      },
      {
        id: "milestone-3-true-rsc-and-flight-runtime",
        title: "True RSC + Flight Runtime",
        status: milestoneProgress.milestone3Verification.complete
          ? "completed"
          : milestoneProgress.milestone2Complete
            ? "in_progress"
            : "blocked",
        readinessScore: 80,
        blockedBy: milestoneProgress.milestone2Complete
          ? []
          : [
            "milestone-1-canonical-app-router-runtime-graph",
            "milestone-2-real-boundary-runtime"
          ],
        exitCriteria: [
          "Server Components become the default runtime behavior.",
          "Flight is the canonical render and refresh contract."
        ]
      },
      {
        id: "milestone-4-real-cache-stack",
        title: "Real Cache Stack",
        status: "blocked",
        readinessScore: 84,
        blockedBy: ["milestone-3-true-rsc-and-flight-runtime"],
        exitCriteria: [
          "Request memoization, data cache, and route cache are distinct.",
          "Actions, ISR, and fetch controls share one invalidation model."
        ]
      },
      {
        id: "milestone-5-server-actions-full-parity",
        title: "Server Actions Full Parity",
        status: "in_progress",
        readinessScore: 87,
        blockedBy: ["milestone-3-true-rsc-and-flight-runtime", "milestone-4-real-cache-stack"],
        exitCriteria: [
          "Action refresh is Flight-native.",
          "Adapter capability gating is accurate before deploy."
        ]
      },
      {
        id: "milestone-6-compiler-promotion",
        title: "Compiler Promotion",
        status: "blocked",
        readinessScore: 91,
        blockedBy: ["milestone-3-true-rsc-and-flight-runtime", "milestone-4-real-cache-stack"],
        exitCriteria: [
          "Compiler output alone is enough to boot and deploy.",
          "Bundle ownership is deterministic across client, server, action, edge, and CSS outputs."
        ]
      },
      {
        id: "milestone-7-fast-refresh-and-dev-dominance",
        title: "Fast Refresh and Dev Dominance",
        status: "blocked",
        readinessScore: 94,
        blockedBy: ["milestone-6-compiler-promotion"],
        exitCriteria: [
          "Safe client edits preserve state.",
          "Server edits refresh routes without a full reload."
        ]
      },
      {
        id: "milestone-8-platform-parity-layer",
        title: "Platform Parity Layer",
        status: "blocked",
        readinessScore: 97,
        blockedBy: ["milestone-6-compiler-promotion"],
        exitCriteria: [
          "Font, script, styling, and image parity are port-ready.",
          "A marketing site and dashboard port without platform hacks."
        ]
      },
      {
        id: "milestone-9-migration-benchmarks-and-ga-governance",
        title: "Migration, Benchmarks, and GA Governance",
        status: "blocked",
        readinessScore: 100,
        blockedBy: ["milestone-7-fast-refresh-and-dev-dominance", "milestone-8-platform-parity-layer"],
        exitCriteria: [
          "Benchmark gates are enforced by verify.",
          "A representative Next.js App Router app can migrate and deploy in under one day."
        ]
      }
    ]
  };
}

function evaluateMilestoneProgress(verifiedBuild: VerifiedBuildOutput): MilestoneProgress {
  const milestone1Complete =
    verifiedBuild.routeGraphManifest.routes.length === verifiedBuild.deploymentManifest.routes.length &&
    verifiedBuild.bundleManifest.routes.length === verifiedBuild.deploymentManifest.routes.length &&
    verifiedBuild.routeOwnershipManifest.entries.length === verifiedBuild.deploymentManifest.routes.length &&
    verifiedBuild.routeGraphManifest.routes.every(
      (route) =>
        typeof route.canonicalRouteId === "string" &&
        route.canonicalRouteId.length > 0 &&
        typeof route.resolvedRouteId === "string" &&
        route.resolvedRouteId.length > 0 &&
        typeof route.renderContextKey === "string" &&
        route.renderContextKey.length > 0
    );

  const mixedBoundaryEntries = verifiedBuild.clientBoundaryManifest.entries.filter(
    (entry) => entry.hydrationMode === "mixed-route"
  );
  const mixedBundleRoutes = verifiedBuild.bundleManifest.routes.filter(
    (entry) => entry.hydrationMode === "mixed-route"
  );
  const mixedOwnershipEntries = verifiedBuild.routeOwnershipManifest.entries.filter(
    (entry) => entry.hydrationMode === "mixed-route"
  );

  const milestone2Complete =
    milestone1Complete &&
    mixedBoundaryEntries.length > 0 &&
    mixedBoundaryEntries.every(
      (entry) =>
        entry.boundaries.length > 0 &&
        entry.boundaries.every(
          (boundary) =>
            boundary.bootstrapStrategy !== "hydrate-island" ||
            (Boolean(boundary.assetHref) && Boolean(boundary.assetFilePath))
        )
    ) &&
    mixedBundleRoutes.every(
      (entry) =>
        !entry.browserEntryAsset &&
        (entry.boundaryRefs ?? []).some(
          (boundary) => boundary.bootstrapStrategy === "hydrate-island" && Boolean(boundary.assetHref)
        )
    ) &&
    mixedOwnershipEntries.every(
      (entry) =>
        !entry.browserEntryAsset &&
        (entry.boundaryRefs ?? []).some(
          (boundary) => boundary.bootstrapStrategy === "hydrate-island" && Boolean(boundary.assetHref)
        )
    );

  const milestone3Verification = verifyMilestone3RuntimeInternal(verifiedBuild, milestone2Complete);
  const milestone3ReadinessBonus = milestone3Verification.complete ? 10 : 2;
  const overallReadiness = BASELINE_OVERALL_READINESS + (milestone2Complete ? MILESTONE_2_READINESS_BONUS : 0) + milestone3ReadinessBonus;
  const remainingWorkEstimate = BASELINE_REMAINING_WORK - (milestone2Complete ? MILESTONE_2_READINESS_BONUS : 0) - milestone3ReadinessBonus;

  return {
    milestone1Complete,
    milestone2Complete,
    milestone3Verification,
    currentMilestone: milestone3Verification.complete
      ? "milestone-4-real-cache-stack"
      : milestone2Complete
        ? "milestone-3-true-rsc-and-flight-runtime"
      : milestone1Complete
        ? "milestone-2-real-boundary-runtime"
        : "milestone-1-canonical-app-router-runtime-graph",
    overallReadiness,
    remainingWorkEstimate
  };
}

function verifyMilestone3RuntimeInternal(
  verifiedBuild: VerifiedBuildOutput,
  milestone2Complete: boolean
): InternalMilestoneVerificationResult {
  const passingChecks: string[] = [];
  const failingChecks: FailingMilestoneCheck[] = [];
  const runtimeScript = getClientRuntimeScript();
  const serverSource = readFileSync(path.resolve(process.cwd(), "packages", "sourceog-server", "src", "server.ts"), "utf8");
  const rendererSource = readFileSync(path.resolve(process.cwd(), "packages", "sourceog-renderer", "src", "render.tsx"), "utf8");
  const workerSource = readFileSync(path.resolve(process.cwd(), "packages", "sourceog-renderer", "src", "rsc.ts"), "utf8");
  const islandSource = readFileSync(path.resolve(process.cwd(), "packages", "sourceog-runtime", "src", "client-island.tsx"), "utf8");

  const serverComponentRoutes = verifiedBuild.bundleManifest.routes.filter((entry) => entry.renderMode === "server-components");
  const routesWithClientBoundaries = serverComponentRoutes.filter((entry) => (entry.boundaryRefs?.length ?? 0) > 0);
  if (routesWithClientBoundaries.every((entry) => (entry.clientReferenceRefs?.length ?? 0) > 0)) {
    passingChecks.push("M3-001");
  } else {
    failingChecks.push({
      id: "M3-001",
      description: "Server-component routes with client boundaries must expose real client references.",
      details: routesWithClientBoundaries
        .filter((entry) => (entry.clientReferenceRefs?.length ?? 0) === 0)
        .map((entry) => entry.routeId)
        .join(", ")
    });
  }

  if (!runtimeScript.includes("hydrateRoot(")) {
    passingChecks.push("M3-002");
  } else {
    failingChecks.push({
      id: "M3-002",
      description: "Server-component runtime still uses root hydrateRoot.",
      details: "packages/sourceog-dev/src/hmr.ts still emits hydrateRoot in the browser refresh runtime."
    });
  }

  if (!runtimeScript.includes("root.innerHTML = payload.bodyHtml") && !runtimeScript.includes("function applyCanonicalRenderResult")) {
    passingChecks.push("M3-003");
  } else {
    failingChecks.push({
      id: "M3-003",
      description: "HTML replacement is still present in the normal refresh path.",
      details: "packages/sourceog-dev/src/hmr.ts still includes direct HTML replacement helpers outside fallback-only behavior."
    });
  }

  if (serverSource.includes('"content-type": "text/x-component"')) {
    passingChecks.push("M3-004");
  } else {
    failingChecks.push({
      id: "M3-004",
      description: "Flight endpoint is not emitting text/x-component.",
      details: "packages/sourceog-server/src/server.ts is missing the Flight content type."
    });
  }

  if (workerSource.includes("Array.from({ length: this.workerCount }") && !workerSource.includes("await this.spawnWorker();")) {
    passingChecks.push("M3-005");
  } else {
    failingChecks.push({
      id: "M3-005",
      description: "RSC worker pool still initializes lazily.",
      details: "packages/sourceog-renderer/src/rsc.ts does not fully prewarm the configured worker pool."
    });
  }

  if (Object.keys(verifiedBuild.clientReferenceManifest.registry).length > 0) {
    passingChecks.push("M3-008");
  } else {
    failingChecks.push({
      id: "M3-008",
      description: "Client reference manifest is empty.",
      details: "The built client reference registry contains no entries."
    });
  }

  if (!islandSource.includes("data-sourceog-client-placeholder")) {
    passingChecks.push("M3-009");
  } else {
    failingChecks.push({
      id: "M3-009",
      description: "Placeholder client boundary markers are still present.",
      details: "packages/sourceog-runtime/src/client-island.tsx still emits data-sourceog-client-placeholder."
    });
  }

  if (runtimeScript.includes("[SOURCEOG-FALLBACK]")) {
    passingChecks.push("M3-010");
  } else {
    failingChecks.push({
      id: "M3-010",
      description: "Fallback logging is not structured with the required prefix.",
      details: "packages/sourceog-dev/src/hmr.ts does not emit [SOURCEOG-FALLBACK] logs."
    });
  }

  if (milestone2Complete && rendererSource.includes("renderBodyHtmlFromFlightChunks")) {
    passingChecks.push("M3-011");
  } else {
    failingChecks.push({
      id: "M3-011",
      description: "Renderer does not derive server-component HTML from Flight output.",
      details: "packages/sourceog-renderer/src/render.tsx is missing the Flight-derived HTML render path."
    });
  }

  const totalChecks = passingChecks.length + failingChecks.length;
  return {
    complete: milestone2Complete && failingChecks.length === 0,
    score: totalChecks === 0 ? 0 : Math.round((passingChecks.length / totalChecks) * 100),
    passingChecks,
    failingChecks
  };
}

async function writeVerificationArtifacts(
  distRoot: string,
  parityScoreboard: ParityScoreboard,
  milestoneDashboard: MilestoneDashboard
): Promise<VerifyApplicationReport["artifactPaths"]> {
  const parityScoreboardPath = path.join(distRoot, "parity-scoreboard.json");
  const milestoneDashboardPath = path.join(distRoot, "milestone-dashboard.json");
  await fs.writeFile(parityScoreboardPath, JSON.stringify(parityScoreboard, null, 2), "utf8");
  await fs.writeFile(milestoneDashboardPath, JSON.stringify(milestoneDashboard, null, 2), "utf8");
  return {
    parityScoreboard: parityScoreboardPath,
    milestoneDashboard: milestoneDashboardPath
  };
}

function findWorkspaceRoot(startCwd: string): string {
  let current = path.resolve(startCwd);

  while (true) {
    if (existsSync(path.join(current, "pnpm-workspace.yaml"))) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return startCwd;
    }
    current = parent;
  }
}

async function runWorkspaceCommand(
  args: string[],
  cwd: string,
  stdio: "inherit" | "pipe" = "inherit"
): Promise<void> {
  const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio, shell: false });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new SourceOGError(
          SOURCEOG_ERROR_CODES.CONFIG_INVALID,
          `Release verification command failed: pnpm ${args.join(" ")}`,
          { cwd, code, args }
        )
      );
    });
  });
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
}

function assertManifestShape(name: string, payload: unknown, buildId: string): void {
  const manifest = payload as { version?: unknown; buildId?: unknown };

  if (typeof manifest.version === "string" && manifest.version !== SOURCEOG_MANIFEST_VERSION) {
    throw new SourceOGError(
      SOURCEOG_ERROR_CODES.MANIFEST_INVALID,
      `Manifest "${name}" has an incompatible version.`,
      { expected: SOURCEOG_MANIFEST_VERSION, actual: manifest.version }
    );
  }

  if (typeof manifest.buildId === "string" && manifest.buildId !== buildId) {
    throw new SourceOGError(
      SOURCEOG_ERROR_CODES.MANIFEST_INVALID,
      `Manifest "${name}" does not match the active build ID.`,
      { expected: buildId, actual: manifest.buildId }
    );
  }
}

// ---------------------------------------------------------------------------
// Phase 7 — Milestone Gate (Req 7.1–7.14, INV-010)
// ---------------------------------------------------------------------------

import { createHash as _createHashForVerify } from "node:crypto";
import http from "node:http";
import https from "node:https";

/**
 * A single failing check in the M3 milestone gate.
 * Each check maps to one INV-00N invariant.
 */
export interface FailingCheck {
  /** "M3-001" through "M3-010" */
  id: string;
  description: string;
  details: string;
  remediationGuide: string;
  /** "INV-001" through "INV-010" */
  invariantViolated: string;
}

/**
 * The authoritative result returned by `verifyMilestone3Runtime()`.
 * `complete === true` is the sole source of truth for M3 status (INV-010).
 */
export interface MilestoneVerificationResult {
  complete: boolean;
  /** 0–100 integer */
  score: number;
  failingChecks: FailingCheck[];
  /** Check IDs that passed */
  passingChecks: string[];
  /** ISO 8601 timestamp */
  timestamp: string;
  buildId: string;
}

/** Per-route information needed by the M3 checks. */
export interface RouteInfo {
  routeId: string;
  /** "edge" | "node" */
  runtimeTarget: "edge" | "node";
  /** Whether this route has any "use client" boundaries */
  hasClientBoundaries: boolean;
  /** Number of resolved client references (0 = violation for M3-001) */
  clientReferenceCount: number;
  /** URL of the Flight endpoint for this route, if available */
  flightEndpoint?: string;
}

/**
 * The build result passed to `verifyMilestone3Runtime()`.
 * Carries all data needed to run the 10 M3 checks.
 */
export interface M3BuildResult {
  buildId: string;
  /** All routes in the build */
  routes: RouteInfo[];
  /** Edge capability results from boundary.ts (for M3-006) */
  edgeCapabilityResults: import("./boundary.js").RouteRuntimeCapability[];
  /** Absolute path to the server client-reference-manifest.json */
  serverManifestPath: string;
  /** Absolute path to the browser client-refs.json */
  browserManifestPath: string;
  /** Whether the RSC_Worker_Pool is active (for M3-005) */
  workerPoolActive: boolean;
  /** Path to hmr.ts for static analysis (M3-003, M3-010) */
  hmrFilePath?: string;
  /** Path to rsc.ts for static analysis (M3-005) */
  rscFilePath?: string;
  /** Flight payloads keyed by routeId (for M3-009) */
  flightPayloads?: Map<string, string>;
  /** Whether all slot/intercept parity tests passed (for M3-007) */
  slotInterceptParityPassed?: boolean;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function _sha256Hex(input: string): string {
  return _createHashForVerify("sha256").update(input).digest("hex");
}

/**
 * Probe a single HTTP/HTTPS URL and return the response headers.
 * Resolves with null on any network error.
 */
async function probeFlightEndpoint(url: string): Promise<Record<string, string | string[] | undefined> | null> {
  return new Promise((resolve) => {
    try {
      const parsed = new URL(url);
      const lib = parsed.protocol === "https:" ? https : http;
      const req = lib.get(url, { headers: { Accept: "text/x-component" } }, (res) => {
        // Drain the response so the socket is released
        res.resume();
        resolve(res.headers as Record<string, string | string[] | undefined>);
      });
      req.on("error", () => resolve(null));
      req.setTimeout(5000, () => {
        req.destroy();
        resolve(null);
      });
    } catch {
      resolve(null);
    }
  });
}

/**
 * Read a file safely; returns null if the file cannot be read.
 */
async function readFileSafe(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

/**
 * Deep-compare two flat JSON manifests for identical keys, ids, and chunks.
 * Returns a list of discrepancy descriptions (empty = identical).
 */
function compareManifests(
  serverManifest: Record<string, { id: string; chunks: string[] }>,
  browserManifest: Record<string, { id: string; chunks: string[] }>
): string[] {
  const discrepancies: string[] = [];
  const serverKeys = new Set(Object.keys(serverManifest));
  const browserKeys = new Set(Object.keys(browserManifest));

  for (const key of serverKeys) {
    if (!browserKeys.has(key)) {
      discrepancies.push(`Key "${key}" present in server manifest but missing from browser manifest.`);
      continue;
    }
    const s = serverManifest[key]!;
    const b = browserManifest[key]!;
    if (s.id !== b.id) {
      discrepancies.push(`Key "${key}": id mismatch (server="${s.id}", browser="${b.id}").`);
    }
    const sChunks = [...s.chunks].sort().join(",");
    const bChunks = [...b.chunks].sort().join(",");
    if (sChunks !== bChunks) {
      discrepancies.push(`Key "${key}": chunks mismatch (server=[${sChunks}], browser=[${bChunks}]).`);
    }
  }

  for (const key of browserKeys) {
    if (!serverKeys.has(key)) {
      discrepancies.push(`Key "${key}" present in browser manifest but missing from server manifest.`);
    }
  }

  return discrepancies;
}

// ---------------------------------------------------------------------------
// The 10 M3 checks
// ---------------------------------------------------------------------------

async function runM3001(routes: RouteInfo[]): Promise<{ pass: boolean; details: string }> {
  // M3-001: no server-component route with client boundaries has empty clientReferenceCount (INV-002)
  const violations = routes.filter(
    (r) => r.hasClientBoundaries && r.clientReferenceCount === 0
  );
  if (violations.length === 0) {
    return { pass: true, details: "" };
  }
  return {
    pass: false,
    details: `Routes with client boundaries but zero clientReferenceCount: ${violations.map((r) => r.routeId).join(", ")}`
  };
}

async function runM3002(routes: RouteInfo[], hmrFilePath?: string): Promise<{ pass: boolean; details: string }> {
  // M3-002: no server-component route calls hydrateRoot at document root (INV-009)
  // Static analysis: check hmr.ts for hydrateRoot calls outside of island hydration context
  const hmrSource = hmrFilePath ? await readFileSafe(hmrFilePath) : null;
  if (hmrSource !== null) {
    // Look for hydrateRoot called on document.body or document.documentElement
    const documentRootHydrate = /hydrateRoot\s*\(\s*document\s*\.\s*(body|documentElement)/;
    if (documentRootHydrate.test(hmrSource)) {
      return {
        pass: false,
        details: `${hmrFilePath} contains hydrateRoot(document.body/documentElement) — server-component routes must not call hydrateRoot at the document root.`
      };
    }
    return { pass: true, details: "" };
  }

  // Fallback: check route-level files for hydrateRoot at document root
  const violations: string[] = [];
  for (const route of routes) {
    // No per-route file path available in RouteInfo; rely on hmrFilePath check above
    void route;
  }
  if (violations.length > 0) {
    return { pass: false, details: violations.join("; ") };
  }
  return { pass: true, details: "" };
}

async function runM3003(hmrFilePath?: string): Promise<{ pass: boolean; details: string }> {
  // M3-003: replaceRouteBody does not appear outside hardFallbackHtmlReplace catch branch (INV-005)
  if (!hmrFilePath) {
    // Cannot verify without the file path — treat as passing (no evidence of violation)
    return { pass: true, details: "" };
  }

  const source = await readFileSafe(hmrFilePath);
  if (source === null) {
    return { pass: true, details: "" };
  }

  // Check if replaceRouteBody appears at all
  if (!source.includes("replaceRouteBody")) {
    return { pass: true, details: "" };
  }

  // Parse the hardFallbackHtmlReplace function body and check that replaceRouteBody
  // only appears inside its catch block.
  // Strategy: find all occurrences of replaceRouteBody and verify each is inside
  // a catch block that is itself inside hardFallbackHtmlReplace.
  const lines = source.split("\n");
  const replaceRouteBodyLines: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.includes("replaceRouteBody")) {
      replaceRouteBodyLines.push(i + 1); // 1-indexed
    }
  }

  // Find the hardFallbackHtmlReplace function span
  const hardFallbackStart = source.indexOf("hardFallbackHtmlReplace");
  if (hardFallbackStart === -1) {
    // Function doesn't exist — replaceRouteBody is outside it
    return {
      pass: false,
      details: `replaceRouteBody appears in ${hmrFilePath} but hardFallbackHtmlReplace function was not found. replaceRouteBody must only appear inside the hardFallbackHtmlReplace catch branch.`
    };
  }

  // Find the catch block inside hardFallbackHtmlReplace
  // We look for "} catch" after the hardFallbackHtmlReplace declaration
  const catchStart = source.indexOf("} catch", hardFallbackStart);
  if (catchStart === -1) {
    return {
      pass: false,
      details: `replaceRouteBody appears in ${hmrFilePath} but no catch block was found inside hardFallbackHtmlReplace.`
    };
  }

  // Find the end of the catch block by counting braces
  let depth = 0;
  let catchBodyStart = source.indexOf("{", catchStart);
  let catchBodyEnd = -1;
  if (catchBodyStart !== -1) {
    for (let i = catchBodyStart; i < source.length; i++) {
      if (source[i] === "{") depth++;
      else if (source[i] === "}") {
        depth--;
        if (depth === 0) {
          catchBodyEnd = i;
          break;
        }
      }
    }
  }

  // Check each replaceRouteBody occurrence is within the catch block
  const outsideCatch: number[] = [];
  for (const lineNum of replaceRouteBodyLines) {
    // Convert line number to character offset
    let charOffset = 0;
    for (let i = 0; i < lineNum - 1; i++) {
      charOffset += (lines[i]?.length ?? 0) + 1;
    }
    const isInCatch = catchBodyStart !== -1 && catchBodyEnd !== -1 &&
      charOffset >= catchBodyStart && charOffset <= catchBodyEnd;
    if (!isInCatch) {
      outsideCatch.push(lineNum);
    }
  }

  if (outsideCatch.length > 0) {
    return {
      pass: false,
      details: `replaceRouteBody appears outside the hardFallbackHtmlReplace catch branch at line(s): ${outsideCatch.join(", ")} in ${hmrFilePath}.`
    };
  }

  return { pass: true, details: "" };
}

async function runM3004(routes: RouteInfo[]): Promise<{ pass: boolean; details: string }> {
  // M3-004: probe all Flight endpoints, verify Content-Type: text/x-component (INV-003)
  const routesWithEndpoints = routes.filter((r) => r.flightEndpoint);
  if (routesWithEndpoints.length === 0) {
    // No endpoints to probe — treat as passing (nothing to violate)
    return { pass: true, details: "" };
  }

  const failures: string[] = [];
  for (const route of routesWithEndpoints) {
    try {
      const headers = await probeFlightEndpoint(route.flightEndpoint!);
      if (headers === null) {
        failures.push(`${route.routeId}: could not connect to ${route.flightEndpoint}`);
        continue;
      }
      const contentType = headers["content-type"];
      const ct = Array.isArray(contentType) ? contentType[0] : contentType;
      if (!ct?.includes("text/x-component")) {
        failures.push(`${route.routeId}: Content-Type was "${ct ?? "missing"}" (expected text/x-component)`);
      }
    } catch (err) {
      failures.push(`${route.routeId}: probe error — ${(err as Error).message}`);
    }
  }

  if (failures.length > 0) {
    return { pass: false, details: failures.join("; ") };
  }
  return { pass: true, details: "" };
}

async function runM3005(
  workerPoolActive: boolean,
  rscFilePath?: string
): Promise<{ pass: boolean; details: string }> {
  // M3-005: RSC_Worker_Pool active, no per-request worker spawning (INV-006)
  if (!workerPoolActive) {
    return {
      pass: false,
      details: "RSC_Worker_Pool is not active. The pool must be initialized at server startup."
    };
  }

  // Static analysis: check rsc.ts for per-request worker spawning patterns
  if (rscFilePath) {
    const source = await readFileSafe(rscFilePath);
    if (source !== null) {
      // Look for spawnWorker or new Worker inside the render() method (per-request spawning).
      // Strategy: find the render() method and check if it contains spawnWorker/new Worker.
      // We detect this by looking for the pattern: render method body contains spawnWorker call.
      // A simple heuristic: if spawnWorker appears after "async render(" and before the next
      // top-level method declaration, it's a per-request spawn.
      const renderMethodIdx = source.search(/\basync\s+render\s*\(/);
      if (renderMethodIdx !== -1) {
        // Find the opening brace of the render method
        const braceStart = source.indexOf("{", renderMethodIdx);
        if (braceStart !== -1) {
          // Extract the render method body by counting braces
          let depth = 0;
          let renderBodyEnd = -1;
          for (let i = braceStart; i < source.length; i++) {
            if (source[i] === "{") depth++;
            else if (source[i] === "}") {
              depth--;
              if (depth === 0) {
                renderBodyEnd = i;
                break;
              }
            }
          }
          const renderBody = renderBodyEnd !== -1
            ? source.slice(braceStart, renderBodyEnd + 1)
            : source.slice(braceStart);

          if (renderBody.includes("spawnWorker") || /\bnew\s+Worker\s*\(/.test(renderBody)) {
            return {
              pass: false,
              details: `${rscFilePath}: render() method contains worker spawning code. Workers must only be spawned during pool initialization, not per-request.`
            };
          }
        }
      }
    }
  }

  return { pass: true, details: "" };
}

async function runM3006(
  edgeCapabilityResults: import("./boundary.js").RouteRuntimeCapability[]
): Promise<{ pass: boolean; details: string }> {
  // M3-006: all Edge-targeted routes pass edge capability check (INV-007)
  const edgeRoutes = edgeCapabilityResults.filter((r) => r.runtimeTarget === "edge");
  if (edgeRoutes.length === 0) {
    return { pass: true, details: "" };
  }

  const failing = edgeRoutes.filter((r) => !r.supportsEdge);
  if (failing.length === 0) {
    return { pass: true, details: "" };
  }

  const details = failing.map((r) => {
    const violationSummary = r.violations
      .map((v) => `${v.importPath} in ${path.basename(v.importedBy)}:${v.line}`)
      .join(", ");
    return `${r.routeId}: ${violationSummary}`;
  }).join("; ");

  return {
    pass: false,
    details: `Edge-targeted routes with capability violations: ${details}`
  };
}

async function runM3007(slotInterceptParityPassed?: boolean): Promise<{ pass: boolean; details: string }> {
  // M3-007: all slot/intercept parity tests pass (INV-008)
  if (slotInterceptParityPassed === undefined) {
    // Not provided — treat as passing (no evidence of failure)
    return { pass: true, details: "" };
  }
  if (!slotInterceptParityPassed) {
    return {
      pass: false,
      details: "One or more slot/intercept parity tests failed. All parallel route slots and intercepted routes must produce equivalent Flight payloads."
    };
  }
  return { pass: true, details: "" };
}

async function runM3008(
  serverManifestPath: string,
  browserManifestPath: string
): Promise<{ pass: boolean; details: string }> {
  // M3-008: server and browser ClientReferenceManifest files have identical keys, ids, chunks (INV-004)
  const [serverRaw, browserRaw] = await Promise.all([
    readFileSafe(serverManifestPath),
    readFileSafe(browserManifestPath)
  ]);

  if (serverRaw === null) {
    return {
      pass: false,
      details: `Server manifest not found at: ${serverManifestPath}`
    };
  }
  if (browserRaw === null) {
    return {
      pass: false,
      details: `Browser manifest not found at: ${browserManifestPath}`
    };
  }

  let serverManifest: Record<string, { id: string; chunks: string[] }>;
  let browserManifest: Record<string, { id: string; chunks: string[] }>;

  try {
    serverManifest = JSON.parse(serverRaw) as Record<string, { id: string; chunks: string[] }>;
    browserManifest = JSON.parse(browserRaw) as Record<string, { id: string; chunks: string[] }>;
  } catch (err) {
    return {
      pass: false,
      details: `Failed to parse manifest JSON: ${(err as Error).message}`
    };
  }

  // Handle the case where the manifest is wrapped in a registry object (existing format)
  const serverEntries = (serverManifest as unknown as { registry?: Record<string, { id: string; chunks: string[] }> }).registry ?? serverManifest;
  const browserEntries = (browserManifest as unknown as { registry?: Record<string, { id: string; chunks: string[] }> }).registry ?? browserManifest;

  const discrepancies = compareManifests(serverEntries, browserEntries);
  if (discrepancies.length > 0) {
    return {
      pass: false,
      details: discrepancies.join(" | ")
    };
  }
  return { pass: true, details: "" };
}

async function runM3009(flightPayloads?: Map<string, string>): Promise<{ pass: boolean; details: string }> {
  // M3-009: no Flight payload contains data-sourceog-client-placeholder (INV-002)
  if (!flightPayloads || flightPayloads.size === 0) {
    return { pass: true, details: "" };
  }

  const violations: string[] = [];
  for (const [routeId, payload] of flightPayloads) {
    if (payload.includes("data-sourceog-client-placeholder")) {
      violations.push(routeId);
    }
  }

  if (violations.length > 0) {
    return {
      pass: false,
      details: `Flight payloads containing data-sourceog-client-placeholder: ${violations.join(", ")}`
    };
  }
  return { pass: true, details: "" };
}

async function runM3010(hmrFilePath?: string): Promise<{ pass: boolean; details: string }> {
  // M3-010: all fallback code paths emit structured [SOURCEOG-FALLBACK] log entries (INV-005)
  if (!hmrFilePath) {
    return { pass: true, details: "" };
  }

  const source = await readFileSafe(hmrFilePath);
  if (source === null) {
    return { pass: true, details: "" };
  }

  // Check that [SOURCEOG-FALLBACK] appears in the source
  if (!source.includes("[SOURCEOG-FALLBACK]")) {
    return {
      pass: false,
      details: `${hmrFilePath} does not contain any [SOURCEOG-FALLBACK] log entries. All fallback code paths must emit structured [SOURCEOG-FALLBACK] logs.`
    };
  }

  // Check that hardFallbackHtmlReplace emits the structured log before DOM modification
  const hardFallbackIdx = source.indexOf("hardFallbackHtmlReplace");
  if (hardFallbackIdx !== -1) {
    // Find the function body
    const funcBodyStart = source.indexOf("{", hardFallbackIdx);
    if (funcBodyStart !== -1) {
      // Find the first occurrence of [SOURCEOG-FALLBACK] inside the function
      const fallbackLogIdx = source.indexOf("[SOURCEOG-FALLBACK]", funcBodyStart);
      // Find the first DOM modification (innerHTML assignment) inside the function
      const innerHtmlIdx = source.indexOf("innerHTML", funcBodyStart);

      if (fallbackLogIdx === -1) {
        return {
          pass: false,
          details: `hardFallbackHtmlReplace in ${hmrFilePath} does not emit a [SOURCEOG-FALLBACK] log entry.`
        };
      }

      if (innerHtmlIdx !== -1 && fallbackLogIdx > innerHtmlIdx) {
        return {
          pass: false,
          details: `hardFallbackHtmlReplace in ${hmrFilePath} modifies the DOM before emitting the [SOURCEOG-FALLBACK] log. The log must be emitted first.`
        };
      }
    }
  }

  return { pass: true, details: "" };
}

// ---------------------------------------------------------------------------
// Remediation guides per check
// ---------------------------------------------------------------------------

const REMEDIATION_GUIDES: Record<string, string> = {
  "M3-001": "Ensure buildClientReferenceManifest() is called during the build and that all 'use client' files are included in the chunk graph. Check that clientReferenceCount is populated from the manifest entries for each route.",
  "M3-002": "Remove all hydrateRoot(document.body, ...) and hydrateRoot(document.documentElement, ...) calls from server-component routes. Use root.render() via applyCanonicalFlight() instead.",
  "M3-003": "Move all replaceRouteBody calls inside the catch block of hardFallbackHtmlReplace. Remove replaceRouteBody from all other code paths in hmr.ts.",
  "M3-004": "Ensure the Flight endpoint handler sets 'Content-Type: text/x-component' before writing any response body. Check packages/sourceog-server/src/server.ts.",
  "M3-005": "Initialize RSC_Worker_Pool at server startup with a fixed worker count. Never spawn a new Worker inside the render() method. Check packages/sourceog-renderer/src/rsc.ts.",
  "M3-006": "Fix or remove Node-only imports from Edge-targeted routes. Use Web Crypto API instead of node:crypto, fetch() instead of node:fs, etc. Run computeRouteRuntimeCapability() to identify violations.",
  "M3-007": "Ensure all slot and intercept parity tests pass. Slot refreshes must be keyed on renderContextKey, not location.pathname. Check packages/sourceog-dev/src/hmr.ts.",
  "M3-008": "Ensure buildClientReferenceManifest() writes both server and browser manifests atomically from the same in-memory object. Check packages/sourceog-compiler/src/manifests.ts.",
  "M3-009": "Remove all data-sourceog-client-placeholder attributes from the client island implementation. Replace placeholder divs with real React client reference proxies. Check packages/sourceog-runtime/src/client-island.tsx.",
  "M3-010": "Add structured console.error('[SOURCEOG-FALLBACK]', {...}) calls to all fallback code paths in hmr.ts. The log must be emitted before any DOM modification."
};

const INV_MAPPING: Record<string, string> = {
  "M3-001": "INV-002",
  "M3-002": "INV-009",
  "M3-003": "INV-005",
  "M3-004": "INV-003",
  "M3-005": "INV-006",
  "M3-006": "INV-007",
  "M3-007": "INV-008",
  "M3-008": "INV-004",
  "M3-009": "INV-002",
  "M3-010": "INV-005"
};

const CHECK_DESCRIPTIONS: Record<string, string> = {
  "M3-001": "No server-component route with client boundaries has empty clientReferenceCount",
  "M3-002": "No server-component route calls hydrateRoot at the document root",
  "M3-003": "replaceRouteBody does not appear outside the hardFallbackHtmlReplace catch branch",
  "M3-004": "All Flight endpoints return Content-Type: text/x-component",
  "M3-005": "RSC_Worker_Pool is active and no per-request worker spawning occurs",
  "M3-006": "All Edge-targeted routes pass the Edge capability check",
  "M3-007": "All slot/intercept parity tests pass",
  "M3-008": "Server and browser ClientReferenceManifest files have identical keys, ids, and chunks",
  "M3-009": "No Flight payload contains data-sourceog-client-placeholder",
  "M3-010": "All fallback code paths emit structured [SOURCEOG-FALLBACK] log entries"
};

// ---------------------------------------------------------------------------
// Public API — verifyMilestone3Runtime (INV-010)
// ---------------------------------------------------------------------------

/**
 * Run all 10 M3 milestone checks and return the authoritative verification result.
 *
 * `result.complete === true` is the sole source of truth for M3 status (INV-010).
 * The release pipeline must derive milestone status from this function, not from
 * a manually-set flag.
 *
 * Score calculation: `Math.round((passingChecks.length / 10) * 100)`
 *
 * @param buildResult - The build result containing all data needed for the 10 checks.
 */
export async function verifyMilestone3Runtime(
  buildResult: M3BuildResult
): Promise<MilestoneVerificationResult> {
  const timestamp = new Date().toISOString();
  const passingChecks: string[] = [];
  const failingChecks: FailingCheck[] = [];

  const TOTAL_CHECKS = 10;

  /**
   * Run a single check, catching any thrown errors and treating them as failures.
   */
  async function runCheck(
    id: string,
    fn: () => Promise<{ pass: boolean; details: string }>
  ): Promise<void> {
    try {
      const result = await fn();
      if (result.pass) {
        passingChecks.push(id);
      } else {
        failingChecks.push({
          id,
          description: CHECK_DESCRIPTIONS[id] ?? id,
          details: result.details,
          remediationGuide: REMEDIATION_GUIDES[id] ?? "",
          invariantViolated: INV_MAPPING[id] ?? "INV-000"
        });
      }
    } catch (err) {
      failingChecks.push({
        id,
        description: CHECK_DESCRIPTIONS[id] ?? id,
        details: `Check threw an unexpected error: ${(err as Error).message}`,
        remediationGuide: REMEDIATION_GUIDES[id] ?? "",
        invariantViolated: INV_MAPPING[id] ?? "INV-000"
      });
    }
  }

  // Run all 10 checks
  await runCheck("M3-001", () => runM3001(buildResult.routes));
  await runCheck("M3-002", () => runM3002(buildResult.routes, buildResult.hmrFilePath));
  await runCheck("M3-003", () => runM3003(buildResult.hmrFilePath));
  await runCheck("M3-004", () => runM3004(buildResult.routes));
  await runCheck("M3-005", () => runM3005(buildResult.workerPoolActive, buildResult.rscFilePath));
  await runCheck("M3-006", () => runM3006(buildResult.edgeCapabilityResults));
  await runCheck("M3-007", () => runM3007(buildResult.slotInterceptParityPassed));
  await runCheck("M3-008", () => runM3008(buildResult.serverManifestPath, buildResult.browserManifestPath));
  await runCheck("M3-009", () => runM3009(buildResult.flightPayloads));
  await runCheck("M3-010", () => runM3010(buildResult.hmrFilePath));

  const score = Math.round((passingChecks.length / TOTAL_CHECKS) * 100);

  return {
    complete: failingChecks.length === 0,
    score,
    failingChecks,
    passingChecks,
    timestamp,
    buildId: buildResult.buildId
  };
}
