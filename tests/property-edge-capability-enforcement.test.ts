/**
 * Property 10: Edge Capability Enforcement
 * Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5
 * Tag: `Feature: sourceog-rsc-contract-remediation, Property 10: Edge Capability Enforcement`
 */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "vitest";
import * as fc from "fast-check";
import {
  computeRouteRuntimeCapability,
  enforceEdgeCapability,
  NODE_ONLY_MODULES
} from "@sourceog/compiler";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sourceog-pbt-edge-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true }))
  );
});

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Picks a random module from NODE_ONLY_MODULES */
function arbitraryNodeOnlyModule(): fc.Arbitrary<string> {
  const modules = [...NODE_ONLY_MODULES];
  return fc.integer({ min: 0, max: modules.length - 1 }).map((i) => modules[i]!);
}

/** Generates a valid route ID string */
function arbitraryRouteId(): fc.Arbitrary<string> {
  return fc
    .array(fc.stringMatching(/^[a-z][a-z0-9-]*$/), { minLength: 1, maxLength: 3 })
    .map((parts) => `page:/${parts.join("/")}`);
}

// ---------------------------------------------------------------------------
// Property test
// ---------------------------------------------------------------------------

describe("Property 10: Edge Capability Enforcement", () => {
  it(
    "edge route importing a node-only module produces violations and throws EDGE_CAPABILITY_VIOLATION",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryNodeOnlyModule(),
          arbitraryRouteId(),
          async (nodeModule, routeId) => {
            const dir = await makeTempDir();
            const routeFile = path.join(dir, "route.ts");

            // Write a route file that directly imports the node-only module
            await fs.writeFile(
              routeFile,
              `import "${nodeModule}";\nexport default function Page() { return null; }\n`,
              "utf8"
            );

            const capability = await computeRouteRuntimeCapability(routeFile, routeId, "edge");

            // Must have at least one violation
            if (capability.violations.length === 0) return false;
            // supportsEdge must be false
            if (capability.supportsEdge !== false) return false;
            // enforceEdgeCapability must throw with EDGE_CAPABILITY_VIOLATION code
            let threw = false;
            try {
              enforceEdgeCapability(capability);
            } catch (err: unknown) {
              if (err instanceof Error && "code" in err && (err as { code: string }).code === "EDGE_CAPABILITY_VIOLATION") {
                threw = true;
              }
            }
            if (!threw) return false;

            // Violation must reference the correct import path
            const hasMatchingViolation = capability.violations.some(
              (v) => v.importPath === nodeModule && v.importedBy === routeFile
            );
            if (!hasMatchingViolation) return false;

            return true;
          }
        ),
        { numRuns: 100 }
      );
    }
  );

  it(
    "clean edge route (no node-only imports) produces supportsEdge: true and empty violations",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryRouteId(),
          async (routeId) => {
            const dir = await makeTempDir();
            const routeFile = path.join(dir, "route.ts");

            // Write a clean route with no node-only imports
            await fs.writeFile(
              routeFile,
              `export default function Page() { return null; }\n`,
              "utf8"
            );

            const capability = await computeRouteRuntimeCapability(routeFile, routeId, "edge");

            if (capability.violations.length !== 0) return false;
            if (capability.supportsEdge !== true) return false;

            // enforceEdgeCapability must NOT throw
            let threw = false;
            try {
              enforceEdgeCapability(capability);
            } catch {
              threw = true;
            }
            if (threw) return false;

            return true;
          }
        ),
        { numRuns: 100 }
      );
    }
  );
});
