import path from "node:path";
import type { RouteManifest } from "@sourceog/router";
import {
  SOURCEOG_MANIFEST_VERSION,
  type BundleManifest,
  type CacheManifest,
  type ClientBoundaryManifest,
  type ClientReferenceManifest,
  type DiagnosticIssue,
  type RuntimeCapabilityIssue,
  type RscReferenceManifest,
  type RouteGraphManifest,
  type RouteOwnershipManifest,
  type ServerReferenceManifest,
  type ActionManifest
} from "@sourceog/runtime";
import type { ClientBuildArtifacts } from "./client.js";
import type { BoundaryAnalysisResult } from "./boundary.js";

export interface DevManifestRouteEntry {
  routeId: string;
  pathname: string;
  files: string[];
  changedFiles: string[];
  chunkName: string;
  generatedClientEntry: string;
  routeChunkIds: string[];
  affected: boolean;
  affectedChunkIds: string[];
}

export interface DevManifest {
  version: string;
  generatedAt: string;
  routes: DevManifestRouteEntry[];
}

export interface IncrementalInvalidationPlan {
  changedFiles: string[];
  affectedRouteIds: string[];
  affectedPathnames: string[];
  affectedChunkIds: string[];
  fullReload: boolean;
  reasons: string[];
}

function collectOwnedFiles(
  manifest: RouteManifest,
  route: RouteManifest["pages"][number] | RouteManifest["handlers"][number]
): string[] {
  const fallbackFiles = [
    route.file,
    ...route.layouts,
    ...route.middlewareFiles,
    route.templateFile,
    route.errorFile,
    route.loadingFile,
    route.notFoundFile
  ].filter((value): value is string => Boolean(value));
  const routeGraphEntry = (manifest.routeGraph?.routes ?? []).find((entry) => entry.routeId === route.id);
  if (routeGraphEntry) {
    const filePaths = routeGraphEntry.fileNodeIds
      .map((nodeId) => (manifest.routeGraph?.nodes ?? []).find((node) => node.id === nodeId)?.filePath)
      .filter((value): value is string => Boolean(value));

    if (filePaths.length > 0) {
      return [...new Set([...filePaths, ...route.middlewareFiles])];
    }
  }

  return fallbackFiles;
}

function toChunkName(routeId: string): string {
  return routeId.replaceAll(":", "_").replaceAll("/", "_");
}

function toRouteChunkId(routeId: string): string {
  return `route:${routeId
    .replaceAll(":", "_")
    .replaceAll("/", "_")
    .replaceAll("[", "_")
    .replaceAll("]", "_")
    .replaceAll(".", "_")}`;
}

const STRUCTURAL_FILENAMES = new Set([
  "layout.tsx",
  "template.tsx",
  "loading.tsx",
  "error.tsx",
  "not-found.tsx",
  "route.ts",
  "middleware.ts"
]);

export function createBundleManifestFromRoutes(
  manifest: RouteManifest,
  clientArtifacts?: ClientBuildArtifacts
): BundleManifest {
  return {
    version: SOURCEOG_MANIFEST_VERSION,
    buildId: "pending",
    generatedAt: new Date().toISOString(),
    runtimeAsset: "",
    routes: [...manifest.pages, ...(manifest.handlers ?? [])].map((route) => {
      const clientEntry = clientArtifacts?.routeEntries.find((entry) => entry.routeId === route.id);
      return {
        routeId: route.id,
        pathname: route.pathname,
        serverEntry: route.file,
        clientEntries: route.kind === "page" ? [route.file] : [],
        middlewareEntries: route.middlewareFiles,
        generatedClientEntry: clientEntry?.generatedEntryFile,
        declaredClientAsset: clientEntry?.outputAsset,
        browserEntryAsset: clientEntry?.browserEntryAsset,
        chunkName: toChunkName(route.id),
        ownedFiles: collectOwnedFiles(manifest, route),
        routeChunkIds: clientEntry?.routeChunkIds ?? [],
        sharedChunkIds: clientEntry?.sharedChunkIds ?? [],
        preloadAssets: clientEntry?.preloadAssets ?? [],
        hydrationMode: clientEntry?.hydrationMode ?? "none",
        renderMode: clientEntry?.renderMode ?? "server-components",
        clientBoundaryFiles: clientEntry?.clientBoundaryFiles ?? [],
        clientBoundaryModuleIds: clientEntry?.clientBoundaryModuleIds ?? [],
        clientReferenceRefs: clientEntry?.clientReferenceRefs ?? [],
        boundaryRefs: clientEntry?.boundaryRefs ?? [],
        actionIds: clientEntry?.actionIds ?? [],
        actionEntries: clientEntry?.actionEntries ?? []
      };
    })
  };
}

