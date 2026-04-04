import path from "node:path";
import { promises as fs } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { buildApplication } from "@sourceog/compiler";
import { createTestInstance } from "@sourceog/testing";

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

describe.sequential("ADOSF build and runtime integration", () => {
  it("writes ADOSF manifests and serves debug endpoints", async () => {
    const fixtureRoot = path.resolve(process.cwd(), "examples/app-basic");
    const tempRoot = path.join(process.cwd(), ".tmp-tests");
    await fs.mkdir(tempRoot, { recursive: true });
    tempDir = await fs.mkdtemp(path.join(tempRoot, "sourceog-adosf-"));
    await fs.cp(fixtureRoot, tempDir, { recursive: true, filter: shouldCopyFixture });

    const result = await buildApplication(tempDir);
    const manifests = result.deploymentManifest.manifests as Record<string, string>;

    expect(manifests.controlPlaneManifest).toContain("control-plane-manifest.json");
    expect(manifests.consistencyGraphManifest).toContain("consistency-graph.json");
    expect(manifests.tunerSnapshotManifest).toContain("tuner-snapshot.json");
    expect(manifests.policyReplayManifest).toContain("policy-replay-manifest.json");
    expect(manifests.deploymentSignatureManifest).toContain("deployment-signature-manifest.json");
    expect(manifests.governanceAuditManifest).toContain("governance-audit-manifest.json");
    expect(manifests.releaseEvidenceIndexManifest).toContain("release-evidence-index.json");

    const controlPlaneManifest = JSON.parse(await fs.readFile(manifests.controlPlaneManifest, "utf8")) as {
      entries: Array<{ routeId: string }>;
    };
    expect(controlPlaneManifest.entries.length).toBeGreaterThan(0);
    const policyReplayManifest = JSON.parse(await fs.readFile(manifests.policyReplayManifest, "utf8")) as {
      loopNames: string[];
      reducerPhases: string[];
    };
    expect(policyReplayManifest.loopNames).toContain("RenderLoop");
    expect(policyReplayManifest.reducerPhases).toContain("loop-proposals");
    const deploymentSignatureManifest = JSON.parse(await fs.readFile(manifests.deploymentSignatureManifest, "utf8")) as {
      runtimeFingerprint: string;
      signatures: { compiler: string; runtime: string; deployment: string };
    };
    expect(deploymentSignatureManifest.runtimeFingerprint).toBeTruthy();
    expect(deploymentSignatureManifest.signatures.deployment).toBeTruthy();
    const governanceAuditManifest = JSON.parse(await fs.readFile(manifests.governanceAuditManifest, "utf8")) as {
      packageContract: { publicPackage: string };
      decisions: { routeCount: number; graphNodeCount: number };
      laws: { governanceLaw: boolean };
    };
    expect(governanceAuditManifest.packageContract.publicPackage).toBe("sourceog");
    expect(governanceAuditManifest.decisions.routeCount).toBeGreaterThan(0);
    expect(governanceAuditManifest.decisions.graphNodeCount).toBeGreaterThan(0);
    expect(governanceAuditManifest.laws.governanceLaw).toBe(true);
    const releaseEvidenceIndex = JSON.parse(await fs.readFile(manifests.releaseEvidenceIndexManifest, "utf8")) as {
      signatures?: { compiler: string; runtime: string; deployment: string };
      selectedAdapter?: string;
      completeness: {
        missingForBuild: string[];
        missingForRelease: string[];
        verificationPresent: boolean;
      };
      artifacts: {
        deploymentManifest: string;
        governanceAuditManifest?: string;
      };
    };
    expect(releaseEvidenceIndex.signatures?.deployment).toBeTruthy();
    expect(releaseEvidenceIndex.selectedAdapter).toBeTruthy();
    expect(releaseEvidenceIndex.completeness.missingForBuild).toHaveLength(0);
    expect(releaseEvidenceIndex.completeness.verificationPresent).toBe(false);
    expect(releaseEvidenceIndex.completeness.missingForRelease).toContain("parityScoreboard");
    expect(releaseEvidenceIndex.completeness.missingForRelease).toContain("supportMatrix");
    expect(releaseEvidenceIndex.artifacts.deploymentManifest).toContain("deployment-manifest.json");
    expect(releaseEvidenceIndex.artifacts.governanceAuditManifest).toContain("governance-audit-manifest.json");

    const instance = await createTestInstance({
      cwd: tempDir,
      mode: "production"
    });

    try {
      const policyResponse = await instance.fetch("/_adosf/debug/policy");
      expect(policyResponse.status).toBe(200);
      const policyPayload = await policyResponse.json() as { controlPlaneRoutes: number };
      expect(policyPayload.controlPlaneRoutes).toBeGreaterThan(0);

      const graphResponse = await instance.fetch("/_adosf/debug/graph");
      expect(graphResponse.status).toBe(200);
      const graphPayload = await graphResponse.json() as { graphNodes: number };
      expect(graphPayload.graphNodes).toBeGreaterThan(0);
    } finally {
      await instance.close();
    }
  }, 90000);
});
