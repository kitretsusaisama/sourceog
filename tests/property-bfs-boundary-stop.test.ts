/**
 * Property 4: BFS Boundary Stop
 * Validates: Requirements 1.6
 * Tag: `Feature: sourceog-rsc-contract-remediation, Property 4: BFS Boundary Stop`
 */

import { describe, it } from "vitest";
import * as fc from "fast-check";
import { discoverClientBoundaries } from "@sourceog/compiler";
import type { AnalyzedModuleBoundary } from "@sourceog/compiler";

// ---------------------------------------------------------------------------
// Graph model
// ---------------------------------------------------------------------------

interface GraphNode {
  filePath: string;
  directive: "use-client" | "use-server" | "none";
  resolvedLocalImports: string[];
}

interface ImportGraph {
  nodes: GraphNode[];
  entryFiles: string[];
}

// ---------------------------------------------------------------------------
// Arbitrary: import graph with embedded "use client" nodes
//
// Structure:
//   - A small set of server entry points (directive: "none")
//   - A layer of server modules that may import each other or client boundaries
//   - A layer of "use client" boundary nodes
//   - A layer of "client-only" modules that are only reachable through a
//     "use client" file (these must NEVER appear in serverModules)
// ---------------------------------------------------------------------------

function arbitraryImportGraph(): fc.Arbitrary<ImportGraph> {
  return fc
    .record({
      // 1–3 server entry points
      entryCount: fc.integer({ min: 1, max: 3 }),
      // 0–4 extra server modules (may import client boundaries)
      serverCount: fc.integer({ min: 0, max: 4 }),
      // 1–3 "use client" boundary nodes
      clientBoundaryCount: fc.integer({ min: 1, max: 3 }),
      // 0–3 modules that are ONLY reachable through a "use client" file
      clientOnlyCount: fc.integer({ min: 0, max: 3 }),
    })
    .chain(({ entryCount, serverCount, clientBoundaryCount, clientOnlyCount }) => {
      // Build deterministic file paths for each layer
      const entryPaths = Array.from(
        { length: entryCount },
        (_, i) => `/app/entry-${i}.tsx`
      );
      const serverPaths = Array.from(
        { length: serverCount },
        (_, i) => `/app/server-${i}.tsx`
      );
      const clientBoundaryPaths = Array.from(
        { length: clientBoundaryCount },
        (_, i) => `/app/client-boundary-${i}.tsx`
      );
      const clientOnlyPaths = Array.from(
        { length: clientOnlyCount },
        (_, i) => `/app/client-only-${i}.tsx`
      );

      const allServerPaths = [...entryPaths, ...serverPaths];

      // For each server module (entries + extras), generate a subset of
      // client boundaries it imports directly.
      const serverImportArbs = allServerPaths.map((serverPath) =>
        fc
          .subarray(clientBoundaryPaths, { minLength: 0, maxLength: clientBoundaryPaths.length })
          .map((importedBoundaries) => ({ serverPath, importedBoundaries }))
      );

      // For each client boundary, generate a subset of client-only modules it imports.
      const boundaryImportArbs = clientBoundaryPaths.map((boundaryPath) =>
        fc
          .subarray(clientOnlyPaths, { minLength: 0, maxLength: clientOnlyPaths.length })
          .map((importedClientOnly) => ({ boundaryPath, importedClientOnly }))
      );

      const serverImportsArbitrary = serverImportArbs.length > 0
        ? fc.tuple(...serverImportArbs)
        : fc.constant([] as Array<{ serverPath: string; importedBoundaries: string[] }>);

      const boundaryImportsArbitrary = boundaryImportArbs.length > 0
        ? fc.tuple(...boundaryImportArbs)
        : fc.constant([] as Array<{ boundaryPath: string; importedClientOnly: string[] }>);

      return fc
        .tuple(serverImportsArbitrary, boundaryImportsArbitrary)
        .map(([serverImports, boundaryImports]) => {
          // Build the server-side import map
          const serverImportMap = new Map<string, string[]>();
          for (const item of serverImports) {
            if (item && typeof item === "object" && "serverPath" in item) {
              serverImportMap.set(item.serverPath, item.importedBoundaries);
            }
          }

          // Build the boundary → client-only import map
          const boundaryImportMap = new Map<string, string[]>();
          for (const item of boundaryImports) {
            if (item && typeof item === "object" && "boundaryPath" in item) {
              boundaryImportMap.set(item.boundaryPath, item.importedClientOnly);
            }
          }

          const nodes: GraphNode[] = [];

          // Entry nodes (server, no directive)
          for (const p of entryPaths) {
            nodes.push({
              filePath: p,
              directive: "none",
              resolvedLocalImports: [
                ...serverPaths, // entries import all server modules
                ...(serverImportMap.get(p) ?? []),
              ],
            });
          }

          // Extra server nodes
          for (const p of serverPaths) {
            nodes.push({
              filePath: p,
              directive: "none",
              resolvedLocalImports: serverImportMap.get(p) ?? [],
            });
          }

          // "use client" boundary nodes — BFS must stop here
          for (const p of clientBoundaryPaths) {
            nodes.push({
              filePath: p,
              directive: "use-client",
              // These imports are client-only; BFS must NOT traverse them
              resolvedLocalImports: boundaryImportMap.get(p) ?? [],
            });
          }

          // Client-only nodes — only reachable through a "use client" file
          for (const p of clientOnlyPaths) {
            nodes.push({
              filePath: p,
              directive: "none",
              resolvedLocalImports: [],
            });
          }

          return {
            nodes,
            entryFiles: entryPaths,
            // Expose for assertion
            _clientOnlyPaths: clientOnlyPaths,
            _clientBoundaryPaths: clientBoundaryPaths,
          } as ImportGraph & {
            _clientOnlyPaths: string[];
            _clientBoundaryPaths: string[];
          };
        });
    });
}

