import { createHeuristicDecision } from "./heuristic-policy.js";
import type { AdaptiveTuner } from "./adaptive-tuner.js";
import type {
  ControlPlaneManifest,
  ControlPlaneRequestInput,
  ControlPlaneRouteInput,
  DecisionTraceEntry,
  RenderDecision,
  RenderOutcomeMetrics,
  TuningHints,
} from "../types/adosf.js";

export interface ControlPlane {
  decide(route: ControlPlaneRouteInput, request: ControlPlaneRequestInput): Promise<RenderDecision>;
  prerenderDecisions(routes: ControlPlaneRouteInput[]): Promise<Map<string, RenderDecision>>;
  reportOutcome(routeId: string, outcome: RenderOutcomeMetrics): void;
  toManifest(routes: ControlPlaneRouteInput[]): Promise<ControlPlaneManifest>;
}

export interface SafetyEnvelope {
  tighten(base: RenderDecision, hints: TuningHints | null): RenderDecision;
}

export class ConservativeSafetyEnvelope implements SafetyEnvelope {
  tighten(base: RenderDecision, hints: TuningHints | null): RenderDecision {
    if (!hints?.degradeTo) {
      return base;
    }

    const ladder = base.fallbackLadder.includes(hints.degradeTo)
      ? base.fallbackLadder
      : [...base.fallbackLadder, hints.degradeTo];

    return {
      ...base,
      fallbackLadder: ladder,
      safetyProfile: "strict",
      reason: `${base.reason}+safety-envelope`,
    };
  }
}

function applyHints(base: RenderDecision, hints: TuningHints | null): RenderDecision {
  if (!hints) {
    return base;
  }

  return {
    ...base,
    strategy: hints.preferStrategy ?? base.strategy,
    runtimeTarget: hints.runtimeTarget ?? base.runtimeTarget,
    queuePriority: hints.queuePriority ?? base.queuePriority,
    ttlSeconds: hints.cacheTTL ?? base.ttlSeconds,
    reason: hints.explainability.length > 0
      ? `${base.reason}+${hints.explainability.join("+")}`
      : base.reason,
  };
}

export class HeuristicControlPlane implements ControlPlane {
  constructor(
    private readonly tuner: AdaptiveTuner,
    private readonly safetyEnvelope: SafetyEnvelope = new ConservativeSafetyEnvelope(),
  ) {}

  async decide(route: ControlPlaneRouteInput, request: ControlPlaneRequestInput): Promise<RenderDecision> {
    const baseDecision = createHeuristicDecision({ route, request });
    const hints = this.tuner.getHints(route.id);
    const tunedDecision = this.safetyEnvelope.tighten(applyHints(baseDecision, hints), hints);

    const trace: DecisionTraceEntry = {
      routeId: route.id,
      pathname: route.pathname,
      generatedAt: new Date().toISOString(),
      baseDecision,
      tunedDecision,
      hints,
    };
    this.tuner.recordDecisionTrace(trace);
    return tunedDecision;
  }

  async prerenderDecisions(routes: ControlPlaneRouteInput[]): Promise<Map<string, RenderDecision>> {
    const entries = await Promise.all(routes.map(async (route) => {
      const decision = await this.decide(route, {
        pathname: route.pathname,
        isAuthenticated: false,
      });
      return [route.id, decision] as const;
    }));

    return new Map(entries);
  }

  reportOutcome(_routeId: string, _outcome: RenderOutcomeMetrics): void {
    // The first ADOSF slice keeps this hook side-effect free.
  }

  async toManifest(routes: ControlPlaneRouteInput[]): Promise<ControlPlaneManifest> {
    const decisions = await this.prerenderDecisions(routes);
    return {
      version: "adosf-x/1",
      generatedAt: new Date().toISOString(),
      entries: routes.map((route) => ({
        routeId: route.id,
        pathname: route.pathname,
        decision: decisions.get(route.id),
      })),
    };
  }
}
