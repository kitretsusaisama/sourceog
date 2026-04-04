/**
 * Unit tests for verifyMilestone3Runtime() — each M3 check individually.
 * Validates: Requirements 7.5–7.14
 */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  verifyMilestone3Runtime,
  type M3BuildResult,
  type RouteInfo
} from "@sourceog/compiler";
import type { RouteRuntimeCapability } from "@sourceog/compiler";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sourceog-m3-"));
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

function makeRoute(overrides: Partial<RouteInfo> = {}): RouteInfo {
  return {
    routeId: "page:/",
    runtimeTarget: "node",
    hasClientBoundaries: false,
    clientReferenceCount: 0,
    ...overrides
  };
}

function makeEdgeCapability(overrides: Partial<RouteRuntimeCapability> = {}): RouteRuntimeCapability {
  return {
    routeId: "page:/",
    runtimeTarget: "edge",
    supportsEdge: true,
    violations: [],
    ...overrides
  };
}

async function makeBuildResult(
  dir: string,
  overrides: Partial<M3BuildResult> = {}
): Promise<M3BuildResult> {
  const serverManifestPath = path.join(dir, "server-manifest.json");
  const browserManifestPath = path.join(dir, "browser-manifest.json");
  const emptyManifest = JSON.stringify({});
  await writeFile(serverManifestPath, emptyManifest);
  await writeFile(browserManifestPath, emptyManifest);

  return {
    buildId: "test-build-id",
    routes: [],
    edgeCapabilityResults: [],
    serverManifestPath,
    browserManifestPath,
    workerPoolActive: true,
    ...overrides
  };
}

describe("verifyMilestone3Runtime — result shape", () => {
  it("always returns complete, score, failingChecks, passingChecks, timestamp, buildId", async () => {
    const dir = await makeTempDir();
    const buildResult = await makeBuildResult(dir);
    const result = await verifyMilestone3Runtime(buildResult);

    expect(typeof result.complete).toBe("boolean");
    expect(typeof result.score).toBe("number");
    expect(Array.isArray(result.failingChecks)).toBe(true);
    expect(Array.isArray(result.passingChecks)).toBe(true);
    expect(typeof result.timestamp).toBe("string");
    expect(result.buildId).toBe("test-build-id");
  });

  it("complete === true when all checks pass", async () => {
    const dir = await makeTempDir();
    const buildResult = await makeBuildResult(dir, {
      workerPoolActive: true,
      slotInterceptParityPassed: true
    });
    const result = await verifyMilestone3Runtime(buildResult);

    expect(result.complete).toBe(true);
    expect(result.failingChecks).toHaveLength(0);
    expect(result.score).toBe(100);
  });

  it("complete === false when any check fails", async () => {
    const dir = await makeTempDir();
    const buildResult = await makeBuildResult(dir, {
      workerPoolActive: false // M3-005 will fail
    });
    const result = await verifyMilestone3Runtime(buildResult);

    expect(result.complete).toBe(false);
    expect(result.failingChecks.length).toBeGreaterThan(0);
  });

  it("score is 0–100 integer", async () => {
    const dir = await makeTempDir();
    const buildResult = await makeBuildResult(dir, { workerPoolActive: false });
    const result = await verifyMilestone3Runtime(buildResult);

    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(Number.isInteger(result.score)).toBe(true);
  });

  it("every failing check has id, description, details, remediationGuide, invariantViolated", async () => {
    const dir = await makeTempDir();
    const buildResult = await makeBuildResult(dir, { workerPoolActive: false });
    const result = await verifyMilestone3Runtime(buildResult);

    for (const check of result.failingChecks) {
      expect(typeof check.id).toBe("string");
      expect(check.id).toMatch(/^M3-\d{3}$/);
      expect(typeof check.description).toBe("string");
      expect(check.description.length).toBeGreaterThan(0);
      expect(typeof check.details).toBe("string");
      expect(typeof check.remediationGuide).toBe("string");
      expect(check.remediationGuide.length).toBeGreaterThan(0);
      expect(typeof check.invariantViolated).toBe("string");
      expect(check.invariantViolated).toMatch(/^INV-\d{3}$/);
    }
  });
});

