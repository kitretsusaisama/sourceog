import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import {
  inspectArtifactSet,
  type ArtifactInspectionReport,
  type ReleaseEvidenceIndex,
} from "@sourceog/runtime";
import { auditSourceogPublishReadiness, type PublishReadinessReport, verifyBuildOutput } from "./verify.js";
import { buildApplication, type BuildResult } from "./build.js";
import { writeReleaseEvidenceIndex } from "./evidence.js";

export type DoctorArea =
  | "all"
  | "runtime"
  | "compile"
  | "render"
  | "stream"
  | "worker"
  | "graph"
  | "cache"
  | "migration"
  | "package"
  | "deployment"
  | "security"
  | "docs"
  | "examples"
  | "benchmark"
  | "canary";

export interface DoctorFinding {
  id: string;
  area: DoctorArea;
  severity: "error" | "warn" | "info";
  message: string;
  remediation?: string;
  filePath?: string;
}

export interface DoctorRemediationStep {
  priority: "high" | "medium" | "low";
  findingId: string;
  action: string;
}

export interface DoctorReport {
  version: string;
  generatedAt: string;
  cwd: string;
  area: DoctorArea;
  passed: boolean;
  buildId?: string;
  findings: DoctorFinding[];
  remediation: DoctorRemediationStep[];
  summary: {
    errors: number;
    warnings: number;
    infos: number;
  };
  artifactPaths: {
    report: string;
    remediation: string;
    releaseEvidenceIndex: string;
  };
}

export interface DoctorOptions {
  area?: DoctorArea;
  build?: boolean;
}

export async function scanProject(cwd: string = process.cwd()): Promise<DoctorReport> {
  return runDoctor(cwd, { area: "all" });
}

export async function scanArtifacts(cwd: string = process.cwd()): Promise<DoctorReport> {
  return runDoctor(cwd, { area: "runtime" });
}

export async function scanCompatibility(cwd: string = process.cwd()): Promise<DoctorReport> {
  return runDoctor(cwd, { area: "migration" });
}

export async function scanRouteRisks(cwd: string = process.cwd()): Promise<DoctorReport> {
  return runDoctor(cwd, { area: "graph" });
}

export async function scanWorkerHealth(cwd: string = process.cwd()): Promise<DoctorReport> {
  return runDoctor(cwd, { area: "worker" });
}

export async function scanSecurityLeaks(cwd: string = process.cwd()): Promise<DoctorReport> {
  return runDoctor(cwd, { area: "security" });
}

export async function scanPerformanceBudgets(cwd: string = process.cwd()): Promise<DoctorReport> {
  return runDoctor(cwd, { area: "benchmark" });
}

export async function scanDocsCoverage(cwd: string = process.cwd()): Promise<DoctorReport> {
  return runDoctor(cwd, { area: "docs", build: false });
}

export function generateRemediationPlan(findings: DoctorFinding[]): DoctorRemediationStep[] {
  return findings
    .filter((finding) => finding.severity !== "info")
    .map((finding) => ({
      priority: finding.severity === "error" ? "high" : "medium",
      findingId: finding.id,
      action: finding.remediation ?? finding.message,
    }));
}

export async function exportReport(
  report: DoctorReport,
  format: "json" | "md" | "html" = "json",
): Promise<string> {
  if (format === "json") {
    return JSON.stringify(report, null, 2);
  }

  if (format === "html") {
    return [
      "<!DOCTYPE html>",
      "<html><body>",
      `<h1>SourceOG doctor report (${report.area})</h1>`,
      `<p>Passed: ${report.passed}</p>`,
      "<ul>",
      ...report.findings.map((finding) => `<li><strong>${finding.severity}</strong> ${escapeHtml(finding.message)}</li>`),
      "</ul>",
      "</body></html>",
    ].join("");
  }

  return [
    `# SourceOG doctor report (${report.area})`,
    "",
    `Passed: ${report.passed ? "yes" : "no"}`,
    "",
    ...report.findings.map((finding) => `- [${finding.severity}] ${finding.message}`),
  ].join("\n");
}

async function loadExistingBuildResult(cwd: string): Promise<BuildResult | undefined> {
  const distRoot = path.join(cwd, ".sourceog");
  const manifestPath = path.join(distRoot, "deployment-manifest.json");
  if (!existsSync(manifestPath)) {
    return undefined;
  }

  const deploymentManifest = JSON.parse(
    await fs.readFile(manifestPath, "utf8"),
  ) as BuildResult["deploymentManifest"];

  return {
    buildId: deploymentManifest.buildId,
    distRoot,
    manifestPath,
    deploymentManifest,
    prerendered: [],
    budgetReport: {
      passed: true,
      violations: [],
    },
    manifestPaths: deploymentManifest.manifests,
  };
}

