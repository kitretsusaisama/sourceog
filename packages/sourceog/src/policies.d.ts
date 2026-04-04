export type PolicyLoopName =
  | "RenderLoop"
  | "CacheLoop"
  | "WorkerLoop"
  | "GraphLoop"
  | "AssetLoop"
  | "IncidentLoop"
  | "PrefetchLoop"
  | "HydrationLoop"
  | "SecurityLoop"
  | "CanaryLoop"
  | "CostLoop"
  | "RegionalLoop"
  | "BudgetLoop"
  | "ErrorLoop";

export type PolicyObjective = "latency" | "throughput" | "cost" | "stability";

export interface PolicyLoopInspection {
  loop: PolicyLoopName;
  frozen: boolean;
  cooldownSeconds: number;
  hysteresisPercent: number;
  updatedAt?: string;
}

export interface PolicyMeshSnapshot {
  generatedAt: string;
  artifactMode: "strict" | "dev-compiled" | "test-harness";
  objective: PolicyObjective;
  loops: PolicyLoopInspection[];
  windows: Record<string, number>;
  tuner: {
    version: string;
    generatedAt: string;
    routeHints: Record<string, unknown>;
    decisionTraces: unknown[];
  };
}

export interface PolicyMeshController {
  observe(metrics: unknown): void;
  setWindow(routeClass: string, seconds: number): void;
  setCooldown(loop: PolicyLoopName, seconds: number): void;
  setHysteresis(loop: PolicyLoopName, percent: number): void;
  freeze(target: PolicyLoopName | string): void;
  rollback(target: PolicyLoopName | string): void;
  inspectLoop(loop: PolicyLoopName): PolicyLoopInspection;
  setObjective(objective: PolicyObjective): void;
  exportSnapshot(): PolicyMeshSnapshot;
  replay(snapshot: PolicyMeshSnapshot): Promise<void>;
}

export declare class ExecutionPlanReducer {}
export declare class HeuristicControlPlane {}
export declare class RuleBasedAdaptiveTuner {}
export declare class ConservativeSafetyEnvelope {}

export declare function createPolicyMeshController(options?: {
  objective?: PolicyObjective;
}): PolicyMeshController;
export declare function exportDecisionReplay(controller: PolicyMeshController): PolicyMeshSnapshot;
export declare function replayDecisionSnapshot(controller: PolicyMeshController, snapshot: PolicyMeshSnapshot): Promise<void>;