export function createRouteOwnershipManifest(
  manifest: RouteManifest,
  clientArtifacts: ClientBuildArtifacts,
  buildId: string
): RouteOwnershipManifest {
  return {
    version: SOURCEOG_MANIFEST_VERSION,
    buildId,
    generatedAt: new Date().toISOString(),
    entries: [...manifest.pages, ...(manifest.handlers ?? [])].map((route) => {
      const clientEntry = clientArtifacts.routeEntries.find((entry) => entry.routeId === route.id);
      return {
        routeId: route.id,
        pathname: route.pathname,
        kind: route.kind,
        files: collectOwnedFiles(manifest, route),
        chunkName: toChunkName(route.id),
        generatedClientEntry: clientEntry?.generatedEntryFile,
        declaredClientAsset: clientEntry?.outputAsset,
        browserEntryAsset: clientEntry?.browserEntryAsset,
        metadataAsset: clientEntry?.metadataAsset,
        ownershipHash: clientEntry?.ownershipHash,
        routeChunkIds: clientEntry?.routeChunkIds ?? [],
        sharedChunkIds: clientEntry?.sharedChunkIds ?? [],
        hydrationMode: clientEntry?.hydrationMode ?? "none",
        renderMode: clientEntry?.renderMode ?? "server-components",
        clientBoundaryFiles: clientEntry?.clientBoundaryFiles ?? [],
        clientBoundaryModuleIds: clientEntry?.clientBoundaryModuleIds ?? [],
        clientReferenceRefs: clientEntry?.clientReferenceRefs ?? [],
        boundaryRefs: clientEntry?.boundaryRefs ?? [],
        actionIds: clientEntry?.actionIds ?? [],
        actionEntries: clientEntry?.actionEntries ?? []
      };
    })
  };
}

export function createClientBoundaryManifest(
  clientArtifacts: ClientBuildArtifacts,
  buildId: string
): ClientBoundaryManifest {
  return {
    version: SOURCEOG_MANIFEST_VERSION,
    buildId,
    generatedAt: new Date().toISOString(),
    entries: clientArtifacts.routeEntries.map((entry) => ({
      routeId: entry.routeId,
      pathname: entry.pathname,
      hydrationMode: entry.hydrationMode,
      boundaries: entry.boundaryRefs
    }))
  };
}

export function createRscReferenceManifest(
  manifest: RouteManifest,
  boundaryAnalysis: Pick<BoundaryAnalysisResult, "modules">,
  clientReferenceManifest: ClientReferenceManifest,
  serverReferenceManifest: ServerReferenceManifest,
  actionManifest: ActionManifest,
  clientArtifacts: ClientBuildArtifacts,
  buildId: string
): RscReferenceManifest {
  return {
    version: SOURCEOG_MANIFEST_VERSION,
    buildId,
    generatedAt: new Date().toISOString(),
    entries: manifest.pages.map((route) => {
      const clientEntry = clientArtifacts.routeEntries.find((entry) => entry.routeId === route.id);
      const clientReferences = clientReferenceManifest.entries.filter((entry) => entry.routeIds.includes(route.id));
      const serverReferences = serverReferenceManifest.entries.filter((entry) => entry.routeIds.includes(route.id));
      const runtimeTargets = route.capabilities.includes("edge-capable")
        ? ["node", "edge"] as Array<"node" | "edge">
        : ["node"] as Array<"node" | "edge">;
      const unsupportedRuntimeReasons = collectUnsupportedRuntimeReasons(route.id, route.pathname, runtimeTargets, boundaryAnalysis);
      const supportedRuntimeTargets = runtimeTargets.filter((runtime) => !unsupportedRuntimeReasons.some((issue) => issue.runtime === runtime));

      return {
        routeId: route.id,
        pathname: route.pathname,
        renderMode: clientEntry?.renderMode ?? "server-components",
        runtimeTargets: [...runtimeTargets].sort(),
        supportedRuntimeTargets: [...supportedRuntimeTargets].sort(),
        unsupportedRuntimeReasons,
        clientReferenceIds: clientReferences.map((entry) => entry.referenceId).sort(),
        serverReferenceIds: serverReferences.map((entry) => entry.referenceId).sort(),
        actionIds: actionManifest.entries.filter((entry) => entry.routeIds.includes(route.id)).map((entry) => entry.actionId).sort()
      };
    })
  };
}

