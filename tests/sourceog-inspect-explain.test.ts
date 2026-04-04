import path from "node:path";
import { promises as fs } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  diffBuildArtifacts,
  explainDecision,
  inspectBuildArtifacts,
  inspectCache,
  inspectGovernance,
  inspectGraph,
  inspectRoute,
} from "@sourceog/compiler";

let tempDir: string | undefined;
const previousSessionSecret = process.env.SOURCEOG_SESSION_SECRET;

function shouldCopyFixture(sourcePath: string): boolean {
  const name = path.basename(sourcePath);
  return name !== "node_modules" && name !== ".sourceog" && name !== "out-test";
}

afterEach(async () => {
  if (previousSessionSecret === undefined) {
    delete process.env.SOURCEOG_SESSION_SECRET;
  } else {
    process.env.SOURCEOG_SESSION_SECRET = previousSessionSecret;
  }

  if (tempDir) {
    await fs.rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe.sequential("sourceog inspect and explain", () => {
  it("loads artifact, route, graph, cache, and decision views from manifest-backed output", async () => {
    const fixtureRoot = path.resolve(process.cwd(), "examples/app-basic");
    const tempRoot = path.join(process.cwd(), ".tmp-tests");
    await fs.mkdir(tempRoot, { recursive: true });
    tempDir = await fs.mkdtemp(path.join(tempRoot, "sourceog-inspect-"));
    await fs.cp(fixtureRoot, tempDir, { recursive: true, filter: shouldCopyFixture });
    process.env.SOURCEOG_SESSION_SECRET = "inspect-test-secret";

    const artifacts = await inspectBuildArtifacts(tempDir);
    expect(artifacts.routeCount).toBeGreaterThan(0);
    expect(artifacts.manifestNames).toContain("policyReplayManifest");
    expect(artifacts.manifestNames).toContain("governanceAuditManifest");

    const governance = await inspectGovernance(tempDir);
    expect(governance.packageContract.publicPackage).toBe("sourceog");
    expect(governance.runtimeContract.artifactOnlyProduction).toBe(true);
    expect(governance.laws.policyLaw).toBe(true);
    expect(governance.signatureAlignment.compiler).toBe(true);

    const route = await inspectRoute(tempDir, "/");
    expect(route.route.pathname).toBe("/");
    expect(Array.isArray(route.graph.nodes)).toBe(true);
    expect(Array.isArray(route.cache.entries)).toBe(true);

    const graph = await inspectGraph(tempDir, "/");
    expect(graph.route?.pathname).toBe("/");
    expect(Array.isArray(graph.consistencyNodes)).toBe(true);

    const cache = await inspectCache(tempDir, "/");
    expect(cache.matchedBy).toBe("route");
    expect(Array.isArray(cache.entries)).toBe(true);

    const explanation = await explainDecision(tempDir, "/");
    expect(explanation.pathname).toBe("/");
    expect(explanation.summary).toContain("/");
    expect(explanation.reducerPhases.length).toBeGreaterThan(0);
    expect(explanation.policyDiagnostics.loopNames.length).toBeGreaterThan(0);
    expect(explanation.doctor?.summary.reportPath).toContain("doctor-report.json");

    const diff = await diffBuildArtifacts(tempDir, tempDir);
    expect(diff.current.buildId).toBe(diff.baseline.buildId);
    expect(diff.manifests.added).toEqual([]);
    expect(diff.policyMesh.changedRoutes).toBeGreaterThanOrEqual(0);
  }, 120_000);
});
