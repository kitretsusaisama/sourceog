export { type PolicyLoopInspection, type PolicyLoopName, type PolicyMeshSnapshot, type PolicyObjective, type PolicyMeshController, createPolicyMeshController, exportDecisionReplay, replayDecisionSnapshot } from "./policies.js";

export interface ExecutionPlan {
  buildId?: string;
  routeId?: string;
  pathname?: string;
  requestId?: string;
  runtime: "node" | "edge" | "auto";
  artifactMode: "strict" | "dev-compiled" | "test-harness";
  decisionWindow: number;
  capabilities: string[];
  reasons: string[];
}

export interface DecisionTrace {
  generatedAt: string;
  plan: ExecutionPlan;
  reducerPhases: string[];
  overrides: string[];
  confidence: number;
}

export declare class ExecutionPlanReducer {}