export function createCacheManifest(input: {
  manifest: RouteManifest;
  prerendered: Array<{
    routeId: string;
    pathname: string;
    revalidate?: number;
    tags: string[];
  }>;
  actionManifest: ActionManifest;
  buildId: string;
}): CacheManifest {
  const routeById = new Map(input.manifest.pages.map((route) => [route.id, route]));
  const prerenderByRouteId = new Map(input.prerendered.map((entry) => [entry.routeId, entry]));

  const entries = [
    ...input.prerendered.map((entry) => {
      const actionIds = input.actionManifest.entries
        .filter((actionEntry) => actionEntry.routeIds.includes(entry.routeId))
        .map((actionEntry) => actionEntry.actionId)
        .sort();

      return {
        cacheKey: `route:${entry.routeId}`,
        kind: "route" as const,
        scope: "route" as const,
        source: "prerender" as const,
        routeId: entry.routeId,
        pathname: entry.pathname,
        tags: [...entry.tags].sort(),
        linkedRouteIds: [entry.routeId, entry.pathname].sort(),
        linkedTagIds: [...entry.tags].sort(),
        revalidate: entry.revalidate,
        actionIds
      };
    }),
    ...input.manifest.pages.map((route) => {
      const prerenderEntry = prerenderByRouteId.get(route.id);
      const tags = [...new Set(prerenderEntry?.tags ?? [])].sort();
      const actionIds = input.actionManifest.entries
        .filter((entry) => entry.routeIds.includes(route.id))
        .map((entry) => entry.actionId)
        .sort();

      return {
        cacheKey: `data:${route.id}`,
        kind: "data" as const,
        scope: "shared" as const,
        source: "runtime-fetch" as const,
        routeId: route.id,
        pathname: route.pathname,
        tags,
        linkedRouteIds: [route.id, route.pathname].sort(),
        linkedTagIds: tags,
        revalidate: prerenderEntry?.revalidate,
        actionIds
      };
    })
  ].sort((left, right) => left.cacheKey.localeCompare(right.cacheKey));

  const invalidationLinks = input.actionManifest.entries
    .map((entry) => {
      const routeIds = [...entry.routeIds].sort();
      const pathnames = routeIds
        .map((routeId) => routeById.get(routeId)?.pathname)
        .filter((value): value is string => Boolean(value))
        .sort();
      const tags = [...new Set(routeIds.flatMap((routeId) => prerenderByRouteId.get(routeId)?.tags ?? []))].sort();
      const targetCacheKeys = [
        ...new Set(routeIds.flatMap((routeId) => [`route:${routeId}`, `data:${routeId}`]))
      ].sort();

      return {
        actionId: entry.actionId,
        routeIds,
        pathnames,
        targetCacheKeys,
        tags,
        refreshPolicy: entry.refreshPolicy,
        revalidationPolicy: entry.revalidationPolicy
      };
    })
    .sort((left, right) => left.actionId.localeCompare(right.actionId));

  return {
    version: SOURCEOG_MANIFEST_VERSION,
    buildId: input.buildId,
    generatedAt: new Date().toISOString(),
    entries,
    invalidationLinks
  };
}

function collectUnsupportedRuntimeReasons(
  routeId: string,
  pathname: string,
  runtimeTargets: Array<"node" | "edge">,
  boundaryAnalysis: Pick<BoundaryAnalysisResult, "modules">
): RuntimeCapabilityIssue[] {
  if (!runtimeTargets.includes("edge")) {
    return [];
  }

  const issues: RuntimeCapabilityIssue[] = [];
  for (const module of boundaryAnalysis.modules.filter((entry) => entry.routeIds.includes(routeId))) {
    for (const builtinImport of module.nodeBuiltinImports) {
      issues.push({
        runtime: "edge",
        code: "SOURCEOG_EDGE_UNSUPPORTED_NODE_BUILTIN_IMPORT",
        message: `Route "${pathname}" imports Node builtin "${builtinImport}" through "${path.basename(module.filePath)}".`,
        filePath: module.filePath
      });
    }

    if (module.directive === "use-server" && module.actionExports.length > 0) {
      issues.push({
        runtime: "edge",
        code: "SOURCEOG_EDGE_UNSUPPORTED_SERVER_ACTION_RUNTIME",
        message: `Route "${pathname}" depends on Node-runtime Server Action module "${path.basename(module.filePath)}".`,
        filePath: module.filePath
      });
    }
  }

  const deduped = new Map<string, RuntimeCapabilityIssue>();
  for (const issue of issues) {
    deduped.set(`${issue.runtime}:${issue.code}:${issue.filePath ?? ""}`, issue);
  }
  return [...deduped.values()].sort((left, right) =>
    `${left.runtime}:${left.code}:${left.filePath ?? ""}`.localeCompare(`${right.runtime}:${right.code}:${right.filePath ?? ""}`)
  );
}

