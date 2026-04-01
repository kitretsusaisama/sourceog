// =============================================================================
// @sourceog/compiler
// Application build pipeline: route compilation, client reference manifest
// generation, and asset bundling. Called by buildApplication(cwd) in tests.
// =============================================================================

import path from "node:path";
import { mkdir, readFile, copyFile } from "node:fs/promises";
import { existsSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";

// We import router/platform lazily to avoid circular deps at type level
type RouteManifest = import("@sourceog/router").RouteManifest;
type SourceOGConfig = import("@sourceog/platform").SourceOGConfig;

// ---------------------------------------------------------------------------
// Client reference manifest types
// ---------------------------------------------------------------------------

export interface ClientReferenceEntry {
  /** Module ID — stable content hash of the source file */
  id: string;
  /** Export name */
  name: string;
  /** Chunk hrefs relative to publicPath */
  chunks: string[];
  /** Whether the module is dynamically imported */
  async: boolean;
  /** Absolute path to the compiled client chunk */
  filepath?: string;
}

export interface ClientReferenceManifestFile {
  version: 1;
  generatedAt: string;
  registry: Record<string, ClientReferenceEntry>;
}

// ---------------------------------------------------------------------------
// Build options
// ---------------------------------------------------------------------------

export interface BuildOptions {
  /** Set to true to skip actual esbuild/rolldown bundling (useful for tests) */
  skipBundle?: boolean;
  /** Force clean output directory before build */
  clean?: boolean;
  /** Custom environment variables injected at build time */
  env?: Record<string, string>;
}

export interface BuildResult {
  success: boolean;
  routeManifest: RouteManifest;
  clientReferenceManifestPath: string;
  outputDir: string;
  errors: string[];
  warnings: string[];
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hashFile(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

function stableModuleId(absolutePath: string, cwd: string): string {
  const rel = path.relative(cwd, absolutePath).replaceAll(path.sep, "/");
  return createHash("sha256").update(rel).digest("hex").slice(0, 16);
}

async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

const CLIENT_DIRECTIVE_RE = /^\s*["']use client["']/m;
const SERVER_DIRECTIVE_RE = /^\s*["']use server["']/m;

/**
 * Walk a directory recursively and collect files matching the given predicate.
 */
function walkFiles(
  dir: string,
  predicate: (filePath: string) => boolean,
  ignore: Set<string> = new Set(["node_modules", ".git", ".sourceog", "dist"])
): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (ignore.has(entry)) continue;
    const full = path.join(dir, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      results.push(...walkFiles(full, predicate, ignore));
    } else if (predicate(full)) {
      results.push(full);
    }
  }

  return results;
}

const SOURCE_EXTENSIONS = new Set([".tsx", ".ts", ".jsx", ".js", ".mjs"]);

function isSourceFile(filePath: string): boolean {
  return SOURCE_EXTENSIONS.has(path.extname(filePath));
}

/**
 * Scan a directory for 'use client' modules and build a client reference registry.
 */
async function buildClientReferenceRegistry(
  appRoot: string,
  cwd: string,
  outputDir: string
): Promise<Record<string, ClientReferenceEntry>> {
  const registry: Record<string, ClientReferenceEntry> = {};

  const sourceFiles = walkFiles(appRoot, isSourceFile);

  await Promise.all(
    sourceFiles.map(async (filePath) => {
      let content: string;
      try {
        content = await readFile(filePath, "utf8");
      } catch {
        return;
      }

      if (!CLIENT_DIRECTIVE_RE.test(content)) return;

      // Extract named exports to build one registry entry per export
      const exportNames = extractExportNames(content);
      if (exportNames.length === 0) exportNames.push("default");

      const moduleId = stableModuleId(filePath, cwd);
      const relPath = path.relative(cwd, filePath).replaceAll(path.sep, "/");

      for (const name of exportNames) {
        const entryKey = `${relPath}#${name}`;
        const chunkName = `${moduleId}.js`;

        registry[entryKey] = {
          id: moduleId,
          name,
          chunks: [`/_sourceog/chunks/${chunkName}`],
          async: false,
          filepath: filePath,
        };
      }
    })
  );

  return registry;
}

const EXPORT_RE = /export\s+(?:default\s+(?:function|class|const|let|var)|(?:const|let|var|function|class)\s+(\w+)|{\s*([^}]+)\s*})/g;

function extractExportNames(content: string): string[] {
  const names = new Set<string>();

  if (/export\s+default/.test(content)) {
    names.add("default");
  }

  let m: RegExpExecArray | null;
  const re = /export\s+(?:const|let|var|function|class|async\s+function)\s+(\w+)/g;
  while ((m = re.exec(content)) !== null) {
    if (m[1]) names.add(m[1]);
  }

  // Named re-exports: export { Foo, Bar }
  const namedRe = /export\s+\{([^}]+)\}/g;
  while ((m = namedRe.exec(content)) !== null) {
    if (m[1]) {
      for (const part of m[1].split(",")) {
        const name = part.trim().split(/\s+as\s+/).at(-1)?.trim();
        if (name && /^\w+$/.test(name)) names.add(name);
      }
    }
  }

  return [...names];
}

// ---------------------------------------------------------------------------
// Mock bundler (used when skipBundle = true, e.g. tests)
// ---------------------------------------------------------------------------

/**
 * In test/CI mode we don't invoke esbuild/rolldown. Instead we:
 *  1. Copy source files verbatim as "chunks" to .sourceog/server-client-references/
 *  2. Write the manifest so RscWorkerPool can load it
 */
async function mockBundle(
  registry: Record<string, ClientReferenceEntry>,
  outputDir: string
): Promise<void> {
  const refDir = path.join(outputDir, "server-client-references");
  await ensureDir(refDir);

  for (const entry of Object.values(registry)) {
    if (!entry.filepath || !existsSync(entry.filepath)) continue;
    const dest = path.join(refDir, `${entry.id}.js`);
    if (!existsSync(dest)) {
      await copyFile(entry.filepath, dest);
    }
  }
}

// ---------------------------------------------------------------------------
// Public: buildApplication (real implementation from build.ts)
// ---------------------------------------------------------------------------

export {
  buildApplication,
  type BuildResult as ApplicationBuildResult,
} from "./build.js";

// ---------------------------------------------------------------------------
// writeClientArtifacts (from client.ts)
// ---------------------------------------------------------------------------

export { writeClientArtifacts } from "./client.js";

// ---------------------------------------------------------------------------
// Utility re-exports
// ---------------------------------------------------------------------------

export { walkFiles, stableModuleId, hashFile };

// ---------------------------------------------------------------------------
// Re-exports from sub-modules (needed by tests and external consumers)
// ---------------------------------------------------------------------------

export {
  buildClientReferenceManifest,
  CompilerError,
  type ClientReferenceEntry as NewClientReferenceEntry,
  type NewClientReferenceManifest,
  type ChunkGraph,
} from "./manifests.js";

export type { AnalyzedModuleBoundary } from "./boundary.js";

export {
  NODE_ONLY_MODULES,
  computeRouteRuntimeCapability,
  enforceEdgeCapability,
  type EdgeViolation,
  type RouteRuntimeCapability,
} from "./boundary.js";

export {
  verifyMilestone3Runtime,
  type FailingCheck,
  type MilestoneVerificationResult,
  type RouteInfo,
  type M3BuildResult,
} from "./verify.js";

export {
  discoverClientBoundaries,
  type ClientBoundaryInfo,
  type ClientBoundaryDiscoveryResult,
} from "./client.js";

export {
  analyzeModuleBoundaries,
  type BoundaryAnalysisResult,
} from "./boundary.js";

export {
  createDevManifest,
  planIncrementalInvalidation,
  createDevDiagnostics,
  createRouteGraphManifest,
  createBundleManifestFromRoutes,
  createRouteOwnershipManifest,
  createClientBoundaryManifest,
  createRscReferenceManifest,
  createCacheManifest,
  type DevManifest,
  type DevManifestRouteEntry,
  type IncrementalInvalidationPlan,
} from "./manifests.js";

export {
  verifyApplication,
  verifyBuildOutput,
  type VerifyApplicationOptions,
  type VerifyApplicationReport,
} from "./verify.js";
