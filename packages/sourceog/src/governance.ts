export interface GovernanceInspectionReport {
  cwd: string;
  distRoot: string;
  buildId: string;
  selectedAdapter?: string;
  runtimeFingerprint?: string;
  signatures?: {
    compiler: string;
    runtime: string;
    deployment: string;
  };
  packageContract: {
    publicPackage: "sourceog";
    internalPackagesRemainPrivate: true;
  };
  runtimeContract: {
    artifactOnlyProduction: true;
    sourceProbingDisallowed: true;
    transpilerFallbackDisallowed: true;
  };
  laws: {
    doctorLaw: true;
    replayLaw: true;
    policyLaw: true;
    runtimeLaw: true;
    governanceLaw: true;
  };
  decisionCounts: {
    routeCount: number;
    prerenderedRouteCount: number;
    cacheEntryCount: number;
    invalidationLinkCount: number;
    graphNodeCount: number;
    graphRouteCount: number;
    ownershipEntryCount: number;
    actionCount: number;
  };
  artifactPaths: {
    routeOwnershipManifest: string;
    cacheManifest: string;
    routeGraphManifest: string;
    artifactSignatureManifest: string;
    deploymentSignatureManifest: string;
    doctorBaselineManifest: string;
    policyReplayManifest?: string;
    deploymentManifest: string;
  };
  signatureAlignment: {
    compiler: boolean;
    runtime: boolean;
    deployment: boolean;
  };
}

async function loadGovernanceModule() {
  return import("@sourceog/compiler");
}

export async function inspectGovernance(
  cwd: string = process.cwd(),
): Promise<GovernanceInspectionReport> {
  const mod = await loadGovernanceModule();
  return mod.inspectGovernance(cwd) as Promise<GovernanceInspectionReport>;
}
