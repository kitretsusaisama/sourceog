/**
 * Property 11: Milestone Gate Completeness
 * Validates: Requirements 7.1, 7.2, 7.3 (INV-010)
 * Tag: `Feature: sourceog-rsc-contract-remediation, Property 11: Milestone Gate Completeness`
 */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "vitest";
import * as fc from "fast-check";
import {
  verifyMilestone3Runtime,
  type M3BuildResult,
  type RouteInfo
} from "@sourceog/compiler";
import type { RouteRuntimeCapability } from "@sourceog/compiler";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sourceog-pbt-m3gate-"));
  tempDirs.push(dir);
  return dir;
}

async function writeFile(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true }))
  );
});

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

function arbitraryRouteId(): fc.Arbitrary<string> {
  return fc
    .array(fc.stringMatching(/^[a-z][a-z0-9-]*$/), { minLength: 1, maxLength: 3 })
    .map((parts) => `page:/${parts.join("/")}`);
}

function arbitraryRouteInfo(): fc.Arbitrary<RouteInfo> {
  return fc.record({
    routeId: arbitraryRouteId(),
    runtimeTarget: fc.constantFrom("node" as const, "edge" as const),
    hasClientBoundaries: fc.boolean(),
    clientReferenceCount: fc.nat({ max: 10 }),
    // No flightEndpoint — avoids real HTTP calls (M3-004 passes trivially when no endpoints)
  });
}

function arbitraryEdgeCapability(): fc.Arbitrary<RouteRuntimeCapability> {
  return fc.record({
    routeId: arbitraryRouteId(),
    runtimeTarget: fc.constant("edge" as const),
    supportsEdge: fc.boolean(),
    violations: fc.array(
      fc.record({
        type: fc.constant("node-only-import" as const),
        importPath: fc.constantFrom("node:fs", "node:path", "node:crypto", "fs", "path"),
        importedBy: fc.stringMatching(/^\/[a-z0-9/_-]+\.ts$/).filter((s) => s.length > 5),
        line: fc.integer({ min: 1, max: 100 }),
        column: fc.integer({ min: 1, max: 80 }),
        suggestion: fc.constant("Use Web APIs instead of Node.js built-ins for Edge compatibility.")
      }),
      { minLength: 0, maxLength: 3 }
    )
  }).map((cap) => ({
    ...cap,
    // Ensure consistency: if violations exist, supportsEdge must be false
    supportsEdge: cap.violations.length === 0 ? cap.supportsEdge : false
  }));
}

/** Manifest kind: "matching" means server === browser (M3-008 passes); "mismatching" means they differ (M3-008 fails) */
type ManifestKind = "matching" | "mismatching";

interface ManifestSpec {
  kind: ManifestKind;
  entries: Array<{ key: string; id: string; chunks: string[] }>;
}

function arbitraryManifestSpec(): fc.Arbitrary<ManifestSpec> {
  const arbitraryEntry = fc.record({
    key: fc.stringMatching(/^[a-z][a-z0-9/_-]*\.tsx#[a-z][a-zA-Z0-9]*$/).filter((s) => s.length > 5),
    id: fc.stringMatching(/^[0-9a-f]{16}$/),
    chunks: fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 1, maxLength: 3 })
  });

  return fc.oneof(
    fc.record({
      kind: fc.constant("matching" as const),
      entries: fc.array(arbitraryEntry, { minLength: 0, maxLength: 3 })
    }),
    fc.record({
      kind: fc.constant("mismatching" as const),
      entries: fc.array(arbitraryEntry, { minLength: 1, maxLength: 3 })
    })
  );
}

/** HMR file kind controls which checks pass/fail for M3-002, M3-003, M3-010 */
type HmrKind =
  | "absent"
  | "clean"
  | "fallback-log-before-dom"
  | "hydrate-root-violation"
  | "replace-route-body-violation"
  | "no-fallback-log";

function arbitraryHmrKind(): fc.Arbitrary<HmrKind> {
  return fc.constantFrom(
    "absent" as const,
    "clean" as const,
    "fallback-log-before-dom" as const,
    "hydrate-root-violation" as const,
    "replace-route-body-violation" as const,
    "no-fallback-log" as const
  );
}

