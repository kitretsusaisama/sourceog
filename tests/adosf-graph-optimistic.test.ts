import { describe, expect, it } from "vitest";
import { ConsistencyGraph } from "@sourceog/genbook/graph";
import { DeterministicOptimisticEngine } from "@sourceog/genbook/optimistic";

describe("ADOSF graph and optimistic engine", () => {
  it("propagates invalidation through component and route dependents", () => {
    const graph = new ConsistencyGraph();
    graph.trackDep("data:posts", "cmp:PostList", "route:/posts");
    graph.trackDep("data:posts", "cmp:PostList", "route:/home");

    const result = graph.invalidate("data:posts");

    expect(result.affected).toContain("cmp:PostList");
    expect(result.serverRoutes).toContain("route:/posts");
    expect(result.serverRoutes).toContain("route:/home");
    expect(result.clientNodes).toContain("cmp:PostList");
  });

  it("applies, resolves, and rolls back optimistic state changes", () => {
    const graph = new ConsistencyGraph();
    let state = {
      likes: 1
    };
    const engine = new DeterministicOptimisticEngine({
      read: () => state,
      write: (nextState) => {
        state = nextState;
      },
      graph
    });

    engine.apply({
      id: "like-1",
      resourceId: "data:post:1",
      apply: (current) => ({ likes: current.likes + 1 }),
      reconcile: (_current, payload) => ({ likes: (payload as { likes: number }).likes }),
      rollback: (current) => ({ likes: current.likes - 1 })
    });

    expect(state.likes).toBe(2);
    expect(engine.getPendingCount()).toBe(1);

    engine.resolve("like-1", { likes: 3 });
    expect(state.likes).toBe(3);

    engine.apply({
      id: "like-2",
      resourceId: "data:post:1",
      apply: (current) => ({ likes: current.likes + 1 }),
      rollback: (current) => ({ likes: current.likes - 1 })
    });
    expect(state.likes).toBe(4);

    engine.rollback("like-2", new Error("conflict"));
    expect(state.likes).toBe(3);
  });
});
