import path from "node:path";
import { promises as fs } from "node:fs";
import { describe, expect, it } from "vitest";
import { auditSourceogPublishReadiness } from "@sourceog/compiler";

describe("sourceog publish readiness", () => {
  it("passes the package governance and public publish audit", async () => {
    const report = await auditSourceogPublishReadiness(process.cwd());

    expect(report.passed).toBe(true);
    expect(report.findings).toEqual([]);

    const findings = JSON.parse(await fs.readFile(report.artifactPaths.auditFindings, "utf8")) as {
      findings: unknown[];
    };
    const governance = JSON.parse(await fs.readFile(report.artifactPaths.packageGovernance, "utf8")) as {
      findings: unknown[];
    };
    const readiness = JSON.parse(await fs.readFile(report.artifactPaths.publishReadiness, "utf8")) as {
      passed: boolean;
    };

    expect(findings.findings).toEqual([]);
    expect(governance.findings).toEqual([]);
    expect(readiness.passed).toBe(true);
  });

  it("points sourceog at dist-first public artifacts", async () => {
    const manifest = JSON.parse(
      await fs.readFile(path.join(process.cwd(), "packages", "sourceog", "package.json"), "utf8")
    ) as {
      main: string;
      types: string;
      bin: Record<string, string>;
      exports: Record<string, unknown>;
      dependencies: Record<string, string>;
    };

    expect(manifest.main).toBe("./dist/index.js");
    expect(manifest.types).toBe("./dist/index.d.ts");
    expect(manifest.bin.sourceog).toBe("./dist/bin.js");
    expect(JSON.stringify(manifest.exports)).not.toContain("/src/");
    expect(Object.values(manifest.dependencies).some((value) => value.startsWith("workspace:"))).toBe(false);
  });
});
