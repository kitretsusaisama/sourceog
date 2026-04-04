import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import type {
  ReleaseEvidenceIndex,
  SupportClassification,
  SupportMatrix,
} from "@sourceog/runtime";
import { runDoctor, type DoctorReport } from "./doctor.js";
import {
  verifyApplication,
  type VerifyApplicationOptions,
  type VerifyApplicationReport,
} from "./verify.js";

export interface ReleaseApplicationOptions extends VerifyApplicationOptions {
  outputDir?: string;
  diff?: string;
  signBundle?: boolean;
}

export interface ReleaseEvidenceDiffReport {
  generatedAt: string;
  currentBuildId: string;
  baselineBuildId: string;
  completeness: {
    newlyMissing: string[];
    resolved: string[];
  };
  artifacts: {
    added: string[];
    removed: string[];
    changed: string[];
  };
  supportMatrix?: {
    stableDelta: number;
    previewDelta: number;
    internalDelta: number;
    addedEntries: string[];
    removedEntries: string[];
    statusChanges: Array<{
      id: string;
      from: SupportClassification;
      to: SupportClassification;
    }>;
  };
}

export interface ReleaseApplicationReport {
  buildId: string;
  workspaceRoot: string;
  outputDir: string;
  signed: boolean;
  verification: VerifyApplicationReport;
  doctor: DoctorReport;
  releaseEvidenceIndex: ReleaseEvidenceIndex;
  artifactPaths: {
    bundleRoot: string;
    releaseEvidenceIndex: string;
    supportMatrix?: string;
    diffReport?: string;
  };
  diff?: ReleaseEvidenceDiffReport;
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
}