type FlightPayloadKind = "absent" | "clean" | "with-placeholder";

function arbitraryFlightPayloadKind(): fc.Arbitrary<FlightPayloadKind> {
  return fc.constantFrom("absent" as const, "clean" as const, "with-placeholder" as const);
}

interface BuildStateSpec {
  routes: RouteInfo[];
  edgeCapabilityResults: RouteRuntimeCapability[];
  workerPoolActive: boolean;
  slotInterceptParityPassed: boolean | undefined;
  manifestSpec: ManifestSpec;
  hmrKind: HmrKind;
  flightPayloadKind: FlightPayloadKind;
  buildId: string;
}

function arbitraryBuildStateSpec(): fc.Arbitrary<BuildStateSpec> {
  return fc.record({
    routes: fc.array(arbitraryRouteInfo(), { minLength: 0, maxLength: 5 }),
    edgeCapabilityResults: fc.array(arbitraryEdgeCapability(), { minLength: 0, maxLength: 3 }),
    workerPoolActive: fc.boolean(),
    slotInterceptParityPassed: fc.option(fc.boolean(), { nil: undefined }),
    manifestSpec: arbitraryManifestSpec(),
    hmrKind: arbitraryHmrKind(),
    flightPayloadKind: arbitraryFlightPayloadKind(),
    // Use alphanumeric-only buildId to avoid filesystem path issues
    buildId: fc.stringMatching(/^[a-z0-9]{8,16}$/)
  });
}

// ---------------------------------------------------------------------------
// Build state materializer — writes temp files and returns M3BuildResult
// ---------------------------------------------------------------------------

function hmrContentFor(kind: HmrKind): string {
  switch (kind) {
    case "clean":
      return `
        async function applyCanonicalFlight(payload) {
          root.render(reactTree);
        }
        async function hardFallbackHtmlReplace(payload, reason) {
          console.error("[SOURCEOG-FALLBACK]", {
            severity: "ERROR",
            type: "[SOURCEOG-FALLBACK]",
            route: payload.route,
            reason: reason.message,
            timestamp: new Date().toISOString()
          });
          document.body.innerHTML = payload.html;
        }
      `;
    case "fallback-log-before-dom":
      return `
        async function hardFallbackHtmlReplace(payload, reason) {
          console.error("[SOURCEOG-FALLBACK]", { severity: "ERROR", type: "[SOURCEOG-FALLBACK]" });
          document.body.innerHTML = payload.html;
        }
      `;
    case "hydrate-root-violation":
      return `
        function bootstrap() {
          hydrateRoot(document.body, React.createElement(App));
        }
        async function hardFallbackHtmlReplace(payload, reason) {
          console.error("[SOURCEOG-FALLBACK]", { type: "[SOURCEOG-FALLBACK]" });
          document.body.innerHTML = payload.html;
        }
      `;
    case "replace-route-body-violation":
      return `
        async function applyCanonicalFlight(payload) {
          replaceRouteBody(payload.html);
        }
        async function hardFallbackHtmlReplace(payload, reason) {
          try { doSomething(); } catch (err) { replaceRouteBody(payload.html); }
        }
      `;
    case "no-fallback-log":
      return `
        async function hardFallbackHtmlReplace(payload, reason) {
          document.body.innerHTML = payload.html;
        }
      `;
    case "absent":
      return "";
  }
}