// ---------------------------------------------------------------------------
// Helper: compute the set of modules reachable from entries WITHOUT crossing
// any "use client" file.  This is the ground-truth for what serverModules
// should contain.
// ---------------------------------------------------------------------------

function reachableWithoutCrossingClientBoundary(
  entryFiles: string[],
  nodes: GraphNode[]
): Set<string> {
  const nodeByPath = new Map(nodes.map((n) => [n.filePath, n]));
  const reachable = new Set<string>();
  const queue = [...entryFiles];

  while (queue.length > 0) {
    const filePath = queue.shift();
    if (filePath === undefined) continue;
    if (reachable.has(filePath)) continue;

    const node = nodeByPath.get(filePath);
    if (!node) continue;

    if (node.directive === "use-client") {
      // Stop — do not add to reachable server set, do not recurse
      continue;
    }

    reachable.add(filePath);
    for (const imp of node.resolvedLocalImports) {
      if (!reachable.has(imp)) {
        queue.push(imp);
      }
    }
  }

  return reachable;
}

// ---------------------------------------------------------------------------
// Convert GraphNode[] → AnalyzedModuleBoundary[] for discoverClientBoundaries
// ---------------------------------------------------------------------------

function toAnalyzedModules(nodes: GraphNode[]): AnalyzedModuleBoundary[] {
  return nodes.map((node) => ({
    filePath: node.filePath,
    directive: node.directive,
    importSpecifiers: [],
    resolvedLocalImports: node.resolvedLocalImports,
    nodeBuiltinImports: [],
    actionExports: [],
    clientExports: node.directive === "use-client" ? ["default"] : [],
    routeIds: ["page:/"],
    pathnames: ["/"],
  }));
}

// ---------------------------------------------------------------------------
// Property test
// ---------------------------------------------------------------------------

describe("Property 4: BFS Boundary Stop", () => {
  it(
    "serverModules contains no module reachable only through a 'use client' file",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryImportGraph(),
          async (graph) => {
            const extendedGraph = graph as ImportGraph & {
              _clientOnlyPaths: string[];
              _clientBoundaryPaths: string[];
            };

            const analyzedModules = toAnalyzedModules(graph.nodes);
            const { serverModules } = await discoverClientBoundaries(
              graph.entryFiles,
              analyzedModules
            );

            // 1. No client-only module (only reachable through a "use client" file)
            //    must appear in serverModules.
            for (const clientOnlyPath of extendedGraph._clientOnlyPaths) {
              if (serverModules.has(clientOnlyPath)) {
                return false;
              }
            }

            // 2. No "use client" boundary itself must appear in serverModules.
            for (const boundaryPath of extendedGraph._clientBoundaryPaths) {
              if (serverModules.has(boundaryPath)) {
                return false;
              }
            }

            // 3. Every module in serverModules must be reachable from an entry
            //    without crossing a "use client" file (ground-truth check).
            const groundTruth = reachableWithoutCrossingClientBoundary(
              graph.entryFiles,
              graph.nodes
            );
            for (const mod of serverModules) {
              if (!groundTruth.has(mod)) {
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
