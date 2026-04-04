import {
  promises as fs,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ConservativeSafetyEnvelope,
  HeuristicControlPlane,
  RuleBasedAdaptiveTuner,
  type ControlPlaneRequestInput,
  type ControlPlaneRouteInput,
  type RenderDecision,
  type RouteMetrics,
  type SafetyEnvelope,
  type TunerSnapshotManifest,
} from "@sourceog/genbook";
import type { ExecutionPlan, DecisionTrace, ArtifactMode } from "./contracts.js";
import { getArtifactMode } from "./artifacts.js";

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
  artifactMode: ArtifactMode;
  objective: PolicyObjective;
  loops: PolicyLoopInspection[];
  windows: Record<string, number>;
  tuner: TunerSnapshotManifest;
}

export interface PolicyMeshOptions {
  objective?: PolicyObjective;
  safetyEnvelope?: SafetyEnvelope;
}

const LOOP_NAMES: PolicyLoopName[] = [
  "RenderLoop",
  "CacheLoop",
  "WorkerLoop",
  "GraphLoop",
  "AssetLoop",
  "IncidentLoop",
  "PrefetchLoop",
  "HydrationLoop",
  "SecurityLoop",
  "CanaryLoop",
  "CostLoop",
  "RegionalLoop",
  "BudgetLoop",
  "ErrorLoop",
];

export class ExecutionPlanReducer {
  reduce(input: {
    buildId?: string;
    route: ControlPlaneRouteInput;
    request: ControlPlaneRequestInput;
    decision: RenderDecision;
    artifactMode?: ArtifactMode;
    loopReasons?: string[];
    overrides?: string[];
  }): DecisionTrace {
    const artifactMode = input.artifactMode ?? getArtifactMode();
    const reasons = [
      `compatibility:${input.route.capabilities?.length ? "constrained" : "default"}`,
      `runtime:${input.decision.runtimeTarget}`,
      `strategy:${input.decision.strategy}`,
      ...input.decision.reason.split("+").filter(Boolean),
      ...(input.loopReasons ?? []),
    ];

    const plan: ExecutionPlan = {
      buildId: input.buildId,
      routeId: input.route.id,
      pathname: input.request.pathname ?? input.route.pathname,
      runtime: input.decision.runtimeTarget,
      artifactMode,
      decisionWindow: Math.floor(Date.now() / 60_000),
      capabilities: [...(input.route.capabilities ?? [])].sort(),
      reasons,
    };

    return {
      generatedAt: new Date().toISOString(),
      plan,
      reducerPhases: [
        "compatibility-constraints",
        "static-route-policy",
        "runtime-capability-constraints",
        "loop-proposals",
        "safety-envelope",
        "emergency-override",
      ],
      overrides: [...(input.overrides ?? [])],
      confidence: input.decision.safetyProfile === "strict" ? 0.92 : 0.85,
    };
  }
}

export class PolicyMeshController {
  private readonly tuner = new RuleBasedAdaptiveTuner();
  private readonly reducer = new ExecutionPlanReducer();
  private readonly loops = new Map<PolicyLoopName, PolicyLoopInspection>();
  private readonly windows = new Map<string, number>();
  private objective: PolicyObjective;
  private safetyEnvelope: SafetyEnvelope;
  private readonly replayHistory: PolicyMeshSnapshot[] = [];

  public constructor(options: PolicyMeshOptions = {}) {
    this.objective = options.objective ?? "latency";
    this.safetyEnvelope = options.safetyEnvelope ?? new ConservativeSafetyEnvelope();
    for (const loop of LOOP_NAMES) {
      this.loops.set(loop, {
        loop,
        frozen: false,
        cooldownSeconds: 0,
        hysteresisPercent: 0,
      });
    }
  }

  observe(metrics: RouteMetrics): void {
    this.tuner.observe(metrics);
  }

  setWindow(routeClass: string, seconds: number): void {
    this.windows.set(routeClass, Math.max(1, seconds));
  }

  setCooldown(loop: PolicyLoopName, seconds: number): void {
    this.updateLoop(loop, { cooldownSeconds: Math.max(0, seconds) });
  }

  setHysteresis(loop: PolicyLoopName, percent: number): void {
    this.updateLoop(loop, { hysteresisPercent: Math.max(0, percent) });
  }

