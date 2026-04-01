/**
 * Property 3: Manifest Symmetry
 * Validates: Requirements 1.3, 8.4 (INV-004)
 * Tag: `Feature: sourceog-rsc-contract-remediation, Property 3: Manifest Symmetry`
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
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sourceog-pbt-symmetry-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true }))
  );
});

/**
 * Generates an array of "use client" AnalyzedModuleBoundary objects
 * with at least one export each (arbitraryProject).
 */
function arbitraryProject(): fc.Arbitrary<AnalyzedModuleBoundary[]> {
  return fc
    .array(
      fc.record({
        filePath: fc
          .stringMatching(/^\/[a-zA-Z0-9_/-]+\.tsx$/)
          .filter((s) => s.length > 5),
        directive: fc.constant("use-client" as const),
        importSpecifiers: fc.constant([] as string[]),
        resolvedLocalImports: fc.constant([] as string[]),
        nodeBuiltinImports: fc.constant([] as string[]),
        actionExports: fc.constant([] as string[]),
        clientExports: fc
          .array(fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]*$/), {
            minLength: 1,
            maxLength: 5,
          })
          .map((names) => Array.from(new Set(names)))
          .filter((names) => names.length >= 1),
        routeIds: fc.constant(["page:/"] as string[]),
        pathnames: fc.constant(["/"]) as fc.Arbitrary<string[]>,
      }),
      { minLength: 1, maxLength: 5 }
    )
    .map((modules) =>
      // Deduplicate by filePath to avoid conflicting chunk graph entries
      Array.from(new Map(modules.map((m) => [m.filePath, m])).values())
    )
    .filter((modules) => modules.length >= 1);
}

function makeChunkGraph(modules: AnalyzedModuleBoundary[]): ChunkGraph {
  const map: Record<string, string[]> = {};
  for (const m of modules) {
    map[m.filePath] = [
      `/__sourceog/chunks/${m.filePath.replace(/\//g, "_")}.js`,
    ];
  }
  return {
    getChunksForModule(absolutePath: string): string[] {
      return map[absolutePath] ?? [];
    },
  };
}

describe("Property 3: Manifest Symmetry", () => {
  it(
    "server manifest and browser manifest are deeply equal after build (INV-004)",
    async () => {
      await fc.assert(
        fc.asyncProperty(arbitraryProject(), async (modules) => {
          const distRoot = await makeTempDist();
          const chunkGraph = makeChunkGraph(modules);

          await buildClientReferenceManifest(modules, chunkGraph, distRoot);

          const serverPath = path.join(
            distRoot,
            "manifests",
            "client-reference-manifest.json"
          );
          const browserPath = path.join(
            distRoot,
            "public",
            "_sourceog",
            "client-refs.json"
          );

          const [serverRaw, browserRaw] = await Promise.all([
            fs.readFile(serverPath, "utf8"),
            fs.readFile(browserPath, "utf8"),
          ]);

          const serverManifest = JSON.parse(serverRaw);
          const browserManifest = JSON.parse(browserRaw);

          // Both files must be deeply equal — written from the same in-memory object
          const serverKeys = Object.keys(serverManifest).sort();
          const browserKeys = Object.keys(browserManifest).sort();

          if (serverKeys.length !== browserKeys.length) return false;
          if (serverKeys.join(",") !== browserKeys.join(",")) return false;

          for (const key of serverKeys) {
            const s = serverManifest[key];
            const b = browserManifest[key];

            if (s.id !== b.id) return false;
            if (JSON.stringify(s.chunks.sort()) !== JSON.stringify(b.chunks.sort())) return false;
            if (s.name !== b.name) return false;
            if (s.async !== b.async) return false;
            if (s.filepath !== b.filepath) return false;
            if (JSON.stringify(s.exports.sort()) !== JSON.stringify(b.exports.sort())) return false;
          }

          return true;
        }),
        { numRuns: 100 }
      );
    },
    30_000
  );
});