describe("M3-001: clientReferenceCount check", () => {
  it("passes when no routes have client boundaries", async () => {
    const dir = await makeTempDir();
    const buildResult = await makeBuildResult(dir, {
      routes: [makeRoute({ hasClientBoundaries: false, clientReferenceCount: 0 })]
    });
    const result = await verifyMilestone3Runtime(buildResult);
    expect(result.passingChecks).toContain("M3-001");
    expect(result.failingChecks.find((c) => c.id === "M3-001")).toBeUndefined();
  });

  it("passes when routes with client boundaries have non-zero clientReferenceCount", async () => {
    const dir = await makeTempDir();
    const buildResult = await makeBuildResult(dir, {
      routes: [makeRoute({ hasClientBoundaries: true, clientReferenceCount: 3 })]
    });
    const result = await verifyMilestone3Runtime(buildResult);
    expect(result.passingChecks).toContain("M3-001");
  });

  it("fails when a route with client boundaries has clientReferenceCount === 0", async () => {
    const dir = await makeTempDir();
    const buildResult = await makeBuildResult(dir, {
      routes: [makeRoute({ routeId: "page:/broken", hasClientBoundaries: true, clientReferenceCount: 0 })]
    });
    const result = await verifyMilestone3Runtime(buildResult);
    const check = result.failingChecks.find((c) => c.id === "M3-001");
    expect(check).toBeDefined();
    if (!check) {
      throw new Error("Expected failing check with id M3-001, but none was found");
    }
    expect(check.invariantViolated).toBe("INV-002");
    expect(check.details).toContain("page:/broken");
  });
});

describe("M3-002: hydrateRoot at document root check", () => {
  it("passes when hmr.ts does not call hydrateRoot on document.body", async () => {
    const dir = await makeTempDir();
    const hmrFile = path.join(dir, "hmr.ts");
    await writeFile(hmrFile, `
      // Safe: hydrateRoot on a specific element
      function bootstrap() {
        const el = document.getElementById("root");
        hydrateRoot(el, React.createElement(App));
      }
    `);
    const buildResult = await makeBuildResult(dir, { hmrFilePath: hmrFile });
    const result = await verifyMilestone3Runtime(buildResult);
    expect(result.passingChecks).toContain("M3-002");
  });

  it("fails when hmr.ts calls hydrateRoot(document.body, ...)", async () => {
    const dir = await makeTempDir();
    const hmrFile = path.join(dir, "hmr.ts");
    await writeFile(hmrFile, `
      function bootstrap() {
        hydrateRoot(document.body, React.createElement(App));
      }
    `);
    const buildResult = await makeBuildResult(dir, { hmrFilePath: hmrFile });
    const result = await verifyMilestone3Runtime(buildResult);
    const check = result.failingChecks.find((c) => c.id === "M3-002");
    expect(check).toBeDefined();
    expect(check?.invariantViolated).toBe("INV-009");
  });

  it("fails when hmr.ts calls hydrateRoot(document.documentElement, ...)", async () => {
    const dir = await makeTempDir();
    const hmrFile = path.join(dir, "hmr.ts");
    await writeFile(hmrFile, 'hydrateRoot(document.documentElement, tree);');
    const buildResult = await makeBuildResult(dir, { hmrFilePath: hmrFile });
    const result = await verifyMilestone3Runtime(buildResult);
    expect(result.failingChecks.find((c) => c.id === "M3-002")).toBeDefined();
  });
});

