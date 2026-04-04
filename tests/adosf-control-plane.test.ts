import { describe, expect, it } from "vitest";
import { HeuristicControlPlane, RuleBasedAdaptiveTuner } from "@sourceog/genbook/policy";

describe("ADOSF control plane", () => {
  it("prefers streaming for authenticated traffic", async () => {
    const controlPlane = new HeuristicControlPlane(new RuleBasedAdaptiveTuner());

    const decision = await controlPlane.decide(
      {
        id: "page:/account",
        pathname: "/account",
        kind: "page",
        capabilities: ["dynamic-only"]
      },
      {
        pathname: "/account",
        isAuthenticated: true
      }
    );

    expect(decision.strategy).toBe("stream");
    expect(decision.runtimeTarget).toBe("node");
    expect(decision.queuePriority).toBe("critical");
    expect(decision.invalidationMode).toBe("graph");
  });

  it("applies tuner hints to prerender decisions", async () => {
    const tuner = new RuleBasedAdaptiveTuner();
    tuner.observe({
      routeId: "page:/",
      p50LatencyMs: 50,
      p95LatencyMs: 600,
      p99LatencyMs: 800,
      cacheHitRate: 0.2,
      errorRate: 0,
      queueDepth: 5,
      cpuUsage: 0.5,
      memUsageMb: 128,
      workerRecycles: 0
    });
    const controlPlane = new HeuristicControlPlane(tuner);

    const decisions = await controlPlane.prerenderDecisions([
      { id: "page:/", pathname: "/", kind: "page", capabilities: [] }
    ]);

    const decision = decisions.get("page:/");
    expect(decision).toBeDefined();
    expect(decision?.ttlSeconds).toBe(300);
    expect(decision?.strategy).toBe("cache");
  });
});
