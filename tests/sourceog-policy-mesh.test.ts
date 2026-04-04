import { describe, expect, it } from "vitest";
import {
  createPolicyMeshController,
  exportDecisionReplay,
  replayDecisionSnapshot,
} from "sourceog/policies";
import { ClientConsistencyGraph, ConsistencyGraph, DeterministicOptimisticEngine } from "sourceog/graph";

describe("sourceog policy mesh public surface", () => {
  it("exports and replays controller snapshots", async () => {
    const controller = createPolicyMeshController({ objective: "latency" });
    controller.setCooldown("RenderLoop", 15);
    controller.setHysteresis("CacheLoop", 10);
    controller.setWindow("auth-sensitive", 120);

    controller.observe({
      routeId: "page:/account",
      p50LatencyMs: 42,
      p95LatencyMs: 640,
      p99LatencyMs: 900,
      cacheHitRate: 0.2,
      errorRate: 0,
      queueDepth: 12,
      cpuUsage: 0.4,
      memUsageMb: 192,
      workerRecycles: 0,
    });

    const { decision, trace } = await controller.decide(
      {
        id: "page:/account",
        pathname: "/account",
        kind: "page",
        capabilities: ["dynamic-only"],
      },
      {
        pathname: "/account",
        isAuthenticated: true,
      },
    );

    expect(decision.strategy).toBe("cache");
    expect(trace.reducerPhases).toContain("loop-proposals");

    const snapshot = exportDecisionReplay(controller);
    expect(snapshot.loops.find((loop) => loop.loop === "RenderLoop")?.cooldownSeconds).toBe(15);
    expect(snapshot.windows["auth-sensitive"]).toBe(120);

    const replayController = createPolicyMeshController();
    await replayDecisionSnapshot(replayController, snapshot);
    expect(replayController.inspectLoop("CacheLoop").hysteresisPercent).toBe(10);
  });

  it("exposes graph and optimistic primitives through the public package", () => {
    const runtimeGraph = new ClientConsistencyGraph();
    runtimeGraph.seedFromManifest({
      version: "adosf-x/1",
      generatedAt: new Date().toISOString(),
      nodes: [],
      edges: [{ from: "route:/account", to: "data:profile" }],
    });
    expect(runtimeGraph.dependentsOf("data:profile")).toEqual(["route:/account"]);

    const graph = new ConsistencyGraph();
    graph.link("route:/account", "data:profile");
    expect(graph.invalidate("data:profile").serverRoutes).toContain("route:/account");

    let state = { count: 0 };
    const engine = new DeterministicOptimisticEngine({
      read: () => state,
      write: (next) => {
        state = next;
      },
      graph,
    });
    engine.apply({
      id: "inc-1",
      resourceId: "data:profile",
      apply(current) {
        return { count: current.count + 1 };
      },
    });
    expect(state.count).toBe(1);
    expect(engine.getPendingCount()).toBe(1);
  });
});