describe("M3-003: replaceRouteBody outside catch branch check", () => {
  it("passes when replaceRouteBody is absent from hmr.ts", async () => {
    const dir = await makeTempDir();
    const hmrFile = path.join(dir, "hmr.ts");
    await writeFile(hmrFile, `
      async function hardFallbackHtmlReplace(payload, reason) {
        console.error("[SOURCEOG-FALLBACK]", { reason });
        document.body.innerHTML = payload.html;
      }
    `);
    const buildResult = await makeBuildResult(dir, { hmrFilePath: hmrFile });
    const result = await verifyMilestone3Runtime(buildResult);
    expect(result.passingChecks).toContain("M3-003");
  });

  it("passes when replaceRouteBody is only inside hardFallbackHtmlReplace catch block", async () => {
    const dir = await makeTempDir();
    const hmrFile = path.join(dir, "hmr.ts");
    await writeFile(hmrFile, `
      async function hardFallbackHtmlReplace(payload, reason) {
        try {
          doSomething();
        } catch (err) {
          replaceRouteBody(payload.html);
        }
      }
    `);
    const buildResult = await makeBuildResult(dir, { hmrFilePath: hmrFile });
    const result = await verifyMilestone3Runtime(buildResult);
    expect(result.passingChecks).toContain("M3-003");
  });

  it("fails when replaceRouteBody appears outside hardFallbackHtmlReplace", async () => {
    const dir = await makeTempDir();
    const hmrFile = path.join(dir, "hmr.ts");
    await writeFile(hmrFile, `
      async function applyCanonicalFlight(payload) {
        replaceRouteBody(payload.html); // violation: outside fallback
      }
      async function hardFallbackHtmlReplace(payload, reason) {
        try { doSomething(); } catch (err) { replaceRouteBody(payload.html); }
      }
    `);
    const buildResult = await makeBuildResult(dir, { hmrFilePath: hmrFile });
    const result = await verifyMilestone3Runtime(buildResult);
    const check = result.failingChecks.find((c) => c.id === "M3-003");
    expect(check).toBeDefined();
    expect(check?.invariantViolated).toBe("INV-005");
  });
});

describe("M3-005: RSC_Worker_Pool active check", () => {
  it("passes when workerPoolActive is true", async () => {
    const dir = await makeTempDir();
    const buildResult = await makeBuildResult(dir, { workerPoolActive: true });
    const result = await verifyMilestone3Runtime(buildResult);
    expect(result.passingChecks).toContain("M3-005");
  });

  it("fails when workerPoolActive is false", async () => {
    const dir = await makeTempDir();
    const buildResult = await makeBuildResult(dir, { workerPoolActive: false });
    const result = await verifyMilestone3Runtime(buildResult);
    const check = result.failingChecks.find((c) => c.id === "M3-005");
    expect(check).toBeDefined();
    expect(check?.invariantViolated).toBe("INV-006");
  });

  it("fails when rsc.ts contains per-request worker spawning in render()", async () => {
    const dir = await makeTempDir();
    const rscFile = path.join(dir, "rsc.ts");
    await writeFile(rscFile, `
      class RscWorkerPool {
        async render(route, context) {
          await this.spawnWorker(); // violation: per-request spawning
          return this.dispatch(route);
        }
        private async spawnWorker() { return new Worker("./worker.js"); }
      }
    `);
    const buildResult = await makeBuildResult(dir, {
      workerPoolActive: true,
      rscFilePath: rscFile
    });
    const result = await verifyMilestone3Runtime(buildResult);
    const check = result.failingChecks.find((c) => c.id === "M3-005");
    expect(check).toBeDefined();
  });
});

describe("M3-006: Edge capability check", () => {
  it("passes when no edge routes exist", async () => {
    const dir = await makeTempDir();
    const buildResult = await makeBuildResult(dir, { edgeCapabilityResults: [] });
    const result = await verifyMilestone3Runtime(buildResult);
    expect(result.passingChecks).toContain("M3-006");
  });

  it("passes when all edge routes have supportsEdge: true", async () => {
    const dir = await makeTempDir();
    const buildResult = await makeBuildResult(dir, {
      edgeCapabilityResults: [
        makeEdgeCapability({ routeId: "page:/edge", supportsEdge: true, violations: [] })
      ]
    });
    const result = await verifyMilestone3Runtime(buildResult);
    expect(result.passingChecks).toContain("M3-006");
  });

  it("fails when an edge route has violations", async () => {
    const dir = await makeTempDir();
    const buildResult = await makeBuildResult(dir, {
      edgeCapabilityResults: [
        makeEdgeCapability({
          routeId: "page:/edge-broken",
          supportsEdge: false,
          violations: [{
            type: "node-only-import",
            importPath: "node:fs",
            importedBy: "/route.ts",
            line: 1,
            column: 1,
            suggestion: "Use fetch() instead"
          }]
        })
      ]
    });
    const result = await verifyMilestone3Runtime(buildResult);
    const check = result.failingChecks.find((c) => c.id === "M3-006");
    expect(check).toBeDefined();
    expect(check?.invariantViolated).toBe("INV-007");
    expect(check?.details).toContain("page:/edge-broken");
  });
});