  freeze(target: PolicyLoopName | string): void {
    if (this.loops.has(target as PolicyLoopName)) {
      this.updateLoop(target as PolicyLoopName, { frozen: true });
      return;
    }
    this.windows.set(target, this.windows.get(target) ?? 60);
  }

  rollback(target: PolicyLoopName | string): void {
    if (this.loops.has(target as PolicyLoopName)) {
      this.updateLoop(target as PolicyLoopName, {
        frozen: false,
        cooldownSeconds: 0,
        hysteresisPercent: 0,
      });
      return;
    }
    this.windows.delete(target);
  }

  inspectLoop(loop: PolicyLoopName): PolicyLoopInspection {
    return { ...(this.loops.get(loop) ?? this.createDefaultLoop(loop)) };
  }

  setObjective(objective: PolicyObjective): void {
    this.objective = objective;
  }

  attachSafetyEnvelope(envelope: SafetyEnvelope): void {
    this.safetyEnvelope = envelope;
  }

  async decide(
    route: ControlPlaneRouteInput,
    request: ControlPlaneRequestInput,
  ): Promise<{ decision: RenderDecision; trace: DecisionTrace }> {
    const controlPlane = new HeuristicControlPlane(this.tuner, this.safetyEnvelope);
    const decision = await controlPlane.decide(route, request);
    const trace = this.reducer.reduce({
      route,
      request,
      decision,
      loopReasons: [`objective:${this.objective}`],
    });
    return { decision, trace };
  }

  async prerenderDecisions(routes: ControlPlaneRouteInput[]): Promise<Map<string, RenderDecision>> {
    const controlPlane = new HeuristicControlPlane(this.tuner, this.safetyEnvelope);
    return controlPlane.prerenderDecisions(routes);
  }

  exportSnapshot(): PolicyMeshSnapshot {
    const snapshot: PolicyMeshSnapshot = {
      generatedAt: new Date().toISOString(),
      artifactMode: getArtifactMode(),
      objective: this.objective,
      loops: LOOP_NAMES.map((loop) => this.inspectLoop(loop)),
      windows: Object.fromEntries(this.windows.entries()),
      tuner: this.tuner.toManifest(),
    };
    this.replayHistory.push(snapshot);
    if (this.replayHistory.length > 20) {
      this.replayHistory.shift();
    }
    return snapshot;
  }

  async replay(snapshot: PolicyMeshSnapshot): Promise<void> {
    this.objective = snapshot.objective;
    this.windows.clear();
    for (const [routeClass, seconds] of Object.entries(snapshot.windows)) {
      this.windows.set(routeClass, seconds);
    }
    this.loops.clear();
    for (const loop of snapshot.loops) {
      this.loops.set(loop.loop, { ...loop });
    }
    await this.hydrateTuner(snapshot.tuner);
  }

  getReplayHistory(): PolicyMeshSnapshot[] {
    return [...this.replayHistory];
  }

  private updateLoop(loop: PolicyLoopName, next: Partial<PolicyLoopInspection>): void {
    const current = this.loops.get(loop) ?? this.createDefaultLoop(loop);
    this.loops.set(loop, {
      ...current,
      ...next,
      updatedAt: new Date().toISOString(),
    });
  }

  private createDefaultLoop(loop: PolicyLoopName): PolicyLoopInspection {
    return {
      loop,
      frozen: false,
      cooldownSeconds: 0,
      hysteresisPercent: 0,
    };
  }

  private async hydrateTuner(snapshot: TunerSnapshotManifest): Promise<void> {
    const snapshotPath = path.join(
      os.tmpdir(),
      `sourceog-policy-replay-${process.pid}-${Date.now()}.json`,
    );
    await fs.writeFile(snapshotPath, JSON.stringify(snapshot, null, 2), "utf8");
    try {
      await this.tuner.loadSnapshot(snapshotPath);
    } finally {
      await fs.rm(snapshotPath, { force: true });
    }
  }
}

export function createPolicyMeshController(options?: PolicyMeshOptions): PolicyMeshController {
  return new PolicyMeshController(options);
}

export function exportDecisionReplay(controller: PolicyMeshController): PolicyMeshSnapshot {
  return controller.exportSnapshot();
}

export async function replayDecisionSnapshot(
  controller: PolicyMeshController,
  snapshot: PolicyMeshSnapshot,
): Promise<void> {
  await controller.replay(snapshot);
}
