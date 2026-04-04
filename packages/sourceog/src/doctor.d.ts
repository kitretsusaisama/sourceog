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

export declare function runDoctor(cwd: string, options?: DoctorOptions): Promise<DoctorReport>;
export declare function scanProject(cwd?: string): Promise<DoctorReport>;
export declare function scanArtifacts(cwd?: string): Promise<DoctorReport>;
export declare function scanCompatibility(cwd?: string): Promise<DoctorReport>;
export declare function scanRouteRisks(cwd?: string): Promise<DoctorReport>;
export declare function scanWorkerHealth(cwd?: string): Promise<DoctorReport>;
export declare function scanSecurityLeaks(cwd?: string): Promise<DoctorReport>;
export declare function scanPerformanceBudgets(cwd?: string): Promise<DoctorReport>;
export declare function scanDocsCoverage(cwd?: string): Promise<DoctorReport>;
export declare function generateRemediationPlan(findings: DoctorFinding[]): DoctorRemediationStep[];
export declare function exportReport(
  report: DoctorReport,
  format?: "json" | "md" | "html",
): Promise<string>;