describe("M3-007: slot/intercept parity check", () => {
  it("passes when slotInterceptParityPassed is true", async () => {
    const dir = await makeTempDir();
    const buildResult = await makeBuildResult(dir, { slotInterceptParityPassed: true });
    const result = await verifyMilestone3Runtime(buildResult);
    expect(result.passingChecks).toContain("M3-007");
  });

  it("passes when slotInterceptParityPassed is undefined (not provided)", async () => {
    const dir = await makeTempDir();
    const buildResult = await makeBuildResult(dir, { slotInterceptParityPassed: undefined });
    const result = await verifyMilestone3Runtime(buildResult);
    expect(result.passingChecks).toContain("M3-007");
  });

  it("fails when slotInterceptParityPassed is false", async () => {
    const dir = await makeTempDir();
    const buildResult = await makeBuildResult(dir, { slotInterceptParityPassed: false });
    const result = await verifyMilestone3Runtime(buildResult);
    const check = result.failingChecks.find((c) => c.id === "M3-007");
    expect(check).toBeDefined();
    expect(check?.invariantViolated).toBe("INV-008");
  });
});

describe("M3-008: manifest symmetry check", () => {
  it("passes when server and browser manifests are identical", async () => {
    const dir = await makeTempDir();
    const manifest = JSON.stringify({
      "src/button.tsx#default": { id: "abc123def456abcd", chunks: ["/__sourceog/chunks/button.js"] }
    });
    const serverPath = path.join(dir, "server.json");
    const browserPath = path.join(dir, "browser.json");
    await writeFile(serverPath, manifest);
    await writeFile(browserPath, manifest);

    const buildResult = await makeBuildResult(dir, {
      serverManifestPath: serverPath,
      browserManifestPath: browserPath
    });
    const result = await verifyMilestone3Runtime(buildResult);
    expect(result.passingChecks).toContain("M3-008");
  });

  it("fails when server manifest has a key missing from browser manifest", async () => {
    const dir = await makeTempDir();
    const serverManifest = JSON.stringify({
      "src/button.tsx#default": { id: "abc123def456abcd", chunks: ["/__sourceog/chunks/button.js"] }
    });
    const browserManifest = JSON.stringify({});
    const serverPath = path.join(dir, "server.json");
    const browserPath = path.join(dir, "browser.json");
    await writeFile(serverPath, serverManifest);
    await writeFile(browserPath, browserManifest);

    const buildResult = await makeBuildResult(dir, {
      serverManifestPath: serverPath,
      browserManifestPath: browserPath
    });
    const result = await verifyMilestone3Runtime(buildResult);
    const check = result.failingChecks.find((c) => c.id === "M3-008");
    expect(check).toBeDefined();
    expect(check?.invariantViolated).toBe("INV-004");
  });

  it("fails when id values differ between server and browser manifests", async () => {
    const dir = await makeTempDir();
    const key = "src/button.tsx#default";
    const serverManifest = JSON.stringify({ [key]: { id: "aaaa1111bbbb2222", chunks: ["chunk.js"] } });
    const browserManifest = JSON.stringify({ [key]: { id: "cccc3333dddd4444", chunks: ["chunk.js"] } });
    const serverPath = path.join(dir, "server.json");
    const browserPath = path.join(dir, "browser.json");
    await writeFile(serverPath, serverManifest);
    await writeFile(browserPath, browserManifest);

    const buildResult = await makeBuildResult(dir, {
      serverManifestPath: serverPath,
      browserManifestPath: browserPath
    });
    const result = await verifyMilestone3Runtime(buildResult);
    expect(result.failingChecks.find((c) => c.id === "M3-008")).toBeDefined();
  });

  it("fails when server manifest file is missing", async () => {
    const dir = await makeTempDir();
    const browserPath = path.join(dir, "browser.json");
    await writeFile(browserPath, "{}");

    const buildResult = await makeBuildResult(dir, {
      serverManifestPath: path.join(dir, "nonexistent.json"),
      browserManifestPath: browserPath
    });
    const result = await verifyMilestone3Runtime(buildResult);
    expect(result.failingChecks.find((c) => c.id === "M3-008")).toBeDefined();
  });
});

