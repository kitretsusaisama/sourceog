import { createHash } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import type {
  ArtifactMode,
  ArtifactSignatureManifest,
  DeploymentSignatureManifest,
  DeploymentManifest,
  DoctorBaselineManifest,
  GovernanceAuditManifest,
} from "./contracts.js";
import { SOURCEOG_ERROR_CODES, SourceOGError } from "./errors.js";

export type { ArtifactMode } from "./contracts.js";

export interface ArtifactInspectionIssue {
  severity: "error" | "warn";
  message: string;
  filePath?: string;
}

export interface ArtifactInspectionReport {
  distRoot: string;
  artifactMode: ArtifactMode;
  deploymentManifestPath: string;
  buildId?: string;
  manifestNames: string[];
  issues: ArtifactInspectionIssue[];
  signatures?: ArtifactSignatureManifest["signatures"];
  baseline?: DoctorBaselineManifest;
}

let currentArtifactMode: ArtifactMode = process.env.NODE_ENV === "production" ? "strict" : "dev-compiled";

export function setArtifactMode(mode: ArtifactMode): ArtifactMode {
  currentArtifactMode = mode;
  return currentArtifactMode;
}

export function getArtifactMode(): ArtifactMode {
  return currentArtifactMode;
}

export function createRuntimeFingerprint(): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        artifactMode: currentArtifactMode,
        node: process.version,
        platform: process.platform,
        arch: process.arch,
      }),
    )
    .digest("hex")
    .slice(0, 16);
}

export function requireCapability(
  capability: "edge" | "node" | "streaming" | "actions",
  supportedCapabilities: Iterable<string> = ["node", "streaming", "actions"],
): void {
  if (![...supportedCapabilities].includes(capability)) {
    throw new SourceOGError(
      SOURCEOG_ERROR_CODES.RUNTIME_INCOMPATIBLE,
      `Required capability "${capability}" is not available in the current SourceOG runtime.`,
      {
        capability,
        supportedCapabilities: [...supportedCapabilities],
        artifactMode: currentArtifactMode,
      },
    );
  }
}

