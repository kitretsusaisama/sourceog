import { createHash, randomUUID } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { AutomationEngine, createAutomationManifest, resolveConfig } from "@sourceog/platform";
import { createConsistencyGraphManifestFromRouteGraph, HeuristicControlPlane, RuleBasedAdaptiveTuner } from "@sourceog/genbook";
import { renderRouteToCanonicalResult, renderRouteToFlightPayload, shutdownRscWorkerPool } from "@sourceog/renderer";
import { matchPageRoute, scanRoutes } from "@sourceog/router";
import {
  type ActionManifest,
  type AssetManifest,
  type ArtifactSignatureManifest,
  type CacheManifest,
  type ClientBoundaryManifest,
  type ClientReferenceManifest,
  createRuntimeFingerprint,
  createDiagnosticsEnvelope,
  createLogger,
  loadEnv,
  type DeploymentManifest,
  type DeploymentSignatureManifest,
  type DoctorBaselineManifest,
  type GovernanceAuditManifest,
  SourceOGError,
  SOURCEOG_ERROR_CODES,
  SOURCEOG_MANIFEST_VERSION,
  type AdapterManifest,
  type BudgetReport,
  type BudgetViolation,
  type BundleManifest,
  type RscReferenceManifest,
  type DiagnosticIssue,
  type PolicyReplayManifest,
  type RenderManifest,
  type RouteGraphManifest,
  type RouteOwnershipManifest,
  type ServerReferenceManifest,
  type SourceOGRequestContext
} from "@sourceog/runtime";
import { analyzeModuleBoundaries } from "./boundary.js";
import {
  resolveRouteClientAssetReferences,
  writeClientArtifacts,
  writeServerClientReferenceModules
} from "./client.js";
import {
  createBundleManifestFromRoutes,
  createCacheManifest,
  createClientBoundaryManifest,
  createRscReferenceManifest,
  createRouteGraphManifest,
  createRouteOwnershipManifest
} from "./manifests.js";
import { writeReleaseEvidenceIndex } from "./evidence.js";

