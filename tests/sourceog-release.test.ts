import path from "node:path";
import { promises as fs } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { releaseApplication } from "@sourceog/compiler";

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

describe.sequential("sourceog release", () => {
  it("bundles a self-contained release evidence package", async () => {
    const fixtureRoot = path.resolve(process.cwd(), "examples/app-basic");
    const tempRoot = path.join(process.cwd(), ".tmp-tests");
    await fs.mkdir(tempRoot, { recursive: true });
    tempDir = await fs.mkdtemp(path.join(tempRoot, "sourceog-release-"));
    await fs.cp(fixtureRoot, tempDir, { recursive: true, filter: shouldCopyFixture });

    const report = await releaseApplication(tempDir, {
      outputDir: path.join("release-evidence", "v-test"),
      runTypecheck: false,
      runTests: false,
      signBundle: true,
    });

    expect(report.artifactPaths.bundleRoot).toContain(path.join("release-evidence", "v-test"));
    expect(report.artifactPaths.releaseEvidenceIndex).toContain("release-evidence-index.json");
    expect(report.artifactPaths.supportMatrix).toContain("support-matrix.json");

    const bundledIndex = JSON.parse(
      await fs.readFile(report.artifactPaths.releaseEvidenceIndex, "utf8"),
    ) as {
      artifacts: {
        supportMatrix?: string;
        parityScoreboard?: string;
        milestoneDashboard?: string;
      };
      completeness: {
        doctorPresent: boolean;
        verificationPresent: boolean;
        supportMatrixPresent: boolean;
      };
    };

    expect(bundledIndex.completeness.doctorPresent).toBe(true);
    expect(bundledIndex.completeness.verificationPresent).toBe(true);
    expect(bundledIndex.completeness.supportMatrixPresent).toBe(true);
    expect(bundledIndex.artifacts.supportMatrix).toContain(path.join("release-evidence", "v-test"));
    expect(bundledIndex.artifacts.parityScoreboard).toContain(path.join("release-evidence", "v-test"));
    expect(bundledIndex.artifacts.milestoneDashboard).toContain(path.join("release-evidence", "v-test"));
  }, 90_000);
});
