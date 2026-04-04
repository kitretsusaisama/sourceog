/**
 * Property 1: Manifest ID Stability
 * Validates: Requirements 1.2
 * Tag: `Feature: sourceog-rsc-contract-remediation, Property 1: Manifest ID Stability`
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
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sourceog-pbt-stability-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true }))
  );
});

function arbitraryUseClientFile(): fc.Arbitrary<AnalyzedModuleBoundary> {
  return fc.record({
    filePath: fc.stringMatching(/^\/[a-zA-Z0-9_/-]+\.tsx$/).filter((s) => s.length > 5),
    directive: fc.constant("use-client" as const),
    importSpecifiers: fc.constant([]),
    resolvedLocalImports: fc.constant([]),
    nodeBuiltinImports: fc.constant([]),
    actionExports: fc.constant([]),
    clientExports: fc
      .array(fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]*$/), { minLength: 1, maxLength: 5 })
      .map((names) => Array.from(new Set(names))),
    routeIds: fc.constant(["page:/"]),
    pathnames: fc.constant(["/"]),
  });
}

function makeChunkGraph(modules: AnalyzedModuleBoundary[]): ChunkGraph {
  const map: Record<string, string[]> = {};
  for (const m of modules) {
    map[m.filePath] = [`/__sourceog/chunks/${m.filePath.replace(/\//g, "_")}.js`];
  }
  return {
    getChunksForModule(absolutePath: string): string[] {
      return map[absolutePath] ?? [];
    },
  };
}

describe("Property 1: Manifest ID Stability", () => {
  it("building the manifest twice produces identical id values per key", async () => {

    await fc.assert(
      fc.asyncProperty(
        fc.array(arbitraryUseClientFile(), { minLength: 1, maxLength: 5 }),
        async (modules) => {
          // Deduplicate by filePath to avoid conflicting chunk graph entries
          const unique = Array.from(
            new Map(modules.map((m) => [m.filePath, m])).values()
          );

          const distRoot = await makeTempDist();
          const chunkGraph = makeChunkGraph(unique);

          const first = await buildClientReferenceManifest(unique, chunkGraph, distRoot);
          const second = await buildClientReferenceManifest(unique, chunkGraph, distRoot);

          const keys = Object.keys(first);
          for (const key of keys) {
            if (first[key]?.id !== second[key]?.id) {
              return false;
            }
          }
          return true;
        }
      ),
      { numRuns: 100 }
    );
  }, 30000);
});
