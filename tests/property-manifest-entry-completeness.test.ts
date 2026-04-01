/**
 * Property 2: Manifest Entry Completeness
 * Validates: Requirements 1.1, 1.7
 * Tag: `Feature: sourceog-rsc-contract-remediation, Property 2: Manifest Entry Completeness`
 */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "vitest";
import * as fc from "fast-check";
import { buildClientReferenceManifest } from "@sourceog/compiler";
import type { AnalyzedModuleBoundary, ChunkGraph } from "@sourceog/compiler";

const tempDirs: string[] = [];

async function makeTempDist(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sourceog-pbt-completeness-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true }))
  );
});

/**
 * Generates a single "use client" AnalyzedModuleBoundary with N unique exports
 * (minLength: 1 ensures at least one export).
 */
function arbitraryUseClientFileWithExports(): fc.Arbitrary<AnalyzedModuleBoundary> {
  return fc.record({
    filePath: fc.stringMatching(/^\/[a-zA-Z0-9_/-]+\.tsx$/).filter((s) => s.length > 5),
    directive: fc.constant("use-client" as const),
    importSpecifiers: fc.constant([]),
    resolvedLocalImports: fc.constant([]),
    nodeBuiltinImports: fc.constant([]),
    actionExports: fc.constant([]),
    clientExports: fc
      .array(fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]*$/), { minLength: 1, maxLength: 8 })
      .map((names) => Array.from(new Set(names)))
      .filter((names) => names.length >= 1),
    routeIds: fc.constant(["page:/"]),
    pathnames: fc.constant(["/"]),
  });
}

function makeChunkGraph(module: AnalyzedModuleBoundary): ChunkGraph {
  return {
    getChunksForModule(absolutePath: string): string[] {
      if (absolutePath === module.filePath) {
        return [`/__sourceog/chunks/${module.filePath.replace(/\//g, "_")}.js`];
      }
      return [];
    },
  };
}

describe("Property 2: Manifest Entry Completeness", () => {
  it(
    "manifest contains exactly N entries for a use-client file with N exports, each with valid id, non-empty chunks, and truthy name",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryUseClientFileWithExports(),
          async (module) => {
            const distRoot = await makeTempDist();
            const chunkGraph = makeChunkGraph(module);
            const n = module.clientExports.length;

            const manifest = await buildClientReferenceManifest([module], chunkGraph, distRoot);

            const entries = Object.values(manifest);

            // Exactly N entries — one per export (Req 1.7)
            if (entries.length !== n) {
              return false;
            }

            for (const entry of entries) {
              // id must be 16-char lowercase hex (Req 1.1)
              if (!/^[0-9a-f]{16}$/.test(entry.id)) {
                return false;
              }

              // chunks must be non-empty (Req 1.1)
              if (!entry.chunks || entry.chunks.length === 0) {
                return false;
              }

              // name must be truthy (Req 1.7)
              if (!entry.name) {
                return false;
              }
            }

            return true;
          }
        ),
        { numRuns: 100 }
      );
    }
  );
});