export function createRouteGraphManifest(manifest: RouteManifest, buildId: string): RouteGraphManifest {
  return {
    version: SOURCEOG_MANIFEST_VERSION,
    buildId,
    generatedAt: new Date().toISOString(),
    nodes: (manifest.routeGraph?.nodes ?? []).map((node) => ({ ...node })),
    routes: (manifest.routeGraph?.routes ?? []).map((route) => ({ ...route }))
  };
}

export function createDevManifest(manifest: RouteManifest, changedFiles: string[] = []): DevManifest {
  const invalidationPlan = planIncrementalInvalidation(manifest, changedFiles);
  return {
    version: SOURCEOG_MANIFEST_VERSION,
    generatedAt: new Date().toISOString(),
    routes: [...manifest.pages, ...(manifest.handlers ?? [])].map((route) => {
      const files = [
        ...collectOwnedFiles(manifest, route)
      ];

      return {
        routeId: route.id,
        pathname: route.pathname,
        files,
        changedFiles: changedFiles.filter((changedFile) => files.some((file) => normalize(file) === normalize(changedFile))),
        chunkName: route.id.replaceAll(":", "_").replaceAll("/", "_"),
        routeChunkIds: [toRouteChunkId(route.id)],
        affected: invalidationPlan.affectedRouteIds.includes(route.id),
        affectedChunkIds: invalidationPlan.affectedRouteIds.includes(route.id) ? [toRouteChunkId(route.id)] : [],
        generatedClientEntry: route.kind === "page"
          ? path.join(".sourceog", "generated", "client", `${route.id.replaceAll(":", "_").replaceAll("/", "_").replaceAll("[", "_").replaceAll("]", "_")}.tsx`)
          : ""
      };
    })
  };
}

export function planIncrementalInvalidation(
  manifest: RouteManifest,
  changedFiles: string[] = [],
  eventName?: string
): IncrementalInvalidationPlan {
  const normalizedChangedFiles = changedFiles.map(normalize);
  const affectedRouteIds = new Set<string>();
  const affectedPathnames = new Set<string>();
  const affectedChunkIds = new Set<string>();
  const reasons = new Set<string>();

  if (eventName === "add" || eventName === "unlink") {
    reasons.add(`filesystem-${eventName}`);
  }

  for (const route of [...manifest.pages, ...(manifest.handlers ?? [])]) {
    const ownedFiles = collectOwnedFiles(manifest, route).map(normalize);
    const matchingFiles = normalizedChangedFiles.filter((changedFile) => ownedFiles.includes(changedFile));
    if (matchingFiles.length === 0) {
      continue;
    }

    affectedRouteIds.add(route.id);
    affectedPathnames.add(route.pathname);
    affectedChunkIds.add(toRouteChunkId(route.id));

    if (matchingFiles.some((file) => STRUCTURAL_FILENAMES.has(path.basename(file)))) {
      reasons.add("structural-route-file");
    }
  }

  if (normalizedChangedFiles.length > 0 && affectedRouteIds.size === 0) {
    reasons.add("untracked-change");
  }

  return {
    changedFiles,
    affectedRouteIds: [...affectedRouteIds].sort(),
    affectedPathnames: [...affectedPathnames].sort(),
    affectedChunkIds: [...affectedChunkIds].sort(),
    fullReload: reasons.size > 0,
    reasons: [...reasons].sort()
  };
}

export function createDevDiagnostics(manifest: RouteManifest, changedFile?: string): DiagnosticIssue[] {
  const issues: DiagnosticIssue[] = [...manifest.diagnostics.issues];

  if (changedFile) {
    issues.push({
      level: "info",
      code: "SOURCEOG_DEV_FILE_CHANGED",
      message: `Detected change in "${path.basename(changedFile)}".`,
      file: changedFile,
      recoveryHint: "SourceOG will refresh affected routes and update the dev overlay."
    });
  }

  return issues;
}

function normalize(filePath: string): string {
  return filePath.replaceAll("\\", "/").toLowerCase();
}

// ---------------------------------------------------------------------------
// Phase 1 — Client Reference Registry (Req 1.1–1.8, INV-004)
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import type { AnalyzedModuleBoundary } from "./boundary.js";

/**
 * A single entry in the flat ClientReferenceManifest produced by
 * `buildClientReferenceManifest()`.  The key format is
 * `"normalizedPath#exportName"`.
 */
