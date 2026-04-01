import path from "node:path";
import { promises as fs } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { verifyApplication } from "@sourceog/compiler";
import { runFirstPartyAdapterParityVerification, materializePathname } from "../packages/sourceog-cli/src/verify-parity";

let tempDir: string | undefined;

function shouldCopyFixture(sourcePath: string): boolean {
  const name = path.basename(sourcePath);
  return name !== "node_modules" && name !== ".sourceog" && name !== "out-test";
}

afterEach(async () => {
  if (tempDir) {
    await fs.rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe.sequential("release gate", () => {
  it("verifies build outputs and manifest integrity without external workspace checks", async () => {
    const fixtureRoot = path.resolve(process.cwd(), "examples/app-basic");
    const tempRoot = path.join(process.cwd(), ".tmp-tests");
    await fs.mkdir(tempRoot, { recursive: true });
    tempDir = await fs.mkdtemp(path.join(tempRoot, "sourceog-verify-"));
    await fs.cp(fixtureRoot, tempDir, { recursive: true, filter: shouldCopyFixture });
    const cwd = tempDir;
    const report = await verifyApplication(cwd, {
      runTypecheck: false,
      runTests: false
    });

    expect(report.buildResult.budgetReport.passed).toBe(true);
    expect(report.workspaceRoot).toBe(path.resolve(process.cwd()));
    expect(report.checkedManifests).toContain("deploymentManifest");
    expect(report.checkedManifests).toContain("assetManifest");
    expect(report.checkedManifests).toContain("routeOwnershipManifest");
    expect(report.checkedManifests).toContain("bundleManifest");
    expect(report.checkedManifests).toContain("routeGraphManifest");
    expect(report.checkedManifests).toContain("clientReferenceManifest");
    expect(report.checkedManifests).toContain("rscReferenceManifest");
    expect(report.checkedManifests).toContain("serverReferenceManifest");
    expect(report.checkedManifests).toContain("actionManifest");
    expect(report.checkedManifests).toContain("cacheManifest");
    expect(report.buildResult.deploymentManifest.routes.some((route) => route.routeId === "page:/about" && route.edgeCompatible === false && route.unsupportedRuntimeReasons?.some((reason) => reason.code === "SOURCEOG_EDGE_UNSUPPORTED_SERVER_ACTION_RUNTIME"))).toBe(true);
    expect(report.buildResult.deploymentManifest.routes.some((route) => route.routeId === "page:/playground" && route.edgeCompatible === true && route.supportedRuntimeTargets?.includes("edge"))).toBe(true);
    expect(report.parityScoreboard.overallCompetitiveReadiness).toBe(63);
    expect(report.parityScoreboard.remainingWorkEstimate).toBe(37);
    expect(report.parityScoreboard.evidence.routeCount).toBeGreaterThan(0);
    expect(report.parityScoreboard.evidence.checkedManifestCount).toBe(report.checkedManifests.length);
    expect(report.parityScoreboard.subsystemScores.find((score: { id: string }) => score.id === "cache")?.score).toBe(50);
    expect(report.milestoneDashboard.currentMilestone).toBe("milestone-3-true-rsc-and-flight-runtime");
    expect(
      report.milestoneDashboard.milestones.find((milestone: { id: string; status: string }) => milestone.id === "milestone-0-baseline-freeze-and-scoreboard")
        ?.status
    ).toBe("completed");
    expect(
      report.milestoneDashboard.milestones.find((milestone: { id: string; status: string }) => milestone.id === "milestone-1-canonical-app-router-runtime-graph")
        ?.status
    ).toBe("completed");
    expect(
      report.milestoneDashboard.milestones.find((milestone: { id: string; status: string }) => milestone.id === "milestone-2-real-boundary-runtime")
        ?.status
    ).toBe("completed");
    expect(report.milestoneDashboard.metrics.find((metric: { name: string }) => metric.name === "buildDurationMs")?.status).toBe("measured");

    const parityScoreboard = JSON.parse(await fs.readFile(report.artifactPaths.parityScoreboard, "utf8")) as {
      overallCompetitiveReadiness: number;
      evidence: { routeCount: number };
    };
    const milestoneDashboard = JSON.parse(await fs.readFile(report.artifactPaths.milestoneDashboard, "utf8")) as {
      currentMilestone: string;
      milestones: Array<{ id: string; status: string }>;
    };

    expect(parityScoreboard.overallCompetitiveReadiness).toBe(63);
    expect(parityScoreboard.evidence.routeCount).toBeGreaterThan(0);
    expect(milestoneDashboard.currentMilestone).toBe("milestone-3-true-rsc-and-flight-runtime");
    expect(milestoneDashboard.milestones.some((milestone: { id: string; status: string }) => milestone.id === "milestone-0-baseline-freeze-and-scoreboard" && milestone.status === "completed")).toBe(true);
    expect(milestoneDashboard.milestones.some((milestone: { id: string; status: string }) => milestone.id === "milestone-1-canonical-app-router-runtime-graph" && milestone.status === "completed")).toBe(true);
    expect(milestoneDashboard.milestones.some((milestone: { id: string; status: string }) => milestone.id === "milestone-2-real-boundary-runtime" && milestone.status === "completed")).toBe(true);
  }, 75_000);

  it("verifies first-party adapter parity against the deployment manifest", async () => {
    const fixtureRoot = path.resolve(process.cwd(), "examples/app-basic");
    const tempRoot = path.join(process.cwd(), ".tmp-tests");
    await fs.mkdir(tempRoot, { recursive: true });
    tempDir = await fs.mkdtemp(path.join(tempRoot, "sourceog-verify-"));
    await fs.cp(fixtureRoot, tempDir, { recursive: true, filter: shouldCopyFixture });
    const cwd = tempDir;
    const report = await verifyApplication(cwd, {
      runTypecheck: false,
      runTests: false
    });

    const parity = await runFirstPartyAdapterParityVerification(report.buildResult.deploymentManifest);

    expect(parity.passed).toBe(true);
    expect(parity.fixtureCount).toBeGreaterThan(1);
  }, 75_000);

  it("materializes route patterns into concrete parity fixture paths", () => {
    expect(materializePathname("/blog/[slug]")).toBe("/blog/sourceog");
    expect(materializePathname("/docs/[...parts]")).toBe("/docs/sourceog/parity");
    expect(materializePathname("/shop/[[...slug]]")).toBe("/shop");
    expect(materializePathname("/")).toBe("/");
  });
});