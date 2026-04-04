import path from "node:path";
import { promises as fs } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { runDoctor } from "@sourceog/compiler";

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

describe.sequential("sourceog doctor", () => {
  it("emits a doctor report and remediation artifacts for a built app", async () => {
    const fixtureRoot = path.resolve(process.cwd(), "examples/app-basic");
    const tempRoot = path.join(process.cwd(), ".tmp-tests");
    await fs.mkdir(tempRoot, { recursive: true });
    tempDir = await fs.mkdtemp(path.join(tempRoot, "sourceog-doctor-"));
    await fs.cp(fixtureRoot, tempDir, { recursive: true, filter: shouldCopyFixture });

    const report = await runDoctor(tempDir, { area: "runtime" });

    expect(report.artifactPaths.report).toContain(path.join(".sourceog", "doctor", "doctor-report.json"));
    expect(report.artifactPaths.remediation).toContain(path.join(".sourceog", "doctor", "doctor-remediation.json"));
    expect(report.artifactPaths.releaseEvidenceIndex).toContain(path.join(".sourceog", "release-evidence-index.json"));

    const writtenReport = JSON.parse(await fs.readFile(report.artifactPaths.report, "utf8")) as {
      area: string;
      findings: unknown[];
      artifactPaths: { releaseEvidenceIndex: string };
    };
    const releaseEvidenceIndex = JSON.parse(await fs.readFile(report.artifactPaths.releaseEvidenceIndex, "utf8")) as {
      buildId: string;
      laws: { doctorLaw: boolean; governanceLaw: boolean };
      completeness: {
        missingForBuild: string[];
        doctorPresent: boolean;
      };
      artifacts: {
        doctorReport?: string;
        doctorRemediation?: string;
      };
    };

    expect(writtenReport.area).toBe("runtime");
    expect(Array.isArray(writtenReport.findings)).toBe(true);
    expect(writtenReport.artifactPaths.releaseEvidenceIndex).toBe(report.artifactPaths.releaseEvidenceIndex);
    expect(releaseEvidenceIndex.buildId).toBe(report.buildId);
    expect(releaseEvidenceIndex.laws.doctorLaw).toBe(true);
    expect(releaseEvidenceIndex.laws.governanceLaw).toBe(true);
    expect(releaseEvidenceIndex.completeness.missingForBuild).toHaveLength(0);
    expect(releaseEvidenceIndex.completeness.doctorPresent).toBe(true);
    expect(releaseEvidenceIndex.artifacts.doctorReport).toBe(report.artifactPaths.report);
    expect(releaseEvidenceIndex.artifacts.doctorRemediation).toBe(report.artifactPaths.remediation);
  }, 120_000);

  it("treats app-static as part of the examples doctor surface", async () => {
    const tempRoot = path.join(process.cwd(), ".tmp-tests");
    await fs.mkdir(tempRoot, { recursive: true });
    tempDir = await fs.mkdtemp(path.join(tempRoot, "sourceog-doctor-examples-"));

    await fs.mkdir(path.join(tempDir, "examples", "app-basic"), { recursive: true });
    await fs.mkdir(path.join(tempDir, "examples", "app-edge"), { recursive: true });
    await fs.mkdir(path.join(tempDir, "examples", "app-enterprise"), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, "pnpm-workspace.yaml"),
      ['packages:', '  - "packages/*"', '  - "examples/*"'].join("\n"),
      "utf8",
    );

    const report = await runDoctor(tempDir, { area: "examples" });
    const appStaticFinding = report.findings.find((finding) =>
      finding.message.includes("examples/app-static")
    );

    expect(appStaticFinding).toBeDefined();
    expect(appStaticFinding?.area).toBe("examples");
    expect(appStaticFinding?.severity).toBe("warn");
  });
});