export async function inspectArtifactSet(distRoot: string): Promise<ArtifactInspectionReport> {
  const deploymentManifestPath = path.join(distRoot, "deployment-manifest.json");
  const issues: ArtifactInspectionIssue[] = [];

  if (!existsSync(deploymentManifestPath)) {
    return {
      distRoot,
      artifactMode: currentArtifactMode,
      deploymentManifestPath,
      manifestNames: [],
      issues: [
        {
          severity: "error",
          message: "Deployment manifest is missing from the artifact set.",
          filePath: deploymentManifestPath,
        },
      ],
    };
  }

  const deploymentManifest = await readJson<DeploymentManifest>(deploymentManifestPath);
  const manifestEntries = Object.entries(deploymentManifest.manifests);
  const manifestNames = manifestEntries.map(([name]) => name).sort();

  for (const [name, filePath] of manifestEntries) {
    if (!filePath) {
      issues.push({
        severity: "warn",
        message: `Manifest "${name}" is declared without a file path.`,
      });
      continue;
    }

    if (!existsSync(filePath)) {
      issues.push({
        severity: "error",
        message: `Manifest "${name}" is missing on disk.`,
        filePath,
      });
    }
  }

  let signatureManifest: ArtifactSignatureManifest | undefined;
  const signaturePath = deploymentManifest.manifests.artifactSignatureManifest;
  if (signaturePath) {
    if (!existsSync(signaturePath)) {
      issues.push({
        severity: "error",
        message: "Artifact signature manifest is missing on disk.",
        filePath: signaturePath,
      });
    } else {
      signatureManifest = await readJson<ArtifactSignatureManifest>(signaturePath);
      for (const artifact of signatureManifest.artifacts) {
        const absolutePath = path.isAbsolute(artifact.filePath)
          ? artifact.filePath
          : path.join(distRoot, artifact.filePath);
        if (!existsSync(absolutePath)) {
          issues.push({
            severity: "error",
            message: `Signed artifact "${artifact.kind}" is missing on disk.`,
            filePath: absolutePath,
          });
          continue;
        }

        const [bytes, sha256] = await Promise.all([
          fs.stat(absolutePath).then((stat) => stat.size),
          hashFile(absolutePath),
        ]);
        if (bytes !== artifact.bytes || sha256 !== artifact.sha256) {
          issues.push({
            severity: "error",
            message: `Signed artifact "${artifact.kind}" does not match its recorded integrity.`,
            filePath: absolutePath,
          });
        }
      }
    }
  } else {
    issues.push({
      severity: "warn",
      message: "Deployment manifest does not reference an artifact signature manifest.",
    });
  }

  let baseline: DoctorBaselineManifest | undefined;
  const doctorBaselinePath = deploymentManifest.manifests.doctorBaselineManifest;
  if (doctorBaselinePath) {
    if (!existsSync(doctorBaselinePath)) {
      issues.push({
        severity: "error",
        message: "Doctor baseline manifest is missing on disk.",
        filePath: doctorBaselinePath,
      });
    } else {
      baseline = await readJson<DoctorBaselineManifest>(doctorBaselinePath);
    }
  } else {
    issues.push({
      severity: "warn",
      message: "Deployment manifest does not reference a doctor baseline manifest.",
    });
  }

  const deploymentSignaturePath = deploymentManifest.manifests.deploymentSignatureManifest;
  if (deploymentSignaturePath) {
    if (!existsSync(deploymentSignaturePath)) {
      issues.push({
        severity: "error",
        message: "Deployment signature manifest is missing on disk.",
        filePath: deploymentSignaturePath,
      });
    } else if (signatureManifest) {
      const deploymentSignatureManifest = await readJson<DeploymentSignatureManifest>(deploymentSignaturePath);
      if (
        deploymentSignatureManifest.artifactSignatureManifestPath !== signaturePath ||
        deploymentSignatureManifest.deploymentManifestPath !== deploymentManifestPath
      ) {
        issues.push({
          severity: "error",
          message: "Deployment signature manifest does not point at the active deployment artifacts.",
          filePath: deploymentSignaturePath,
        });
      }
      if (
        deploymentSignatureManifest.signatures.compiler !== signatureManifest.signatures.compiler ||
        deploymentSignatureManifest.signatures.runtime !== signatureManifest.signatures.runtime ||
        deploymentSignatureManifest.signatures.deployment !== signatureManifest.signatures.deployment
      ) {
        issues.push({
          severity: "error",
          message: "Deployment signature manifest does not match the active artifact signature set.",
          filePath: deploymentSignaturePath,
        });
      }
    }
  } else {
    issues.push({
      severity: "warn",
      message: "Deployment manifest does not reference a deployment signature manifest.",
    });
  }

  const governanceAuditPath = deploymentManifest.manifests.governanceAuditManifest;
  if (governanceAuditPath) {
    if (!existsSync(governanceAuditPath)) {
      issues.push({
        severity: "error",
        message: "Governance audit manifest is missing on disk.",
        filePath: governanceAuditPath,
      });
    } else {
      const governanceAuditManifest = await readJson<GovernanceAuditManifest>(governanceAuditPath);
      if (
        !governanceAuditManifest.runtimeContract.artifactOnlyProduction ||
        !governanceAuditManifest.runtimeContract.sourceProbingDisallowed ||
        !governanceAuditManifest.runtimeContract.transpilerFallbackDisallowed ||
        !governanceAuditManifest.laws.doctorLaw ||
        !governanceAuditManifest.laws.replayLaw ||
        !governanceAuditManifest.laws.policyLaw ||
        !governanceAuditManifest.laws.runtimeLaw ||
        !governanceAuditManifest.laws.governanceLaw
      ) {
        issues.push({
          severity: "error",
          message: "Governance audit manifest reports a violated ADOSF product law.",
          filePath: governanceAuditPath,
        });
      }
    }
  } else {
    issues.push({
      severity: "warn",
      message: "Deployment manifest does not reference a governance audit manifest.",
    });
  }

  return {
    distRoot,
    artifactMode: currentArtifactMode,
    deploymentManifestPath,
    buildId: deploymentManifest.buildId,
    manifestNames,
    issues,
    signatures: signatureManifest?.signatures,
    baseline,
  };
}

export async function verifyArtifactIntegrity(distRoot: string): Promise<ArtifactInspectionReport> {
  const report = await inspectArtifactSet(distRoot);
  const blockingIssues = report.issues.filter((issue) => issue.severity === "error");
  if (blockingIssues.length > 0) {
    throw new SourceOGError(
      SOURCEOG_ERROR_CODES.MANIFEST_INVALID,
      "Artifact integrity verification failed for the current SourceOG dist directory.",
      {
        distRoot,
        blockingIssues,
      },
    );
  }
  return report;
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
}

async function hashFile(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath);
  return createHash("sha256").update(content).digest("hex");
}