interface PrerenderRecord {
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

export interface BuildResult {
  buildId: string;
  distRoot: string;
  manifestPath: string;
  deploymentManifest: DeploymentManifest;
  prerendered: PrerenderRecord[];
  budgetReport: BudgetReport;
  manifestPaths: DeploymentManifest["manifests"];
}

async function loadPrerenderModule(filePath: string): Promise<Record<string, unknown>> {
  const needsTransform = filePath.endsWith(".ts") || filePath.endsWith(".tsx") || filePath.endsWith(".jsx");
  if (!needsTransform) {
    return import(pathToFileURL(filePath).href) as Promise<Record<string, unknown>>;
  }

  const tmpFile = path.join(path.dirname(filePath), `.sourceog-prerender-${randomUUID()}.mjs`);

  try {
    const { build } = await import("esbuild");
    await build({
      absWorkingDir: path.dirname(filePath),
      entryPoints: [filePath],
      outfile: tmpFile,
      bundle: true,
      format: "esm",
      jsx: "automatic",
      jsxImportSource: "react",
      packages: "external",
      platform: "node",
      target: "node22",
    });
    return await import(pathToFileURL(tmpFile).href);
  } finally {
    await fs.rm(tmpFile, { force: true }).catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Budget helpers
// ---------------------------------------------------------------------------

/**
 * Match a route pathname against a budget pattern.
 * Patterns support `*` as a wildcard segment and `**` as a catch-all.
 */
function matchesBudgetPattern(pathname: string, pattern: string): boolean {
  // Exact match
  if (pattern === pathname) return true;
  // Convert glob-style pattern to regex
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\x00CATCHALL\x00")
    .replace(/\*/g, "[^/]+")
    .replace(/\x00CATCHALL\x00/g, ".*");
  try {
    return new RegExp(`^${escaped}$`).test(pathname);
  } catch {
    return false;
  }
}

interface RouteBundleSize {
  routeKey: string;
  pattern: string;
  actualBytes: number;
}

function collectRuntimeFeatures(input: {
  config: Awaited<ReturnType<typeof resolveConfig>>;
  manifest: Awaited<ReturnType<typeof scanRoutes>>;
  prerendered: PrerenderRecord[];
  clientReferenceManifest?: ClientReferenceManifest;
  actionManifest?: ActionManifest;
}): string[] {
  const features = new Set<string>(["streaming", "headers", "cookies"]);

  if (input.config.i18n) {
    features.add("i18n");
  }

  if (input.config.experimental.edge) {
    features.add("edge-runtime");
  }

  if (input.manifest.pages.some((route) => route.middlewareFiles.length > 0) ||
    input.manifest.handlers.some((route) => route.middlewareFiles.length > 0)) {
    features.add("middleware");
  }

  if (input.prerendered.some((entry) => typeof entry.revalidate === "number" && entry.revalidate > 0)) {
    features.add("isr");
  }

  if ((input.clientReferenceManifest?.entries.length ?? 0) > 0) {
    features.add("client-boundaries");
  }

  if ((input.actionManifest?.entries.length ?? 0) > 0) {
    features.add("server-actions");
  }

  return [...features].sort();
}

function createBuildId(input: {
  config: Awaited<ReturnType<typeof resolveConfig>>;
  manifest: Awaited<ReturnType<typeof scanRoutes>>;
  prerendered: PrerenderRecord[];
  clientArtifacts: Awaited<ReturnType<typeof writeClientArtifacts>>;
  routeGraphManifest: RouteGraphManifest;
  clientReferenceManifest: ClientReferenceManifest;
  serverReferenceManifest: ServerReferenceManifest;
  actionManifest: ActionManifest;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        manifestVersion: input.config.manifestVersion,
        stability: input.config.stability,
        pages: input.manifest.pages.map((route) => ({
          id: route.id,
          pathname: route.pathname,
          capabilities: route.capabilities
        })),
        handlers: input.manifest.handlers.map((route) => ({
          id: route.id,
          pathname: route.pathname,
          capabilities: route.capabilities
        })),
        prerendered: input.prerendered.map((entry) => ({
          routeId: entry.routeId,
          pathname: entry.pathname,
          revalidate: entry.revalidate,
          hash: entry.hash,
          tags: entry.tags
        })),
        clientArtifacts: input.clientArtifacts.routeEntries.map((entry) => ({
          routeId: entry.routeId,
          pathname: entry.pathname,
          hydrationMode: entry.hydrationMode,
          renderMode: entry.renderMode,
          browserEntryAsset: entry.browserEntryAsset,
          clientBoundaryFiles: entry.clientBoundaryFiles,
          clientReferenceRefs: entry.clientReferenceRefs,
          boundaryRefs: entry.boundaryRefs,
          actionIds: entry.actionIds,
          imports: entry.imports,
          routeChunkIds: entry.routeChunkIds,
          sharedChunkIds: entry.sharedChunkIds,
          ownershipHash: entry.ownershipHash
        })),
        sharedChunks: input.clientArtifacts.sharedChunks.map((chunk) => ({
          chunkId: chunk.chunkId,
          routeIds: chunk.routeIds,
          importFiles: chunk.importFiles
        })),
        routeGraph: input.routeGraphManifest.routes.map((route) => ({
          routeId: route.routeId,
          segmentNodeIds: route.segmentNodeIds,
          groupSegments: route.groupSegments,
          slotSegments: route.slotSegments,
          interceptSegments: route.interceptSegments
        })),
        clientReferences: input.clientReferenceManifest.entries.map((entry) => ({
          filePath: entry.filePath,
          routeIds: entry.routeIds
        })),
        serverReferences: input.serverReferenceManifest.entries.map((entry) => ({
          filePath: entry.filePath,
          routeIds: entry.routeIds,
          actionIds: entry.actionIds
        })),
        actionEntries: input.actionManifest.entries.map((entry) => ({
          actionId: entry.actionId,
          filePath: entry.filePath,
          exportName: entry.exportName
        }))
      })
    )
    .digest("hex")
    .slice(0, 16);
}

async function measureRouteBundleSizes(
  prerendered: PrerenderRecord[],
  routes: Array<{ id: string; pathname: string }>
): Promise<RouteBundleSize[]> {
  const sizes: RouteBundleSize[] = [];
  for (const record of prerendered) {
    const route = routes.find((r) => r.id === record.routeId);
    const pattern = route?.pathname ?? record.pathname;
    try {
      const stat = await fs.stat(record.filePath);
      sizes.push({ routeKey: record.routeId, pattern, actualBytes: stat.size });
    } catch {
      // File may not exist if prerender was skipped
    }
  }
  return sizes;
}

function evaluateBudgets(
  bundleSizes: RouteBundleSize[],
  budgets: Record<string, number> | undefined
): BudgetReport {
  if (!budgets || Object.keys(budgets).length === 0) {
    return { violations: [], passed: true };
  }

  const violations: BudgetViolation[] = [];

  for (const bundle of bundleSizes) {
    for (const [pattern, budgetBytes] of Object.entries(budgets)) {
      if (matchesBudgetPattern(bundle.pattern, pattern)) {
        if (bundle.actualBytes > budgetBytes) {
          violations.push({
            routeKey: bundle.routeKey,
            pattern,
            actualBytes: bundle.actualBytes,
            budgetBytes,
          });
        }
        break; // use first matching pattern
      }
    }
  }

  return { violations, passed: violations.length === 0 };
}

// ---------------------------------------------------------------------------
// HTML Analyzer Report (Requirements 5.5, 11.4, 11.5)
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function buildTreemapSvg(bundles: RouteBundleSize[]): string {
  const total = bundles.reduce((sum, b) => sum + b.actualBytes, 0);
  if (total === 0) return "<p>No bundle data available.</p>";

  const width = 600;
  const height = 200;
  const rects: string[] = [];
  let x = 0;

  for (const bundle of bundles) {
    const w = Math.max(1, Math.round((bundle.actualBytes / total) * width));
    const label = bundle.pattern.length > 20 ? bundle.pattern.slice(0, 18) + "…" : bundle.pattern;
    rects.push(
      `<rect x="${x}" y="0" width="${w}" height="${height}" fill="#4f8ef7" stroke="#fff" stroke-width="1"/>`,
      `<text x="${x + w / 2}" y="${height / 2}" text-anchor="middle" dominant-baseline="middle" font-size="10" fill="#fff" transform="rotate(-45,${x + w / 2},${height / 2})">${label}</text>`
    );
    x += w;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" style="border:1px solid #ccc;border-radius:4px">${rects.join("")}</svg>`;
}

function buildAnalyzerHtml(bundles: RouteBundleSize[], report: BudgetReport): string {
  const violationSet = new Set(report.violations.map((v) => v.routeKey));

  const rows = bundles
    .map((b) => {
      const violation = report.violations.find((v) => v.routeKey === b.routeKey);
      const pass = !violationSet.has(b.routeKey);
      const budgetCell = violation ? formatBytes(violation.budgetBytes) : "—";
      const status = pass
        ? '<span style="color:#22c55e">✓ pass</span>'
        : '<span style="color:#ef4444">✗ fail</span>';
      return `<tr>
        <td>${escapeHtml(b.routeKey)}</td>
        <td>${escapeHtml(b.pattern)}</td>
        <td>${formatBytes(b.actualBytes)}</td>
        <td>${budgetCell}</td>
        <td>${status}</td>
      </tr>`;
    })
    .join("\n");

  const treemap = buildTreemapSvg(bundles);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>SourceOG Bundle Analyzer Report</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 2rem; color: #1a1a1a; }
    h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
    .summary { margin-bottom: 1.5rem; padding: 0.75rem 1rem; border-radius: 6px; background: #fef2f2; border: 1px solid #fca5a5; color: #991b1b; }
    table { border-collapse: collapse; width: 100%; margin-top: 1rem; }
    th, td { text-align: left; padding: 0.5rem 0.75rem; border-bottom: 1px solid #e5e7eb; }
    th { background: #f9fafb; font-weight: 600; }
    tr:hover td { background: #f9fafb; }
    .treemap { margin-top: 2rem; }
    .treemap h2 { font-size: 1.1rem; margin-bottom: 0.5rem; }
  </style>
</head>
<body>
  <h1>SourceOG Bundle Analyzer Report</h1>
  <div class="summary">
    ⚠ Budget violations detected: ${report.violations.length} route(s) exceeded their configured size limit.
  </div>
  <table>
    <thead>
      <tr>
        <th>Route Key</th>
        <th>Pattern</th>
        <th>Actual Size</th>
        <th>Budget</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>
  <div class="treemap">
    <h2>Bundle Composition</h2>
    ${treemap}
  </div>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function writeAnalyzerReport(
  distRoot: string,
  bundles: RouteBundleSize[],
  report: BudgetReport
): Promise<void> {
  await fs.mkdir(distRoot, { recursive: true });
  const html = buildAnalyzerHtml(bundles, report);
  await fs.writeFile(path.join(distRoot, "report.html"), html, "utf8");
}

function toRelativeManifestPath(root: string, filePath: string): string {
  return path.relative(root, filePath).replaceAll("\\", "/");
}

function normalizeFilePath(filePath: string): string {
  return filePath.replaceAll("\\", "/").toLowerCase();
}

function toClientAssetHref(distRoot: string, filePath: string): string {
  const normalized = path.relative(path.join(distRoot, "static"), filePath).replaceAll("\\", "/");
  return `/${normalized}`;
}

function toStaticFlightRelativePath(pathnameValue: string): string {
  const safeSegments = pathnameValue.split("/").filter(Boolean);
  return safeSegments.length === 0
    ? path.join("static", "__sourceog", "flight", "index.json")
    : path.join("static", "__sourceog", "flight", ...safeSegments, "index.json");
}

function toStaticFlightHref(pathnameValue: string): string {
  const safeSegments = pathnameValue.split("/").filter(Boolean);
  return safeSegments.length === 0
    ? "/__sourceog/flight/index.json"
    : `/__sourceog/flight/${safeSegments.join("/")}/index.json`;
}

async function collectFiles(root: string): Promise<string[]> {
  if (!existsSync(root)) {
    return [];
  }

  const results: string[] = [];
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      results.push(...await collectFiles(entryPath));
      continue;
    }
    results.push(entryPath);
  }
  return results;
}

function enrichClientReferenceManifest(
  manifest: ClientReferenceManifest,
  clientArtifacts: Awaited<ReturnType<typeof writeClientArtifacts>>,
  distRoot: string
): ClientReferenceManifest {
  const chunkHrefsByFile = new Map<string, Set<string>>();

  const appendChunkHref = (filePath: string | undefined, href: string | undefined): void => {
    if (!filePath || !href) {
      return;
    }
    const normalizedPath = normalizeFilePath(filePath);
    const chunkHrefs = chunkHrefsByFile.get(normalizedPath) ?? new Set<string>();
    chunkHrefs.add(href);
    chunkHrefsByFile.set(normalizedPath, chunkHrefs);
  };

  for (const routeEntry of clientArtifacts.routeEntries) {
    const browserEntryHref = routeEntry.browserEntryAsset
      ? toClientAssetHref(distRoot, routeEntry.browserEntryAsset)
      : undefined;

    appendChunkHref(
      routeEntry.sourceFile,
      browserEntryHref
    );

    if (routeEntry.hydrationMode === "full-route") {
      for (const clientReferenceRef of routeEntry.clientReferenceRefs) {
        appendChunkHref(clientReferenceRef.filePath, browserEntryHref);
      }
    }

    for (const boundaryRef of routeEntry.boundaryRefs) {
      appendChunkHref(
        boundaryRef.filePath,
        boundaryRef.assetHref ?? (boundaryRef.assetFilePath ? toClientAssetHref(distRoot, boundaryRef.assetFilePath) : undefined)
      );
    }
  }

  const existingManifestKeys = new Set(manifest.entries.map((entry) => entry.manifestKey));
  const syntheticEntries = clientArtifacts.routeEntries
    .filter((routeEntry) => routeEntry.hydrationMode === "full-route")
    .flatMap((routeEntry) => {
      const normalizedFilePath = normalizeFilePath(routeEntry.sourceFile);
      const manifestKey = `${normalizedFilePath}#default`;
      if (existingManifestKeys.has(manifestKey)) {
        return [];
      }

      const runtimeTargets = routeEntry.clientReferenceRefs.flatMap((entry) => entry.runtimeTargets);
      const dedupedRuntimeTargets = [...new Set(runtimeTargets)].sort() as Array<"node" | "edge">;
      const syntheticRuntimeTargets: Array<"node" | "edge"> = dedupedRuntimeTargets.length > 0
        ? dedupedRuntimeTargets
        : ["node", "edge"];

      return [{
        referenceId: createHash("sha256")
          .update(`client:${normalizedFilePath}#default`)
          .digest("hex")
          .slice(0, 16),
        moduleId: createHash("sha256")
          .update(normalizedFilePath)
          .digest("hex")
          .slice(0, 16),
        filePath: routeEntry.sourceFile,
        manifestKey,
        exportName: "default",
        exports: ["default"],
        chunks: [],
        async: false,
        routeIds: [routeEntry.routeId],
        pathnames: [routeEntry.pathname],
        importSpecifiers: [],
        directive: "use-client" as const,
        runtimeTargets: syntheticRuntimeTargets
      }];
    });

  const registry: ClientReferenceManifest["registry"] = {};
  const entries = [...manifest.entries, ...syntheticEntries].map((entry) => {
    const chunks = [...(chunkHrefsByFile.get(normalizeFilePath(entry.filePath)) ?? new Set<string>())].sort();
    const registryEntry = manifest.registry[entry.manifestKey] ?? {
      id: entry.moduleId,
      chunks: [],
      name: entry.exportName,
      async: entry.async,
      filepath: entry.filePath,
      exports: entry.exports
    };

    registry[entry.manifestKey] = {
      ...registryEntry,
      chunks
    };

    return {
      ...entry,
      chunks
    };
  });

  return {
    ...manifest,
    entries,
    registry
  };
}

async function writeJsonAtomically(filePath: string, payload: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  await fs.writeFile(temporaryPath, JSON.stringify(payload, null, 2), "utf8");
  await fs.rm(filePath, { force: true });
  await fs.rename(temporaryPath, filePath);
}

async function hashFile(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath);
  return createHash("sha256").update(content).digest("hex");
}

async function createArtifactSignatureManifest(input: {
  buildId: string;
  distRoot: string;
  manifestPaths: Record<string, string>;
}): Promise<ArtifactSignatureManifest> {
  const artifacts = await Promise.all(
    Object.entries(input.manifestPaths).map(async ([kind, filePath]) => {
      const stat = await fs.stat(filePath);
      return {
        kind,
        filePath,
        sha256: await hashFile(filePath),
        bytes: stat.size,
      };
    }),
  );

  const compiler = createHash("sha256")
    .update(JSON.stringify(artifacts.filter((artifact) => artifact.kind !== "deploymentManifest")))
    .digest("hex");
  const runtime = createHash("sha256")
    .update(JSON.stringify(artifacts.filter((artifact) => artifact.kind.includes("Manifest"))))
    .digest("hex");
  const deployment = createHash("sha256")
    .update(JSON.stringify(artifacts))
    .digest("hex");

  return {
    version: SOURCEOG_MANIFEST_VERSION,
    buildId: input.buildId,
    generatedAt: new Date().toISOString(),
    signatures: {
      compiler,
      runtime,
      deployment,
    },
    artifacts,
  };
}

function createDeploymentSignatureManifest(input: {
  buildId: string;
  deploymentManifestPath: string;
  artifactSignatureManifestPath: string;
  deploymentManifest: DeploymentManifest;
  artifactSignatureManifest: ArtifactSignatureManifest;
  selectedAdapter: string;
}): DeploymentSignatureManifest {
  return {
    version: SOURCEOG_MANIFEST_VERSION,
    buildId: input.buildId,
    generatedAt: new Date().toISOString(),
    artifactSignatureManifestPath: input.artifactSignatureManifestPath,
    deploymentManifestPath: input.deploymentManifestPath,
    runtimeFingerprint: createRuntimeFingerprint(),
    selectedAdapter: input.selectedAdapter,
    routeCount: input.deploymentManifest.routes.length,
    manifestCount: Object.keys(input.deploymentManifest.manifests).length,
    signatures: {
      ...input.artifactSignatureManifest.signatures,
    },
  };
}

function createGovernanceAuditManifest(input: {
  buildId: string;
  deploymentManifestPath: string;
  deploymentManifest: DeploymentManifest;
  routeGraphManifest: RouteGraphManifest;
  routeOwnershipManifest: RouteOwnershipManifest;
  cacheManifest: CacheManifest;
  actionManifest: ActionManifest;
  prerenderedCount: number;
  artifactSignatureManifestPath: string;
  deploymentSignatureManifestPath: string;
  doctorBaselineManifestPath: string;
  policyReplayManifestPath?: string;
}): GovernanceAuditManifest {
  return {
    version: SOURCEOG_MANIFEST_VERSION,
    buildId: input.buildId,
    generatedAt: new Date().toISOString(),
    packageContract: {
      publicPackage: "sourceog",
      internalPackagesRemainPrivate: true,
    },
    runtimeContract: {
      artifactOnlyProduction: true,
      sourceProbingDisallowed: true,
      transpilerFallbackDisallowed: true,
    },
    laws: {
      doctorLaw: true,
      replayLaw: true,
      policyLaw: true,
      runtimeLaw: true,
      governanceLaw: true,
    },
    decisions: {
      routeCount: input.deploymentManifest.routes.length,
      prerenderedRouteCount: input.prerenderedCount,
      cacheEntryCount: input.cacheManifest.entries.length,
      invalidationLinkCount: input.cacheManifest.invalidationLinks.length,
      graphNodeCount: input.routeGraphManifest.nodes.length,
      graphRouteCount: input.routeGraphManifest.routes.length,
      ownershipEntryCount: input.routeOwnershipManifest.entries.length,
      actionCount: input.actionManifest.entries.length,
    },
    artifactPaths: {
      routeOwnershipManifest: input.deploymentManifest.manifests.routeOwnershipManifest,
      cacheManifest: input.deploymentManifest.manifests.cacheManifest,
      routeGraphManifest: input.deploymentManifest.manifests.routeGraphManifest,
      artifactSignatureManifest: input.artifactSignatureManifestPath,
      deploymentSignatureManifest: input.deploymentSignatureManifestPath,
      doctorBaselineManifest: input.doctorBaselineManifestPath,
      policyReplayManifest: input.policyReplayManifestPath,
      deploymentManifest: input.deploymentManifestPath,
    },
  };
}

function createPolicyReplayManifest(input: {
  buildId: string;
  controlPlaneManifestPath: string;
  tunerSnapshotManifestPath: string;
  controlPlaneManifest: {
    entries: Array<{
      routeId: string;
      pathname: string;
      decision: {
        strategy: string;
        runtimeTarget: string;
        queuePriority: string;
        ttlSeconds: number | null;
        reason: string;
      };
    }>;
  };
}): PolicyReplayManifest {
  return {
    version: SOURCEOG_MANIFEST_VERSION,
    buildId: input.buildId,
    generatedAt: new Date().toISOString(),
    objective: "latency",
    reducerPhases: [
      "compatibility-constraints",
      "static-route-policy",
      "runtime-capability-constraints",
      "loop-proposals",
      "safety-envelope",
      "emergency-override",
    ],
    loopNames: [
      "RenderLoop",
      "CacheLoop",
      "WorkerLoop",
      "GraphLoop",
      "AssetLoop",
      "IncidentLoop",
      "PrefetchLoop",
      "HydrationLoop",
      "SecurityLoop",
      "CanaryLoop",
      "CostLoop",
      "RegionalLoop",
      "BudgetLoop",
      "ErrorLoop",
    ],
    controlPlaneManifestPath: input.controlPlaneManifestPath,
    tunerSnapshotManifestPath: input.tunerSnapshotManifestPath,
    routeDecisions: input.controlPlaneManifest.entries.map((entry) => ({
      routeId: entry.routeId,
      pathname: entry.pathname,
      strategy: entry.decision.strategy,
      runtimeTarget: entry.decision.runtimeTarget,
      queuePriority: entry.decision.queuePriority,
      ttlSeconds: entry.decision.ttlSeconds,
      reason: entry.decision.reason,
    })),
  };
}

async function writeClientReferenceManifestArtifacts(
  distRoot: string,
  manifest: ClientReferenceManifest
): Promise<{
  legacyPath: string;
  serverPath: string;
  browserPath: string;
}> {
  const legacyPath = path.join(distRoot, "client-reference-manifest.json");
  const serverPath = path.join(distRoot, "manifests", "client-reference-manifest.json");
  const browserPath = path.join(distRoot, "public", "_sourceog", "client-refs.json");

  await Promise.all([
    writeJsonAtomically(legacyPath, manifest),
    writeJsonAtomically(serverPath, manifest),
    writeJsonAtomically(browserPath, manifest)
  ]);

  return {
    legacyPath,
    serverPath,
    browserPath
  };
}

export async function buildApplication(cwd: string): Promise<BuildResult> {
  try {
    loadEnv(cwd, "production");
    const config = await resolveConfig(cwd);
    for (const plugin of config.plugins ?? []) {
      await plugin.onBuildStart?.(config);
    }
    const manifest = await scanRoutes(config);
    const logger = createLogger();
    const diagnostics: DiagnosticIssue[] = [...(manifest.diagnostics?.issues ?? [])];
    const automationEngine = new AutomationEngine(config.automations ?? []);
    const boundaryAnalysis = await analyzeModuleBoundaries(manifest);
    diagnostics.push(...boundaryAnalysis.diagnostics);
    const boundaryErrors = boundaryAnalysis.diagnostics.filter((issue) => issue.level === "error");
    if (boundaryErrors.length > 0) {
      throw new SourceOGError(
        SOURCEOG_ERROR_CODES.MODULE_BOUNDARY_VIOLATION,
        `SourceOG detected ${boundaryErrors.length} module boundary violation${boundaryErrors.length === 1 ? "" : "s"} during build.`,
        {
          issues: boundaryErrors.map((issue) => ({
            code: issue.code,
            message: issue.message,
            file: issue.file,
            recoveryHint: issue.recoveryHint
          }))
        }
      );
    }
    const clientArtifacts = await writeClientArtifacts(config, manifest, {
      clientReferenceManifest: boundaryAnalysis.clientReferenceManifest,
      actionManifest: boundaryAnalysis.actionManifest
    });
    boundaryAnalysis.clientReferenceManifest = enrichClientReferenceManifest(
      boundaryAnalysis.clientReferenceManifest,
      clientArtifacts,
      config.distRoot
    );
    await writeServerClientReferenceModules({
      distRoot: config.distRoot,
      manifest: boundaryAnalysis.clientReferenceManifest
    });
    let clientReferenceManifestArtifacts = await writeClientReferenceManifestArtifacts(
      config.distRoot,
      boundaryAnalysis.clientReferenceManifest
    );
  const routeGraphManifest = createRouteGraphManifest(manifest, "pending");

  for (const routeEntry of clientArtifacts.routeEntries) {
    if (routeEntry.hydrationMode === "mixed-route") {
      diagnostics.push({
        level: "info",
        code: "SOURCEOG_MIXED_ROUTE_HYDRATION",
        message: `Route "${routeEntry.pathname}" uses nested "use client" modules and is hydrated through declared client boundary descriptors.`,
        pathname: routeEntry.pathname,
        recoveryHint: "SourceOG now hydrates only the declared client boundaries for mixed server/client routes; future RSC work will replace the browser route bootstrap entirely.",
        details: {
          routeId: routeEntry.routeId,
          clientBoundaryFiles: routeEntry.clientBoundaryFiles
        }
      });
    }
  }

  await fs.mkdir(config.distRoot, { recursive: true });
  await fs.mkdir(path.join(config.distRoot, "static"), { recursive: true });

  const tunerSnapshotPath = path.join(config.distRoot, "tuner-snapshot.json");
  const adosfTuner = new RuleBasedAdaptiveTuner();
  await adosfTuner.loadSnapshot(tunerSnapshotPath);
  const controlPlane = new HeuristicControlPlane(adosfTuner);
  const controlPlaneRoutes = manifest.pages.map((route) => ({
    id: route.id,
    pathname: route.pathname,
    kind: route.kind,
    capabilities: route.capabilities
  }));
  const controlPlaneManifest = await controlPlane.toManifest(controlPlaneRoutes);
  const controlPlaneDecisions = new Map(
    controlPlaneManifest.entries.map((entry) => [entry.routeId, entry.decision] as const)
  );
  const consistencyGraphManifest = createConsistencyGraphManifestFromRouteGraph(routeGraphManifest);

  const prerendered: PrerenderRecord[] = [];

  /** Module cache for the prerender loop — avoids repeated dynamic import() of the same route file (RF-11). */
  const prerenderModuleCache = new Map<string, unknown>();

  for (const route of manifest.pages) {
    const routeGraphEntry = manifest.routeGraph.routes.find((entry) => entry.routeId === route.id);
    if (routeGraphEntry && !routeGraphEntry.materialized) {
      diagnostics.push({
        level: "info",
        code: routeGraphEntry.slotName
          ? "SOURCEOG_PARALLEL_SLOT_PRERENDER_DEFERRED"
          : "SOURCEOG_INTERCEPT_ROUTE_PRERENDER_DEFERRED",
        message: routeGraphEntry.slotName
          ? `Parallel slot route "${route.pathname}" is attached to its primary route during render and is not prerendered as a standalone HTML page.`
          : `Intercepting route "${route.pathname}" resolves inside an alternate render context and is not prerendered as a standalone canonical HTML page.`,
        pathname: route.pathname,
        details: {
          routeId: route.id,
          slotName: routeGraphEntry.slotName,
          interceptTarget: routeGraphEntry.interceptTarget,
          renderContextKey: routeGraphEntry.renderContextKey
        }
      });
      continue;
    }

    if (!prerenderModuleCache.has(route.file)) {
      prerenderModuleCache.set(route.file, await loadPrerenderModule(route.file));
    }
    const routeModule = prerenderModuleCache.get(route.file) as {
      generateStaticParams?: () => Promise<Array<Record<string, string | string[]>>> | Array<Record<string, string | string[]>>;
      revalidate?: number;
      cacheTTL?: number;
      cacheTags?: string[];
      dynamic?: "force-static" | "force-dynamic" | "auto";
      prerenderPolicy?: "force-static" | "force-dynamic" | "auto";
    };

    const staticParams = routeModule.generateStaticParams ? await routeModule.generateStaticParams() : undefined;
    const isDynamic = route.segments.some((segment) => segment.kind !== "static");
    const mode = routeModule.prerenderPolicy ?? routeModule.dynamic ?? "auto";
    const shouldPrerender = mode !== "force-dynamic" && (!isDynamic || Boolean(staticParams));

    if (!shouldPrerender) {
      diagnostics.push({
        level: "info",
        code: "SOURCEOG_PRERENDER_SKIPPED",
        message: `Route "${route.pathname}" is not prerendered in the current build.`,
        pathname: route.pathname
      });
      continue;
    }

    const entries = staticParams && staticParams.length ? staticParams : [{}];
    for (const params of entries) {
      const pathnameValue = hydratePathname(route.pathname, params);
      const routeMatch = matchPageRoute(manifest, pathnameValue);
      const context: SourceOGRequestContext = {
        request: {
          url: new URL(`http://sourceog.local${pathnameValue}`),
          method: "GET",
          headers: new Headers(),
          cookies: new Map(),
          requestId: "build",
          runtime: "node",
          async bodyText() {
            return "";
          },
          async bodyJson<T>() {
            return {} as T;
          }
        },
        params,
        query: new URLSearchParams()
      };

      const staticFlightHref = toStaticFlightHref(pathnameValue);
      const resolvedClientAssets = resolveRouteClientAssetReferences(clientArtifacts, config.distRoot, route.id);
      const clientAssets = resolvedClientAssets
        ? {
          ...resolvedClientAssets,
          flightHref: staticFlightHref
        }
        : undefined;
      const rendered = await renderRouteToCanonicalResult(routeMatch?.route ?? route, context, {
        pathname: pathnameValue,
        clientAssets,
        clientReferenceManifest: boundaryAnalysis.clientReferenceManifest,
        clientReferenceDistRoot: config.distRoot,
        routeIdentity: routeMatch ?? undefined,
        parallelRoutes: routeMatch?.parallelRoutes
      });
      const html = rendered.htmlShell ?? "";
      const safeSegments = pathnameValue.split("/").filter(Boolean);
      const relativePath = safeSegments.length === 0 ? path.join("static", "index.html") : path.join("static", ...safeSegments, "index.html");
      const outputPath = path.join(config.distRoot, relativePath);
      const flightRelativePath = toStaticFlightRelativePath(pathnameValue);
      const flightOutputPath = path.join(config.distRoot, flightRelativePath);
      const flightPayload = await renderRouteToFlightPayload(routeMatch?.route ?? route, context, {
        pathname: pathnameValue,
        clientAssets,
        clientReferenceManifest: boundaryAnalysis.clientReferenceManifest,
        clientReferenceDistRoot: config.distRoot,
        routeIdentity: routeMatch ?? undefined,
        parallelRoutes: routeMatch?.parallelRoutes
      });
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.mkdir(path.dirname(flightOutputPath), { recursive: true });
      await fs.writeFile(outputPath, html, "utf8");
      await fs.writeFile(flightOutputPath, JSON.stringify(flightPayload, null, 2), "utf8");
      const generatedAt = new Date().toISOString();
      prerendered.push({
        routeId: route.id,
        pathname: pathnameValue,
        filePath: outputPath,
        flightFilePath: flightOutputPath,
        revalidate: routeModule.revalidate ?? routeModule.cacheTTL,
        invalidated: false,
        hash: createHash("sha256").update(html).digest("hex"),
        generatedAt,
        tags: routeModule.cacheTags ?? []
      });
    }
  }

  const manifestPath = path.join(config.distRoot, "route-manifest.json");
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  const buildId = createBuildId({
    config,
    manifest,
    prerendered,
    clientArtifacts,
    routeGraphManifest,
    clientReferenceManifest: boundaryAnalysis.clientReferenceManifest,
    serverReferenceManifest: boundaryAnalysis.serverReferenceManifest,
    actionManifest: boundaryAnalysis.actionManifest
  });
  clientArtifacts.buildId = buildId;
  routeGraphManifest.buildId = buildId;
  boundaryAnalysis.clientReferenceManifest.buildId = buildId;
  boundaryAnalysis.serverReferenceManifest.buildId = buildId;
  boundaryAnalysis.actionManifest.buildId = buildId;
  clientReferenceManifestArtifacts = await writeClientReferenceManifestArtifacts(
    config.distRoot,
    boundaryAnalysis.clientReferenceManifest
  );
  await writeJsonAtomically(
    path.join(config.distRoot, "client-manifest.json"),
    clientArtifacts
  );
  const renderManifest: RenderManifest = {
    version: SOURCEOG_MANIFEST_VERSION,
    buildId,
    generatedAt: new Date().toISOString(),
    entries: manifest.pages.map((route) => {
      const decision = controlPlaneDecisions.get(route.id);
      return {
        routeId: route.id,
        pathname: route.pathname,
        kind: route.kind,
        runtime: decision?.runtimeTarget ?? "node",
        dynamic: decision?.strategy === "stream"
          ? "auto"
          : route.capabilities.includes("dynamic-only") ? "auto" : "force-static",
        revalidate: decision?.ttlSeconds ?? prerendered.find((entry) => entry.routeId === route.id)?.revalidate,
        prerendered: prerendered.some((entry) => entry.routeId === route.id)
      };
    })
  };
  const bundleManifest: BundleManifest = createBundleManifestFromRoutes(manifest, clientArtifacts);
  bundleManifest.buildId = buildId;
  bundleManifest.runtimeAsset = clientArtifacts.runtimeAsset;
  const routeOwnershipManifest: RouteOwnershipManifest = createRouteOwnershipManifest(manifest, clientArtifacts, buildId);
  const clientBoundaryManifest: ClientBoundaryManifest = createClientBoundaryManifest(clientArtifacts, buildId);
  const rscReferenceManifest: RscReferenceManifest = createRscReferenceManifest(
    manifest,
    boundaryAnalysis,
    boundaryAnalysis.clientReferenceManifest,
    boundaryAnalysis.serverReferenceManifest,
    boundaryAnalysis.actionManifest,
    clientArtifacts,
    buildId
  );
  const cacheManifest: CacheManifest = createCacheManifest({
    manifest,
    prerendered,
    actionManifest: boundaryAnalysis.actionManifest,
    buildId
  });
  const rscRouteManifestById = new Map(rscReferenceManifest.entries.map((entry) => [entry.routeId, entry]));
  const adapterManifest: AdapterManifest = {
    version: SOURCEOG_MANIFEST_VERSION,
    buildId,
    generatedAt: new Date().toISOString(),
    defaultRuntime: "node",
    selectedAdapter: config.adapter?.name ?? "node",
    capabilityChecked: false,
    supportedAdapters: ["node", "cloudflare", "vercel-node", "vercel-edge"],
    supportedFeatures: [],
    unsupportedFeatures: [],
    warnings: []
  };

  if (config.adapter?.checkCapabilities) {
    const featureSet = collectRuntimeFeatures({ config, manifest, prerendered });
    featureSet.push(...collectRuntimeFeatures({
      config,
      manifest,
      prerendered,
      clientReferenceManifest: boundaryAnalysis.clientReferenceManifest,
      actionManifest: boundaryAnalysis.actionManifest
    }).filter((feature) => !featureSet.includes(feature)));
    const capabilityReport = config.adapter.checkCapabilities({ features: featureSet });
    adapterManifest.capabilityChecked = true;
    adapterManifest.supportedFeatures = capabilityReport.supported;
    adapterManifest.unsupportedFeatures = capabilityReport.unsupported;
    adapterManifest.warnings = capabilityReport.warnings;

    if (capabilityReport.unsupported.length > 0) {
      throw new SourceOGError(
        SOURCEOG_ERROR_CODES.ADAPTER_CAPABILITY_MISSING,
        `Adapter "${config.adapter.name}" does not support: ${capabilityReport.unsupported.join(", ")}.`,
        {
          adapter: config.adapter.name,
          unsupported: capabilityReport.unsupported,
          warnings: capabilityReport.warnings
        }
      );
    }
  }
  const renderManifestPath = path.join(config.distRoot, "render-manifest.json");
  const routeGraphManifestPath = path.join(config.distRoot, "route-graph-manifest.json");
  const bundleManifestPath = path.join(config.distRoot, "bundle-manifest.json");
  const routeOwnershipManifestPath = path.join(config.distRoot, "route-ownership-manifest.json");
  const assetManifestPath = path.join(config.distRoot, "asset-manifest.json");
  const adapterManifestPath = path.join(config.distRoot, "adapter-manifest.json");
  const automationManifestPath = path.join(config.distRoot, "automation-manifest.json");
  const diagnosticsManifestPath = path.join(config.distRoot, "diagnostics-manifest.json");
  const prerenderManifestPath = path.join(config.distRoot, "prerender-manifest.json");
  const cacheManifestPath = path.join(config.distRoot, "cache-manifest.json");
  const clientManifestPath = path.join(config.distRoot, "client-manifest.json");
  const clientBoundaryManifestPath = path.join(config.distRoot, "client-boundary-manifest.json");
  const rscReferenceManifestPath = path.join(config.distRoot, "rsc-reference-manifest.json");
  const serverReferenceManifestPath = path.join(config.distRoot, "server-reference-manifest.json");
  const actionManifestPath = path.join(config.distRoot, "action-manifest.json");
  const controlPlaneManifestPath = path.join(config.distRoot, "control-plane-manifest.json");
  const consistencyGraphManifestPath = path.join(config.distRoot, "consistency-graph.json");
  const artifactSignatureManifestPath = path.join(config.distRoot, "artifact-signature-manifest.json");
  const deploymentSignatureManifestPath = path.join(config.distRoot, "deployment-signature-manifest.json");
  const doctorBaselineManifestPath = path.join(config.distRoot, "doctor-baseline-manifest.json");
  const governanceAuditManifestPath = path.join(config.distRoot, "governance-audit-manifest.json");
  const policyReplayManifestPath = path.join(config.distRoot, "policy-replay-manifest.json");
  const releaseEvidenceIndexManifestPath = path.join(config.distRoot, "release-evidence-index.json");

  if (existsSync(path.join(cwd, "public"))) {
    await copyDirectory(path.join(cwd, "public"), path.join(config.distRoot, "public"));
  }

  await writeJsonAtomically(renderManifestPath, renderManifest);
  await writeJsonAtomically(routeGraphManifestPath, routeGraphManifest);
  await writeJsonAtomically(bundleManifestPath, bundleManifest);
  await writeJsonAtomically(routeOwnershipManifestPath, routeOwnershipManifest);
  await writeJsonAtomically(clientBoundaryManifestPath, clientBoundaryManifest);
  await writeJsonAtomically(rscReferenceManifestPath, rscReferenceManifest);
  await writeJsonAtomically(serverReferenceManifestPath, boundaryAnalysis.serverReferenceManifest);
  await writeJsonAtomically(actionManifestPath, boundaryAnalysis.actionManifest);

  const publicAssetPaths = await collectFiles(path.join(config.distRoot, "public"));
  const assetManifest: AssetManifest = {
    version: SOURCEOG_MANIFEST_VERSION,
    buildId,
    generatedAt: new Date().toISOString(),
    runtimeAsset: toRelativeManifestPath(config.distRoot, clientArtifacts.runtimeAsset),
    assets: [
      {
        kind: "runtime",
        filePath: toRelativeManifestPath(config.distRoot, clientArtifacts.runtimeAsset)
      },
      ...clientArtifacts.routeEntries.map((entry) => ({
        kind: "client-entry" as const,
        routeId: entry.routeId,
        pathname: entry.pathname,
        filePath: toRelativeManifestPath(config.distRoot, entry.outputAsset)
      })),
      ...clientArtifacts.routeEntries
        .filter((entry) => Boolean(entry.browserEntryAsset))
        .map((entry) => ({
          kind: "client-browser-entry" as const,
          routeId: entry.routeId,
          pathname: entry.pathname,
          filePath: entry.browserEntryAsset
            ? toRelativeManifestPath(config.distRoot, entry.browserEntryAsset)
            : ""
        })),
      ...clientArtifacts.routeEntries.flatMap((entry) =>
        entry.boundaryRefs
          .filter((boundaryRef) => Boolean(boundaryRef.assetFilePath))
          .map((boundaryRef) => ({
            kind: "client-boundary-entry" as const,
            routeId: entry.routeId,
            pathname: entry.pathname,
            filePath: boundaryRef.assetFilePath ? toRelativeManifestPath(config.distRoot, boundaryRef.assetFilePath) : undefined,
            chunkId: boundaryRef.boundaryId
          }))
      ),
      ...clientArtifacts.routeEntries.map((entry) => ({
        kind: "client-metadata" as const,
        routeId: entry.routeId,
        pathname: entry.pathname,
        filePath: toRelativeManifestPath(config.distRoot, entry.metadataAsset)
      })),
      ...clientArtifacts.sharedChunks.map((chunk) => ({
        kind: "shared-chunk" as const,
        chunkId: chunk.chunkId,
        routeIds: chunk.routeIds,
        filePath: toRelativeManifestPath(config.distRoot, chunk.outputAsset)
      })),
      ...prerendered.map((entry) => ({
        kind: "prerendered" as const,
        routeId: entry.routeId,
        pathname: entry.pathname,
        filePath: toRelativeManifestPath(config.distRoot, entry.filePath)
      })),
      ...prerendered
        .filter((entry) => Boolean(entry.flightFilePath))
        .map((entry) => ({
          kind: "flight" as const,
          routeId: entry.routeId,
          pathname: entry.pathname,
          filePath: entry.flightFilePath
            ? toRelativeManifestPath(config.distRoot, entry.flightFilePath)
            : undefined
        })),
      ...publicAssetPaths.map((filePath) => ({
        kind: "public" as const,
        filePath: toRelativeManifestPath(config.distRoot, filePath)
      }))
    ]
  };
  await writeJsonAtomically(assetManifestPath, assetManifest);
  await writeJsonAtomically(adapterManifestPath, adapterManifest);
  await writeJsonAtomically(
    automationManifestPath,
    createAutomationManifest(config.automations ?? [])
  );
  await writeJsonAtomically(
    diagnosticsManifestPath,
    createDiagnosticsEnvelope(diagnostics, buildId)
  );
  await writeJsonAtomically(
    prerenderManifestPath,
    { version: SOURCEOG_MANIFEST_VERSION, buildId, generatedAt: new Date().toISOString(), prerendered }
  );
  await writeJsonAtomically(cacheManifestPath, cacheManifest);
  await writeJsonAtomically(controlPlaneManifestPath, controlPlaneManifest);
  await writeJsonAtomically(consistencyGraphManifestPath, consistencyGraphManifest);
  await adosfTuner.persistSnapshot(tunerSnapshotPath);

  // ---------------------------------------------------------------------------
  // Budget evaluation (Requirements 5.1–5.7, 11.1–11.5)
  // ---------------------------------------------------------------------------
  const bundleSizes = await measureRouteBundleSizes(prerendered, manifest.pages);
  const budgetReport = evaluateBudgets(
    bundleSizes,
    (config as unknown as { budgets?: Record<string, number> }).budgets
  );

  if (!budgetReport.passed) {
    await writeAnalyzerReport(config.distRoot, bundleSizes, budgetReport);
  }

  const deploymentManifest: DeploymentManifest = {
    version: SOURCEOG_MANIFEST_VERSION,
    buildId,
    generatedAt: new Date().toISOString(),
    stability: config.stability,
    routes: [...manifest.pages, ...manifest.handlers].map((route) => {
      const rscEntry = route.kind === "page" ? rscRouteManifestById.get(route.id) : undefined;
      const supportedRuntimeTargets = rscEntry?.supportedRuntimeTargets
        ?? (route.capabilities.includes("edge-capable") ? ["node", "edge"] : ["node"]);

      return {
        routeId: route.id,
        pathname: route.pathname,
        kind: route.kind,
        runtime: supportedRuntimeTargets.includes("edge") ? "edge" : "node",
        prerendered: prerendered.some((entry) => entry.routeId === route.id),
        edgeCompatible: supportedRuntimeTargets.includes("edge"),
        supportedRuntimeTargets,
        unsupportedRuntimeReasons: rscEntry?.unsupportedRuntimeReasons ?? []
      };
    }),
    manifests: {
      routeManifest: manifestPath,
      routeGraphManifest: routeGraphManifestPath,
      renderManifest: renderManifestPath,
      bundleManifest: bundleManifestPath,
      routeOwnershipManifest: routeOwnershipManifestPath,
      assetManifest: assetManifestPath,
      adapterManifest: adapterManifestPath,
      diagnosticsManifest: diagnosticsManifestPath,
      prerenderManifest: prerenderManifestPath,
      cacheManifest: cacheManifestPath,
      controlPlaneManifest: controlPlaneManifestPath,
      consistencyGraphManifest: consistencyGraphManifestPath,
      tunerSnapshotManifest: tunerSnapshotPath,
      policyReplayManifest: policyReplayManifestPath,
      automationManifest: automationManifestPath,
      clientManifest: clientManifestPath,
      clientReferenceManifest: clientReferenceManifestArtifacts.serverPath,
      clientBoundaryManifest: clientBoundaryManifestPath,
      rscReferenceManifest: rscReferenceManifestPath,
      serverReferenceManifest: serverReferenceManifestPath,
      actionManifest: actionManifestPath,
      artifactSignatureManifest: artifactSignatureManifestPath,
      deploymentSignatureManifest: deploymentSignatureManifestPath,
      doctorBaselineManifest: doctorBaselineManifestPath,
      governanceAuditManifest: governanceAuditManifestPath,
      releaseEvidenceIndexManifest: releaseEvidenceIndexManifestPath,
    }
  };

  const doctorBaselineManifest: DoctorBaselineManifest = {
    version: SOURCEOG_MANIFEST_VERSION,
    buildId,
    generatedAt: new Date().toISOString(),
    routeCount: deploymentManifest.routes.length,
    pageRouteCount: manifest.pages.length,
    handlerRouteCount: manifest.handlers.length,
    prerenderedRouteCount: prerendered.length,
    clientReferenceCount: boundaryAnalysis.clientReferenceManifest.entries.length,
    actionCount: boundaryAnalysis.actionManifest.entries.length,
    manifestNames: Object.keys(deploymentManifest.manifests).sort(),
  };

  await writeJsonAtomically(doctorBaselineManifestPath, doctorBaselineManifest);
  const policyReplayManifest = createPolicyReplayManifest({
    buildId,
    controlPlaneManifestPath,
    tunerSnapshotManifestPath: tunerSnapshotPath,
    controlPlaneManifest,
  });
  await writeJsonAtomically(policyReplayManifestPath, policyReplayManifest);
  const deploymentManifestPath = path.join(config.distRoot, "deployment-manifest.json");
  await writeJsonAtomically(deploymentManifestPath, deploymentManifest);
  const artifactSignatureManifest = await createArtifactSignatureManifest({
    buildId,
    distRoot: config.distRoot,
    manifestPaths: {
      ...Object.fromEntries(
        Object.entries(deploymentManifest.manifests).filter(
          ([name]) =>
            name !== "artifactSignatureManifest" &&
            name !== "deploymentSignatureManifest" &&
            name !== "governanceAuditManifest" &&
            name !== "releaseEvidenceIndexManifest",
        ),
      ),
      deploymentManifest: deploymentManifestPath,
    },
  });
  await writeJsonAtomically(artifactSignatureManifestPath, artifactSignatureManifest);
  const deploymentSignatureManifest = createDeploymentSignatureManifest({
    buildId,
    deploymentManifestPath,
    artifactSignatureManifestPath,
    deploymentManifest,
    artifactSignatureManifest,
    selectedAdapter: adapterManifest.selectedAdapter,
  });
  await writeJsonAtomically(
    deploymentSignatureManifestPath,
    deploymentSignatureManifest,
  );
  const governanceAuditManifest = createGovernanceAuditManifest({
    buildId,
    deploymentManifestPath,
    deploymentManifest,
    routeGraphManifest,
    routeOwnershipManifest,
    cacheManifest,
    actionManifest: boundaryAnalysis.actionManifest,
    prerenderedCount: prerendered.length,
    artifactSignatureManifestPath,
    deploymentSignatureManifestPath,
    doctorBaselineManifestPath,
    policyReplayManifestPath,
  });
  await writeJsonAtomically(governanceAuditManifestPath, governanceAuditManifest);
  await writeReleaseEvidenceIndex(releaseEvidenceIndexManifestPath, {
    buildId,
    governanceAuditManifest,
    artifactSignatureManifest,
    deploymentSignatureManifest,
    doctorBaselineManifest,
    policyReplayManifest,
    artifactPaths: {
      deploymentManifest: deploymentManifestPath,
      artifactSignatureManifest: artifactSignatureManifestPath,
      deploymentSignatureManifest: deploymentSignatureManifestPath,
      doctorBaselineManifest: doctorBaselineManifestPath,
      governanceAuditManifest: governanceAuditManifestPath,
      policyReplayManifest: policyReplayManifestPath,
    },
  });

  if (budgetReport.passed) {
    await config.adapter?.deploy?.(
      deploymentManifest,
      {
        buildId,
        distRoot: config.distRoot,
        manifestPaths: deploymentManifest.manifests,
        clientArtifacts,
        prerendered,
        budgetReport
      },
      config
    );
  }

  logger.info("sourceog_build_complete", {
    prerenderedRoutes: prerendered.length
  });
  await automationEngine.dispatch({
    name: "build.complete",
    payload: {
      cwd,
      prerenderedRoutes: prerendered.length
    },
    timestamp: new Date().toISOString()
  });
  for (const plugin of config.plugins ?? []) {
    await plugin.onBuildEnd?.(config);
  }

    return {
      buildId,
      distRoot: config.distRoot,
      manifestPath,
      deploymentManifest,
      prerendered,
      budgetReport,
      manifestPaths: deploymentManifest.manifests,
    };
  } finally {
    await shutdownRscWorkerPool();
  }
}

export async function exportApplication(cwd: string, outDir = "out"): Promise<void> {
  const config = await resolveConfig(cwd);
  const outputRoot = path.join(cwd, outDir);
  await fs.mkdir(outputRoot, { recursive: true });
  await copyDirectory(path.join(config.distRoot, "static"), outputRoot);
}

function hydratePathname(pathnameTemplate: string, params: Record<string, string | string[]>): string {
  let pathname = pathnameTemplate;
  for (const [key, value] of Object.entries(params)) {
    const normalized = Array.isArray(value) ? value.join("/") : value;
    pathname = pathname
      .replace(`[[...${key}]]`, normalized)
      .replace(`[...${key}]`, normalized)
      .replace(`[${key}]`, normalized);
  }
  return pathname || "/";
}

async function copyDirectory(source: string, target: string): Promise<void> {
  if (!existsSync(source)) {
    return;
  }

  await fs.mkdir(target, { recursive: true });
  for (const entry of await fs.readdir(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      await copyDirectory(sourcePath, targetPath);
      continue;
    }
    await fs.copyFile(sourcePath, targetPath);
  }
}
