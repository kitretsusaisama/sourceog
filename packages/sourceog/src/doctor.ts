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

async function loadDoctorModule() {
  return import("@sourceog/compiler");
}

export async function runDoctor(cwd: string, options?: DoctorOptions): Promise<DoctorReport> {
  const mod = await loadDoctorModule();
  return mod.runDoctor(cwd, options) as Promise<DoctorReport>;
}

export async function scanProject(cwd: string = process.cwd()): Promise<DoctorReport> {
  const mod = await loadDoctorModule();
  return mod.scanProject(cwd) as Promise<DoctorReport>;
}

export async function scanArtifacts(cwd: string = process.cwd()): Promise<DoctorReport> {
  const mod = await loadDoctorModule();
  return mod.scanArtifacts(cwd) as Promise<DoctorReport>;
}

export async function scanCompatibility(cwd: string = process.cwd()): Promise<DoctorReport> {
  const mod = await loadDoctorModule();
  return mod.scanCompatibility(cwd) as Promise<DoctorReport>;
}

export async function scanRouteRisks(cwd: string = process.cwd()): Promise<DoctorReport> {
  const mod = await loadDoctorModule();
  return mod.scanRouteRisks(cwd) as Promise<DoctorReport>;
}

export async function scanWorkerHealth(cwd: string = process.cwd()): Promise<DoctorReport> {
  const mod = await loadDoctorModule();
  return mod.scanWorkerHealth(cwd) as Promise<DoctorReport>;
}

export async function scanSecurityLeaks(cwd: string = process.cwd()): Promise<DoctorReport> {
  const mod = await loadDoctorModule();
  return mod.scanSecurityLeaks(cwd) as Promise<DoctorReport>;
}

export async function scanPerformanceBudgets(cwd: string = process.cwd()): Promise<DoctorReport> {
  const mod = await loadDoctorModule();
  return mod.scanPerformanceBudgets(cwd) as Promise<DoctorReport>;
}

export async function scanDocsCoverage(cwd: string = process.cwd()): Promise<DoctorReport> {
  const mod = await loadDoctorModule();
  return mod.scanDocsCoverage(cwd) as Promise<DoctorReport>;
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
  const mod = await loadDoctorModule();
  return mod.exportReport(report, format) as Promise<string>;
}
