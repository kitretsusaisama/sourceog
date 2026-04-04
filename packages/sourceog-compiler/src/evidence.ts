import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  ArtifactSignatureManifest,
  DeploymentSignatureManifest,
  DoctorBaselineManifest,
  GovernanceAuditManifest,
  PolicyReplayManifest,
  ReleaseEvidenceIndex,
} from "@sourceog/runtime";

export interface ReleaseEvidenceArtifactPaths {
  deploymentManifest: string;
  artifactSignatureManifest?: string;
  deploymentSignatureManifest?: string;
  doctorBaselineManifest?: string;
  governanceAuditManifest?: string;
  policyReplayManifest?: string;
  doctorReport?: string;
  doctorRemediation?: string;
  parityScoreboard?: string;
  milestoneDashboard?: string;
  supportMatrix?: string;
  benchmarkReport?: string;
  publishReadiness?: string;
  auditFindings?: string;
  packageGovernance?: string;
}

export interface ReleaseEvidenceIndexInput {
  buildId: string;
  governanceAuditManifest: GovernanceAuditManifest;
  artifactSignatureManifest?: ArtifactSignatureManifest;
  deploymentSignatureManifest?: DeploymentSignatureManifest;
  doctorBaselineManifest?: DoctorBaselineManifest;
  policyReplayManifest?: PolicyReplayManifest;
  artifactPaths: ReleaseEvidenceArtifactPaths;
}

const REQUIRED_BUILD_ARTIFACTS: Array<keyof ReleaseEvidenceArtifactPaths> = [
  "deploymentManifest",
  "artifactSignatureManifest",
  "deploymentSignatureManifest",
  "doctorBaselineManifest",
  "governanceAuditManifest",
  "policyReplayManifest",
];

const REQUIRED_RELEASE_ARTIFACTS: Array<keyof ReleaseEvidenceArtifactPaths> = [
  ...REQUIRED_BUILD_ARTIFACTS,
  "doctorReport",
  "doctorRemediation",
  "parityScoreboard",
  "milestoneDashboard",
  "supportMatrix",
];

export function createReleaseEvidenceIndex(
  input: ReleaseEvidenceIndexInput,
): ReleaseEvidenceIndex {
  const present = Object.entries(input.artifactPaths)
    .filter(([, value]) => typeof value === "string" && value.length > 0)
    .map(([key]) => key)
    .sort();

  const missingForBuild = REQUIRED_BUILD_ARTIFACTS.filter((key) => !input.artifactPaths[key]);
  const missingForRelease = REQUIRED_RELEASE_ARTIFACTS.filter((key) => !input.artifactPaths[key]);

  return {
    version: input.governanceAuditManifest.version,
    buildId: input.buildId,
    generatedAt: new Date().toISOString(),
    packageContract: input.governanceAuditManifest.packageContract,
    runtimeContract: input.governanceAuditManifest.runtimeContract,
    laws: input.governanceAuditManifest.laws,
    decisionCounts: input.governanceAuditManifest.decisions,
    selectedAdapter: input.deploymentSignatureManifest?.selectedAdapter,
    runtimeFingerprint: input.deploymentSignatureManifest?.runtimeFingerprint,
    signatures: input.artifactSignatureManifest?.signatures,
    artifacts: input.artifactPaths,
    completeness: {
      requiredForBuild: REQUIRED_BUILD_ARTIFACTS,
      requiredForRelease: REQUIRED_RELEASE_ARTIFACTS,
      present,
      missingForBuild,
      missingForRelease,
      doctorPresent: Boolean(input.artifactPaths.doctorReport && input.artifactPaths.doctorRemediation),
      verificationPresent: Boolean(input.artifactPaths.parityScoreboard && input.artifactPaths.milestoneDashboard),
      supportMatrixPresent: Boolean(input.artifactPaths.supportMatrix),
      benchmarkProofPresent: Boolean(input.artifactPaths.benchmarkReport),
      publishReadinessPresent: Boolean(
        input.artifactPaths.publishReadiness &&
        input.artifactPaths.auditFindings &&
        input.artifactPaths.packageGovernance,
      ),
    },
  };
}

export async function writeReleaseEvidenceIndex(
  filePath: string,
  input: ReleaseEvidenceIndexInput,
): Promise<ReleaseEvidenceIndex> {
  const payload = createReleaseEvidenceIndex(input);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
  return payload;
}