async function materializeBuildState(dir: string, spec: BuildStateSpec): Promise<M3BuildResult> {
  const { buildId, manifestSpec, hmrKind, flightPayloadKind } = spec;

  // Write manifest files
  const serverManifestPath = path.join(dir, `server-${buildId}.json`);
  const browserManifestPath = path.join(dir, `browser-${buildId}.json`);

  if (manifestSpec.kind === "matching") {
    const obj: Record<string, { id: string; chunks: string[] }> = {};
    for (const entry of manifestSpec.entries) {
      obj[entry.key] = { id: entry.id, chunks: entry.chunks };
    }
    const json = JSON.stringify(obj);
    await writeFile(serverManifestPath, json);
    await writeFile(browserManifestPath, json);
  } else {
    // Mismatching: server has entries, browser has different ids
    const serverObj: Record<string, { id: string; chunks: string[] }> = {};
    const browserObj: Record<string, { id: string; chunks: string[] }> = {};
    for (const entry of manifestSpec.entries) {
      serverObj[entry.key] = { id: entry.id, chunks: entry.chunks };
      // Flip last char of id to make it different
      const flippedId = entry.id.slice(0, -1) + (entry.id.endsWith("a") ? "b" : "a");
      browserObj[entry.key] = { id: flippedId, chunks: entry.chunks };
    }
    await writeFile(serverManifestPath, JSON.stringify(serverObj));
    await writeFile(browserManifestPath, JSON.stringify(browserObj));
  }

  // Write hmr file if needed
  let hmrFilePath: string | undefined;
  if (hmrKind !== "absent") {
    hmrFilePath = path.join(dir, `hmr-${buildId}.ts`);
    await writeFile(hmrFilePath, hmrContentFor(hmrKind));
  }

  // Build flight payloads
  let flightPayloads: Map<string, string> | undefined;
  if (flightPayloadKind === "clean") {
    flightPayloads = new Map([
      ["page:/", '0:{"type":"div","props":{"children":"Hello"}}\n']
    ]);
  } else if (flightPayloadKind === "with-placeholder") {
    flightPayloads = new Map([
      ["page:/broken", '0:{"type":"div","props":{"data-sourceog-client-placeholder":"true"}}\n']
    ]);
  }

  return {
    buildId,
    routes: spec.routes,
    edgeCapabilityResults: spec.edgeCapabilityResults,
    serverManifestPath,
    browserManifestPath,
    workerPoolActive: spec.workerPoolActive,
    slotInterceptParityPassed: spec.slotInterceptParityPassed,
    hmrFilePath,
    flightPayloads
  };
}

// ---------------------------------------------------------------------------
// Property test
// ---------------------------------------------------------------------------

describe("Property 11: Milestone Gate Completeness", () => {
  it(
    "complete === true iff all 10 checks pass; result always has required shape; failing checks have required fields",
    async () => {
      const dir = await makeTempDir();

      await fc.assert(
        fc.asyncProperty(
          arbitraryBuildStateSpec(),
          async (spec) => {
            const buildResult = await materializeBuildState(dir, spec);
            const result = await verifyMilestone3Runtime(buildResult);

            // 1. Result always contains required fields
            if (typeof result.complete !== "boolean") return false;
            if (typeof result.score !== "number") return false;
            if (!Array.isArray(result.failingChecks)) return false;
            if (!Array.isArray(result.passingChecks)) return false;
            if (typeof result.timestamp !== "string" || result.timestamp.length === 0) return false;
            if (typeof result.buildId !== "string" || result.buildId.length === 0) return false;

            // 2. score is 0–100 integer
            if (result.score < 0 || result.score > 100) return false;
            if (!Number.isInteger(result.score)) return false;

            // 3. passingChecks + failingChecks === 10
            if (result.passingChecks.length + result.failingChecks.length !== 10) return false;

            // 4. score === Math.round((passingChecks.length / 10) * 100)
            const expectedScore = Math.round((result.passingChecks.length / 10) * 100);
            if (result.score !== expectedScore) return false;

            // 5. complete === true iff all 10 checks pass (failingChecks.length === 0)
            const allPass = result.failingChecks.length === 0;
            if (result.complete !== allPass) return false;

            // 6. Every failing check has all required fields with correct shapes
            for (const check of result.failingChecks) {
              if (typeof check.id !== "string") return false;
              if (!/^M3-\d{3}$/.test(check.id)) return false;
              if (typeof check.description !== "string" || check.description.length === 0) return false;
              if (typeof check.details !== "string") return false;
              if (typeof check.remediationGuide !== "string" || check.remediationGuide.length === 0) return false;
              if (typeof check.invariantViolated !== "string") return false;
              if (!/^INV-\d{3}$/.test(check.invariantViolated)) return false;
            }

            return true;
          }
        ),
        { numRuns: 100 }
      );
    },
    30000
  );
});
