export interface DoctorInspectionSummary {
  reportPath?: string;
  passed: boolean;
  summary: {
    errors: number;
    warnings: number;
    infos: number;
  };
  findingsByArea: Record<string, number>;
}

export interface PolicyDiagnostics {
  objective?: string;
  reducerPhases: string[];
  loopNames: string[];
  decisionTraceCount: number;
  changedDecisionFields: string[];
  tuningHintCount: number;
  explainabilityHints: string[];
}

export interface DecisionExplanationReport {
  selector: string;
  buildId: string;
  routeId: string;
  pathname: string;
  summary: string;
  reducerPhases: string[];
  loopNames: string[];
  reasons: string[];
  doctor?: {
    summary: DoctorInspectionSummary;
    findings: Array<Record<string, unknown>>;
  };
  policyDiagnostics: PolicyDiagnostics;
  decision: {
    strategy: string;
    runtimeTarget: string;
    queuePriority: string;
    ttlSeconds: number | null;
    routeClass?: string;
    trafficSegment?: string;
    safetyProfile?: string;
    cachePosture?: string;
    hydrationPosture?: string;
    invalidationMode?: string;
    fallbackLadder?: string[];
  };
  tuningHints?: Record<string, unknown> | null;
}

export declare function explainRoute(cwd: string | undefined, selector: string): Promise<DecisionExplanationReport>;
export declare function explainDecision(cwd: string | undefined, selector: string): Promise<DecisionExplanationReport>;