export interface ClientReferenceEntry {
  /** sha256(normalizedFilePath)[:16] — stable, lowercase hex (Req 1.1, 1.2) */
  id: string;
  /** Chunk hrefs for this module (Req 1.1) */
  chunks: string[];
  /** Export name: "default" or a named export (Req 1.7) */
  name: string;
  /** Whether the reference is async-loaded */
  async: boolean;
  /** Absolute path to the "use client" source file */
  filepath: string;
  /** All exports from this file (for validation) */
  exports: string[];
}

/**
 * Flat manifest keyed by `"normalizedPath#exportName"`.
 * Written to both server and browser paths atomically (INV-004).
 */
export type NewClientReferenceManifest = Record<string, ClientReferenceEntry>;

/**
 * Describes the chunk graph produced by the bundler.
 * Maps module file paths to the chunk hrefs that contain them.
 */
export interface ChunkGraph {
  /** Returns the chunk hrefs for a given module absolute path. */
  getChunksForModule(absolutePath: string): string[];
}

/** Compiler error thrown during manifest generation. */
export class CompilerError extends Error {
  public readonly code: string;

  public constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "CompilerError";
  }
}

/**
 * Normalise a file path to a stable, lowercase, forward-slash form.
 * Used as the basis for the stable `id` hash (Req 1.2).
 */
function normalizeModulePath(filePath: string): string {
  return filePath.replaceAll("\\", "/").toLowerCase();
}

/**
 * Compute the stable 16-character lowercase hex id for a module path.
 * `id = sha256(normalizedFilePath)[:16]` (Req 1.1, 1.2).
 */
function computeModuleId(filePath: string): string {
  return createHash("sha256")
    .update(normalizeModulePath(filePath))
    .digest("hex")
    .slice(0, 16);
}

/**
 * Write `payload` to `filePath` atomically via a temp-file-then-rename
 * strategy so the RSC worker never reads a partial file (Req 1.8, INV-004).
 */
async function writeAtomically(filePath: string, payload: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(payload, null, 2), "utf8");
  await fs.rename(tmp, filePath);
}

/**
 * Build the flat `NewClientReferenceManifest` from the analyzed module
 * boundaries and the bundler chunk graph, then atomically write it to:
 *   - `<distRoot>/manifests/client-reference-manifest.json`  (server use)
 *   - `<distRoot>/public/_sourceog/client-refs.json`          (browser use)
 *
 * Both files are written from the **same in-memory object** in a single
 * build step, satisfying INV-004 (manifest symmetry).
 *
 * @throws {CompilerError} `USE_CLIENT_NO_EXPORTS`  — "use client" file has no exports (Req 1.4)
 * @throws {CompilerError} `CLIENT_REF_NO_CHUNKS`   — "use client" file absent from chunk graph (Req 1.5)
 */
export async function buildClientReferenceManifest(
  modules: AnalyzedModuleBoundary[],
  chunkGraph: ChunkGraph,
  distRoot: string
): Promise<NewClientReferenceManifest> {
  const manifest: NewClientReferenceManifest = {};

  for (const module of modules) {
    if (module.directive !== "use-client") {
      continue;
    }

    // Req 1.4 — "use client" file must have at least one export.
    if (module.clientExports.length === 0) {
      throw new CompilerError(
        "USE_CLIENT_NO_EXPORTS",
        `"use client" file has no exports: ${module.filePath}\n` +
        'Every "use client" file must export at least one component or value.'
      );
    }

    // Req 1.5 — "use client" file must be present in the chunk graph.
    const chunks = chunkGraph.getChunksForModule(module.filePath);
    if (chunks.length === 0) {
      throw new CompilerError(
        "CLIENT_REF_NO_CHUNKS",
        `"use client" file has no chunks in the build graph: ${module.filePath}\n` +
        'This means the bundler did not include this file. Check your entry points.'
      );
    }

    const normalizedPath = normalizeModulePath(module.filePath);
    const id = computeModuleId(module.filePath);
    const exports = module.clientExports;

    // Req 1.7 — one entry per export (named + default).
    for (const exportName of exports) {
      const key = `${normalizedPath}#${exportName}`;
      manifest[key] = {
        id,
        chunks,
        name: exportName,
        async: false,
        filepath: module.filePath,
        exports
      };
    }
  }

  // Req 1.3, 1.8, INV-004 — write both files atomically from the same object.
  const serverPath = path.join(distRoot, "manifests", "client-reference-manifest.json");
  const browserPath = path.join(distRoot, "public", "_sourceog", "client-refs.json");

  await Promise.all([
    writeAtomically(serverPath, manifest),
    writeAtomically(browserPath, manifest)
  ]);

  return manifest;
}