export async function runDoctor(cwd: string, options: DoctorOptions = {}): Promise<DoctorReport> {
  const area = options.area ?? "all";
  const findings: DoctorFinding[] = [];
  const shouldBuild = options.build ?? (area !== "docs" && area !== "examples" && area !== "package");
  const workspaceRoot = findWorkspaceRoot(cwd);

  let buildResult: BuildResult | undefined;
  let artifactReport: ArtifactInspectionReport | undefined;
  let publishReadiness: PublishReadinessReport | undefined;
  let verifiedBuild: Awaited<ReturnType<typeof verifyBuildOutput>> | undefined;

  if (shouldBuild) {
    try {
      buildResult = await buildApplication(cwd);
      verifiedBuild = await verifyBuildOutput(buildResult);
      artifactReport = await inspectArtifactSet(buildResult.distRoot);
      findings.push(
        ...artifactReport.issues.map((issue, index) => ({
          id: `artifact-${index + 1}`,
          area: "runtime" as const,
          severity: issue.severity,
          message: issue.message,
          remediation: "Rebuild the app and verify that every declared manifest is present and signed.",
          filePath: issue.filePath,
        })),
      );
    } catch (error) {
      findings.push({
        id: "runtime-build-failed",
        area: area === "all" ? "runtime" : area,
        severity: "error",
        message: error instanceof Error ? error.message : String(error),
        remediation: "Fix the production build or manifest integrity failure before relying on doctor output.",
      });
    }
  } else {
    try {
      buildResult = await loadExistingBuildResult(cwd);
      if (buildResult) {
        verifiedBuild = await verifyBuildOutput(buildResult);
        artifactReport = await inspectArtifactSet(buildResult.distRoot);
        findings.push(
          ...artifactReport.issues.map((issue, index) => ({
            id: `artifact-${index + 1}`,
            area: "runtime" as const,
            severity: issue.severity,
            message: issue.message,
            remediation: "Rebuild the app and verify that every declared manifest is present and signed.",
            filePath: issue.filePath,
          })),
        );
      }
    } catch (error) {
      findings.push({
        id: "runtime-existing-build-invalid",
        area: area === "all" ? "runtime" : area,
        severity: "error",
        message: error instanceof Error ? error.message : String(error),
        remediation: "Regenerate the existing artifact set before running doctor without a rebuild.",
      });
    }
  }

  if ((area === "all" || area === "deployment" || area === "runtime") && verifiedBuild?.governanceAuditManifest) {
    const governanceAudit = verifiedBuild.governanceAuditManifest;
    if (governanceAudit.packageContract.publicPackage !== "sourceog") {
      findings.push({
        id: "governance-public-package-mismatch",
        area: "deployment",
        severity: "error",
        message: "Governance audit reports a public package other than sourceog.",
        remediation: "Regenerate build artifacts and ensure the public package contract stays locked to sourceog.",
        filePath: verifiedBuild.deploymentManifest.manifests.governanceAuditManifest,
      });
    }

    for (const [lawName, enabled] of Object.entries(governanceAudit.laws)) {
      if (!enabled) {
        findings.push({
          id: `governance-law-${lawName}`,
          area: "deployment",
          severity: "error",
          message: `Governance audit reports ${lawName} as violated.`,
          remediation: "Rebuild and verify the signed governance artifacts before release.",
          filePath: verifiedBuild.deploymentManifest.manifests.governanceAuditManifest,
        });
      }
    }
  }

  if (area === "all" || area === "package") {
    publishReadiness = await auditSourceogPublishReadiness(workspaceRoot);
    findings.push(
      ...publishReadiness.findings.map((finding, index) => ({
        id: `package-${index + 1}`,
        area: "package" as const,
        severity: finding.severity,
        message: finding.message,
        remediation: "Resolve the publish-readiness finding so the public package remains dist-first and self-contained.",
        filePath: finding.file,
      })),
    );
  }

  if (area === "all" || area === "docs") {
    for (const requiredDoc of [
      "docs/getting-started.md",
      "docs/config-reference.md",
      "docs/sourceog-vs-nextjs.md",
      "docs/sourceog-prompt-guide.md",
    ]) {
      const candidatePath = path.join(workspaceRoot, requiredDoc);
      if (existsSync(path.join(cwd, requiredDoc)) || existsSync(candidatePath)) {
        continue;
      }

      findings.push({
        id: `docs-${requiredDoc}`,
        area: "docs",
        severity: "warn",
        message: `Expected documentation file is missing: ${requiredDoc}`,
        remediation: "Add the missing documentation page so stable public features stay documented.",
        filePath: candidatePath,
      });
    }
  }

  if (area === "all" || area === "examples") {
    for (const exampleDir of ["examples/app-basic", "examples/app-edge", "examples/app-enterprise", "examples/app-static"]) {
      const candidatePath = path.join(workspaceRoot, exampleDir);
      if (!existsSync(candidatePath)) {
        findings.push({
          id: `examples-${exampleDir}`,
          area: "examples",
          severity: "warn",
          message: `Expected external-consumer example is missing: ${exampleDir}`,
          remediation: "Keep the starter/example family present so doctor can validate external-consumer flows.",
          filePath: candidatePath,
        });
      }
    }
  }

  if (area === "all" || area === "migration") {
    const nextConfigCandidates = [
      "next.config.js",
      "next.config.mjs",
      "next.config.ts",
    ].map((fileName) => path.join(cwd, fileName));
    if (nextConfigCandidates.some((candidate) => existsSync(candidate))) {
      findings.push({
        id: "migration-next-config-detected",
        area: "migration",
        severity: "info",
        message: "Next.js config detected; a codemod-based migration path is relevant for this workspace.",
        remediation: "Run `sourceog migrate next-app` once the codemod flow is available for the app.",
      });
    }
  }

  if (area === "all" || area === "benchmark") {
    const benchmarkReportPath = buildResult
      ? path.join(buildResult.distRoot, "benchmark-report.json")
      : path.join(cwd, ".sourceog", "benchmark-report.json");
    if (!existsSync(benchmarkReportPath)) {
      findings.push({
        id: "benchmark-report-missing",
        area: "benchmark",
        severity: "warn",
        message: "No benchmark report artifact was found for the current build output.",
        remediation: "Add benchmark artifact generation before making competitive claims.",
        filePath: benchmarkReportPath,
      });
    }
  }

  if ((area === "all" || area === "security") && !existsSync(path.join(workspaceRoot, "docs", "security.md"))) {
    findings.push({
      id: "security-docs-missing",
      area: "security",
      severity: "info",
      message: "Security documentation is not present yet for the public framework surface.",
      remediation: "Add stable security docs before claiming the security surface is production-ready.",
      filePath: path.join(workspaceRoot, "docs", "security.md"),
    });
  }

  const remediation = generateRemediationPlan(findings);
  const reportRoot = buildResult?.distRoot ?? path.join(cwd, ".sourceog");
  const doctorDir = path.join(reportRoot, "doctor");
  await fs.mkdir(doctorDir, { recursive: true });
  const releaseEvidenceIndexPath =
    verifiedBuild?.deploymentManifest.manifests.releaseEvidenceIndexManifest
    ?? path.join(reportRoot, "release-evidence-index.json");

  const report: DoctorReport = {
    version: "2027.1",
    generatedAt: new Date().toISOString(),
    cwd,
    area,
    passed: findings.every((finding) => finding.severity !== "error"),
    buildId: buildResult?.buildId ?? artifactReport?.buildId,
    findings,
    remediation,
    summary: {
      errors: findings.filter((finding) => finding.severity === "error").length,
      warnings: findings.filter((finding) => finding.severity === "warn").length,
      infos: findings.filter((finding) => finding.severity === "info").length,
    },
    artifactPaths: {
      report: path.join(doctorDir, "doctor-report.json"),
      remediation: path.join(doctorDir, "doctor-remediation.json"),
      releaseEvidenceIndex: releaseEvidenceIndexPath,
    },
  };

  await fs.writeFile(report.artifactPaths.report, JSON.stringify(report, null, 2), "utf8");
  await fs.writeFile(report.artifactPaths.remediation, JSON.stringify(remediation, null, 2), "utf8");

  let releaseEvidenceIndex: ReleaseEvidenceIndex | undefined;
  if (verifiedBuild?.governanceAuditManifest) {
    const benchmarkReportPath = path.join(reportRoot, "benchmark-report.json");
    const existingReleaseEvidenceIndex = existsSync(report.artifactPaths.releaseEvidenceIndex)
      ? JSON.parse(
        await fs.readFile(report.artifactPaths.releaseEvidenceIndex, "utf8"),
      ) as ReleaseEvidenceIndex
      : undefined;
    releaseEvidenceIndex = await writeReleaseEvidenceIndex(report.artifactPaths.releaseEvidenceIndex, {
      buildId: verifiedBuild.deploymentManifest.buildId,
      governanceAuditManifest: verifiedBuild.governanceAuditManifest,
      artifactSignatureManifest: verifiedBuild.artifactSignatureManifest,
      deploymentSignatureManifest: verifiedBuild.deploymentSignatureManifest,
      doctorBaselineManifest: verifiedBuild.doctorBaselineManifest,
      policyReplayManifest: verifiedBuild.policyReplayManifest,
      artifactPaths: {
        deploymentManifest: path.join(reportRoot, "deployment-manifest.json"),
        artifactSignatureManifest: verifiedBuild.deploymentManifest.manifests.artifactSignatureManifest,
        deploymentSignatureManifest: verifiedBuild.deploymentManifest.manifests.deploymentSignatureManifest,
        doctorBaselineManifest: verifiedBuild.deploymentManifest.manifests.doctorBaselineManifest,
        governanceAuditManifest: verifiedBuild.deploymentManifest.manifests.governanceAuditManifest,
        policyReplayManifest: verifiedBuild.deploymentManifest.manifests.policyReplayManifest,
        doctorReport: report.artifactPaths.report,
        doctorRemediation: report.artifactPaths.remediation,
        parityScoreboard: existingReleaseEvidenceIndex?.artifacts.parityScoreboard,
        milestoneDashboard: existingReleaseEvidenceIndex?.artifacts.milestoneDashboard,
        supportMatrix: existsSync(path.join(reportRoot, "support-matrix.json"))
          ? path.join(reportRoot, "support-matrix.json")
          : existingReleaseEvidenceIndex?.artifacts.supportMatrix,
        benchmarkReport: existsSync(benchmarkReportPath)
          ? benchmarkReportPath
          : existingReleaseEvidenceIndex?.artifacts.benchmarkReport,
        publishReadiness: publishReadiness?.artifactPaths.publishReadiness
          ?? existingReleaseEvidenceIndex?.artifacts.publishReadiness,
        auditFindings: publishReadiness?.artifactPaths.auditFindings
          ?? existingReleaseEvidenceIndex?.artifacts.auditFindings,
        packageGovernance: publishReadiness?.artifactPaths.packageGovernance
          ?? existingReleaseEvidenceIndex?.artifacts.packageGovernance,
      },
    });
  }

  if ((area === "all" || area === "deployment" || area === "benchmark" || area === "package") && releaseEvidenceIndex) {
    for (const missingArtifact of releaseEvidenceIndex.completeness.missingForRelease) {
      const severity: DoctorFinding["severity"] = missingArtifact === "benchmarkReport" ? "warn" : "info";
      findings.push({
        id: `release-evidence-missing-${missingArtifact}`,
        area: missingArtifact === "benchmarkReport" ? "benchmark" : "deployment",
        severity,
        message: `Release evidence index is missing ${missingArtifact}.`,
        remediation: missingArtifact === "benchmarkReport"
          ? "Generate benchmark artifacts before making competitive or stable-release claims."
          : "Run the full verification and doctor pipeline so the release evidence bundle is complete.",
        filePath: report.artifactPaths.releaseEvidenceIndex,
      });
    }
  }

  report.passed = findings.every((finding) => finding.severity !== "error");
  report.findings = findings;
  report.remediation = generateRemediationPlan(findings);
  report.summary = {
    errors: findings.filter((finding) => finding.severity === "error").length,
    warnings: findings.filter((finding) => finding.severity === "warn").length,
    infos: findings.filter((finding) => finding.severity === "info").length,
  };
  await fs.writeFile(report.artifactPaths.report, JSON.stringify(report, null, 2), "utf8");
  await fs.writeFile(report.artifactPaths.remediation, JSON.stringify(report.remediation, null, 2), "utf8");

  return report;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function findWorkspaceRoot(start: string): string {
  let current = path.resolve(start);
  while (true) {
    if (existsSync(path.join(current, "pnpm-workspace.yaml")) || existsSync(path.join(current, ".git"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return start;
    }
    current = parent;
  }
}