async function resolveReleaseEvidenceIndexPath(target: string, cwd: string): Promise<string> {
  const absoluteTarget = path.resolve(cwd, target);
  const candidates = [
    absoluteTarget,
    path.join(absoluteTarget, "release-evidence-index.json"),
    path.join(absoluteTarget, ".sourceog", "release-evidence-index.json"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(`Could not resolve a release evidence index from "${target}".`);
}

function normalizeArtifactKeys(index: ReleaseEvidenceIndex): string[] {
  return Object.entries(index.artifacts)
    .filter(([, value]) => typeof value === "string" && value.length > 0)
    .map(([key]) => key)
    .sort();
}

async function readSupportMatrix(index: ReleaseEvidenceIndex): Promise<SupportMatrix | undefined> {
  if (!index.artifacts.supportMatrix || !existsSync(index.artifacts.supportMatrix)) {
    return undefined;
  }

  return readJson<SupportMatrix>(index.artifacts.supportMatrix);
}

async function createReleaseEvidenceDiffReport(
  current: ReleaseEvidenceIndex,
  baseline: ReleaseEvidenceIndex,
): Promise<ReleaseEvidenceDiffReport> {
  const currentArtifacts = normalizeArtifactKeys(current);
  const baselineArtifacts = normalizeArtifactKeys(baseline);
  const artifactAdded = currentArtifacts.filter((key) => !baselineArtifacts.includes(key));
  const artifactRemoved = baselineArtifacts.filter((key) => !currentArtifacts.includes(key));
  const artifactChanged = currentArtifacts.filter((key) => {
    const left = current.artifacts[key as keyof typeof current.artifacts];
    const right = baseline.artifacts[key as keyof typeof baseline.artifacts];
    return typeof left === "string" && typeof right === "string" && left !== right;
  });
  const currentMatrix = await readSupportMatrix(current);
  const baselineMatrix = await readSupportMatrix(baseline);

  const diff: ReleaseEvidenceDiffReport = {
    generatedAt: new Date().toISOString(),
    currentBuildId: current.buildId,
    baselineBuildId: baseline.buildId,
    completeness: {
      newlyMissing: current.completeness.missingForRelease.filter(
        (entry) => !baseline.completeness.missingForRelease.includes(entry),
      ),
      resolved: baseline.completeness.missingForRelease.filter(
        (entry) => !current.completeness.missingForRelease.includes(entry),
      ),
    },
    artifacts: {
      added: artifactAdded,
      removed: artifactRemoved,
      changed: artifactChanged,
    },
  };

  if (currentMatrix && baselineMatrix) {
    const currentEntries = new Map(currentMatrix.entries.map((entry) => [entry.id, entry]));
    const baselineEntries = new Map(baselineMatrix.entries.map((entry) => [entry.id, entry]));
    const currentIds = [...currentEntries.keys()].sort();
    const baselineIds = [...baselineEntries.keys()].sort();
    diff.supportMatrix = {
      stableDelta: currentMatrix.summary.stable - baselineMatrix.summary.stable,
      previewDelta: currentMatrix.summary.preview - baselineMatrix.summary.preview,
      internalDelta: currentMatrix.summary.internal - baselineMatrix.summary.internal,
      addedEntries: currentIds.filter((id) => !baselineEntries.has(id)),
      removedEntries: baselineIds.filter((id) => !currentEntries.has(id)),
      statusChanges: currentIds
        .filter((id) => baselineEntries.has(id))
        .map((id) => ({
          id,
          from: baselineEntries.get(id)?.status,
          to: currentEntries.get(id)?.status,
        }))
        .filter((change) => change.from !== change.to),
    };
  }

  return diff;
}

async function bundleReleaseEvidence(
  outputDir: string,
  releaseEvidenceIndex: ReleaseEvidenceIndex,
): Promise<ReleaseApplicationReport["artifactPaths"]> {
  await fs.mkdir(outputDir, { recursive: true });

  const bundledArtifacts: ReleaseEvidenceIndex["artifacts"] = {
    deploymentManifest: releaseEvidenceIndex.artifacts.deploymentManifest,
  };

  for (const [artifactName, artifactPath] of Object.entries(releaseEvidenceIndex.artifacts)) {
    if (typeof artifactPath !== "string" || artifactPath.length === 0 || !existsSync(artifactPath)) {
      continue;
    }

    const destinationPath = path.join(outputDir, path.basename(artifactPath));
    await fs.copyFile(artifactPath, destinationPath);
    bundledArtifacts[artifactName as keyof ReleaseEvidenceIndex["artifacts"]] = destinationPath;
  }

  const bundledIndex: ReleaseEvidenceIndex = {
    ...releaseEvidenceIndex,
    artifacts: bundledArtifacts,
  };
  const bundledIndexPath = path.join(outputDir, "release-evidence-index.json");
  await fs.writeFile(bundledIndexPath, JSON.stringify(bundledIndex, null, 2), "utf8");

  return {
    bundleRoot: outputDir,
    releaseEvidenceIndex: bundledIndexPath,
    supportMatrix: bundledArtifacts.supportMatrix,
  };
}

export async function releaseApplication(
  cwd: string,
  options: ReleaseApplicationOptions = {},
): Promise<ReleaseApplicationReport> {
  const verification = await verifyApplication(cwd, options);
  const doctor = await runDoctor(cwd, { area: "all", build: false });
  const releaseEvidenceIndex = await readJson<ReleaseEvidenceIndex>(
    doctor.artifactPaths.releaseEvidenceIndex,
  );
  const bundleRoot = path.resolve(
    cwd,
    options.outputDir ?? path.join(".sourceog", "release-evidence", verification.buildId),
  );
  const artifactPaths = await bundleReleaseEvidence(bundleRoot, releaseEvidenceIndex);

  let diff: ReleaseEvidenceDiffReport | undefined;
  if (options.diff) {
    const baselineIndexPath = await resolveReleaseEvidenceIndexPath(options.diff, cwd);
    const baseline = await readJson<ReleaseEvidenceIndex>(baselineIndexPath);
    diff = await createReleaseEvidenceDiffReport(releaseEvidenceIndex, baseline);
    artifactPaths.diffReport = path.join(bundleRoot, "release-diff.json");
    await fs.writeFile(artifactPaths.diffReport, JSON.stringify(diff, null, 2), "utf8");
  }

  return {
    buildId: verification.buildId,
    workspaceRoot: verification.workspaceRoot,
    outputDir: bundleRoot,
    signed: options.signBundle !== false,
    verification,
    doctor,
    releaseEvidenceIndex,
    artifactPaths,
    diff,
  };
}