describe("M3-009: no data-sourceog-client-placeholder in Flight payloads", () => {
  it("passes when no flight payloads are provided", async () => {
    const dir = await makeTempDir();
    const buildResult = await makeBuildResult(dir, { flightPayloads: undefined });
    const result = await verifyMilestone3Runtime(buildResult);
    expect(result.passingChecks).toContain("M3-009");
  });

  it("passes when flight payloads do not contain the placeholder", async () => {
    const dir = await makeTempDir();
    const payloads = new Map([
      ["page:/", '0:{"type":"div","props":{"children":"Hello"}}\n'],
      ["page:/about", '0:{"type":"p","props":{"children":"About"}}\n']
    ]);
    const buildResult = await makeBuildResult(dir, { flightPayloads: payloads });
    const result = await verifyMilestone3Runtime(buildResult);
    expect(result.passingChecks).toContain("M3-009");
  });

  it("fails when a flight payload contains data-sourceog-client-placeholder", async () => {
    const dir = await makeTempDir();
    const payloads = new Map([
      ["page:/broken", '0:{"type":"div","props":{"data-sourceog-client-placeholder":"true"}}\n']
    ]);
    const buildResult = await makeBuildResult(dir, { flightPayloads: payloads });
    const result = await verifyMilestone3Runtime(buildResult);
    const check = result.failingChecks.find((c) => c.id === "M3-009");
    expect(check).toBeDefined();
    expect(check?.invariantViolated).toBe("INV-002");
    expect(check?.details).toContain("page:/broken");
  });
});

describe("M3-010: [SOURCEOG-FALLBACK] log entries check", () => {
  it("passes when hmrFilePath is not provided", async () => {
    const dir = await makeTempDir();
    const buildResult = await makeBuildResult(dir, { hmrFilePath: undefined });
    const result = await verifyMilestone3Runtime(buildResult);
    expect(result.passingChecks).toContain("M3-010");
  });

  it("passes when hmr.ts contains [SOURCEOG-FALLBACK] log before DOM modification", async () => {
    const dir = await makeTempDir();
    const hmrFile = path.join(dir, "hmr.ts");
    await writeFile(hmrFile, `
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
    `);
    const buildResult = await makeBuildResult(dir, { hmrFilePath: hmrFile });
    const result = await verifyMilestone3Runtime(buildResult);
    expect(result.passingChecks).toContain("M3-010");
  });

  it("fails when hmr.ts has no [SOURCEOG-FALLBACK] log entries", async () => {
    const dir = await makeTempDir();
    const hmrFile = path.join(dir, "hmr.ts");
    await writeFile(hmrFile, `
      async function hardFallbackHtmlReplace(payload, reason) {
        document.body.innerHTML = payload.html;
      }
    `);
    const buildResult = await makeBuildResult(dir, { hmrFilePath: hmrFile });
    const result = await verifyMilestone3Runtime(buildResult);
    const check = result.failingChecks.find((c) => c.id === "M3-010");
    expect(check).toBeDefined();
    expect(check?.invariantViolated).toBe("INV-005");
  });

  it("fails when [SOURCEOG-FALLBACK] log appears after DOM modification", async () => {
    const dir = await makeTempDir();
    const hmrFile = path.join(dir, "hmr.ts");
    await writeFile(hmrFile, `
      async function hardFallbackHtmlReplace(payload, reason) {
        document.body.innerHTML = payload.html; // DOM first — violation
        console.error("[SOURCEOG-FALLBACK]", { reason });
      }
    `);
    const buildResult = await makeBuildResult(dir, { hmrFilePath: hmrFile });
    const result = await verifyMilestone3Runtime(buildResult);
    const check = result.failingChecks.find((c) => c.id === "M3-010");
    expect(check).toBeDefined();
  });
});

describe("M3-004: Flight endpoint Content-Type check", () => {
  it("passes when no routes have flight endpoints", async () => {
    const dir = await makeTempDir();
    const buildResult = await makeBuildResult(dir, {
      routes: [makeRoute({ flightEndpoint: undefined })]
    });
    const result = await verifyMilestone3Runtime(buildResult);
    expect(result.passingChecks).toContain("M3-004");
  });

  it("passes when routes array is empty", async () => {
    const dir = await makeTempDir();
    const buildResult = await makeBuildResult(dir, { routes: [] });
    const result = await verifyMilestone3Runtime(buildResult);
    expect(result.passingChecks).toContain("M3-004");
  });
});
