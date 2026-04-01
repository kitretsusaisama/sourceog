/**
 * Unit tests for Phase 9: Fast Refresh Kernel
 * Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6
 *
 * Tests:
 * - Root layout change triggers full page reload (Req 11.4)
 * - Boundary refresh failure triggers full page reload + [SOURCEOG-FALLBACK] log (Req 11.6)
 * - State preserved for components outside changed boundary (Req 11.3)
 * - detectMinimalBoundary finds smallest enclosing component boundary (Req 11.1)
 * - snapshotRefreshBoundary captures fiber state before refresh (Req 11.5)
 * - restoreRefreshBoundaryState restores state to matching instances (Req 11.5)
 * - applyBoundaryRefresh orchestrates the full fast refresh flow (Req 11.2)
 */

import { describe, it, expect, vi } from "vitest";
import {
  detectMinimalBoundary,
  snapshotRefreshBoundary,
  restoreRefreshBoundaryState,
  applyBoundaryRefresh,
  type ModuleGraphNode,
  type RefreshBoundary,
} from "@sourceog/dev";
import { getClientRuntimeScript } from "@sourceog/dev";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGraph(nodes: ModuleGraphNode[]): Map<string, ModuleGraphNode> {
  const map = new Map<string, ModuleGraphNode>();
  for (const node of nodes) {
    map.set(node.moduleId, node);
  }
  return map;
}

function makeFiberRegistry(
  entries: Array<{ moduleId: string; instanceIds: string[]; componentType: unknown; stateMap?: Map<string, unknown> }>
) {
  const map = new Map<string, { instanceIds: string[]; componentType: unknown; stateMap: Map<string, unknown> }>();
  for (const e of entries) {
    map.set(e.moduleId, {
      instanceIds: e.instanceIds,
      componentType: e.componentType,
      stateMap: e.stateMap ?? new Map()
    });
  }
  return map;
}

// ---------------------------------------------------------------------------
// detectMinimalBoundary
// ---------------------------------------------------------------------------

describe("detectMinimalBoundary (Req 11.1)", () => {
  it("returns requiresFullReload: true when changed file is the root layout", () => {
    const graph = makeGraph([
      { moduleId: "app/layout.tsx", isComponentBoundary: true, isRootLayout: true, importedBy: [] }
    ]);

    const result = detectMinimalBoundary("app/layout.tsx", graph);

    expect(result.requiresFullReload).toBe(true);
  });

  it("returns requiresFullReload: true when changed file is not in the graph", () => {
    const graph = makeGraph([]);

    const result = detectMinimalBoundary("unknown/file.tsx", graph);

    expect(result.requiresFullReload).toBe(true);
  });

  it("returns the changed file as boundary when it is itself a component boundary", () => {
    const graph = makeGraph([
      { moduleId: "components/Button.tsx", isComponentBoundary: true, isRootLayout: false, importedBy: [] }
    ]);

    const result = detectMinimalBoundary("components/Button.tsx", graph);

    expect(result.requiresFullReload).toBe(false);
    expect(result.boundaryId).toBe("components/Button.tsx");
  });

  it("walks importedBy edges to find the nearest enclosing boundary", () => {
    // utils.ts → Card.tsx (boundary) → page.tsx
    const graph = makeGraph([
      { moduleId: "utils/format.ts", isComponentBoundary: false, isRootLayout: false, importedBy: ["components/Card.tsx"] },
      { moduleId: "components/Card.tsx", isComponentBoundary: true, isRootLayout: false, importedBy: ["app/page.tsx"] },
      { moduleId: "app/page.tsx", isComponentBoundary: true, isRootLayout: false, importedBy: [] }
    ]);

    const result = detectMinimalBoundary("utils/format.ts", graph);

    // Should stop at Card.tsx — the smallest enclosing boundary
    expect(result.requiresFullReload).toBe(false);
    expect(result.boundaryId).toBe("components/Card.tsx");
  });

  it("returns requiresFullReload: true when BFS reaches a root layout node", () => {
    const graph = makeGraph([
      { moduleId: "utils/theme.ts", isComponentBoundary: false, isRootLayout: false, importedBy: ["app/layout.tsx"] },
      { moduleId: "app/layout.tsx", isComponentBoundary: true, isRootLayout: true, importedBy: [] }
    ]);

    const result = detectMinimalBoundary("utils/theme.ts", graph);

    expect(result.requiresFullReload).toBe(true);
  });

  it("returns requiresFullReload: true when no boundary is found in the graph", () => {
    const graph = makeGraph([
      { moduleId: "utils/helper.ts", isComponentBoundary: false, isRootLayout: false, importedBy: [] }
    ]);

    const result = detectMinimalBoundary("utils/helper.ts", graph);

    expect(result.requiresFullReload).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// snapshotRefreshBoundary (Req 11.5)
// ---------------------------------------------------------------------------

describe("snapshotRefreshBoundary (Req 11.5)", () => {
  it("returns null when boundary is not in the fiber registry", () => {
    const registry = makeFiberRegistry([]);

    const snapshot = snapshotRefreshBoundary("components/Missing.tsx", registry);

    expect(snapshot).toBeNull();
  });

  it("captures instanceIds and preservedState from the fiber registry", () => {
    const stateMap = new Map([["inst-1", { count: 5 }], ["inst-2", { count: 10 }]]);
    const registry = makeFiberRegistry([
      {
        moduleId: "components/Counter.tsx",
        instanceIds: ["inst-1", "inst-2"],
        componentType: function Counter() {},
        stateMap
      }
    ]);

    const snapshot = snapshotRefreshBoundary("components/Counter.tsx", registry);

    expect(snapshot).not.toBeNull();
    expect(snapshot!.moduleId).toBe("components/Counter.tsx");
    expect(snapshot!.instanceIds).toEqual(["inst-1", "inst-2"]);
    expect(snapshot!.preservedState.get("inst-1")).toEqual({ count: 5 });
    expect(snapshot!.preservedState.get("inst-2")).toEqual({ count: 10 });
  });

  it("snapshot is a copy — mutations to registry do not affect snapshot", () => {
    const stateMap = new Map([["inst-1", { count: 0 }]]);
    const registry = makeFiberRegistry([
      { moduleId: "components/A.tsx", instanceIds: ["inst-1"], componentType: {}, stateMap }
    ]);

    const snapshot = snapshotRefreshBoundary("components/A.tsx", registry);

    // Mutate the registry after snapshot
    registry.get("components/A.tsx")!.stateMap.set("inst-1", { count: 99 });

    // Snapshot must be unaffected
    expect(snapshot!.preservedState.get("inst-1")).toEqual({ count: 0 });
  });
});

// ---------------------------------------------------------------------------
// restoreRefreshBoundaryState (Req 11.3, 11.5)
// ---------------------------------------------------------------------------

describe("restoreRefreshBoundaryState (Req 11.3, 11.5)", () => {
  it("restores preserved state to matching instances", () => {
    const stateMap = new Map<string, unknown>();
    const registry = makeFiberRegistry([
      { moduleId: "components/Counter.tsx", instanceIds: ["inst-1"], componentType: {}, stateMap }
    ]);

    const boundary: RefreshBoundary = {
      moduleId: "components/Counter.tsx",
      componentType: {},
      instanceIds: ["inst-1"],
      preservedState: new Map([["inst-1", { count: 42 }]])
    };

    const newComponentType = function CounterV2() {};
    restoreRefreshBoundaryState(boundary, newComponentType, registry);

    const entry = registry.get("components/Counter.tsx")!;
    expect(entry.componentType).toBe(newComponentType);
    expect(entry.stateMap.get("inst-1")).toEqual({ count: 42 });
  });

  it("does nothing when boundary is not in the fiber registry", () => {
    const registry = makeFiberRegistry([]);

    // Should not throw
    expect(() => {
      restoreRefreshBoundaryState(
        { moduleId: "missing.tsx", componentType: {}, instanceIds: [], preservedState: new Map() },
        {},
        registry
      );
    }).not.toThrow();
  });

  it("only restores state for instances in the boundary — not all instances", () => {
    const stateMap = new Map<string, unknown>([
      ["inst-outside", { value: "original" }]
    ]);
    const registry = makeFiberRegistry([
      { moduleId: "components/Widget.tsx", instanceIds: ["inst-1", "inst-outside"], componentType: {}, stateMap }
    ]);

    const boundary: RefreshBoundary = {
      moduleId: "components/Widget.tsx",
      componentType: {},
      instanceIds: ["inst-1"],  // only inst-1 was in the boundary
      preservedState: new Map([["inst-1", { value: "restored" }]])
    };

    restoreRefreshBoundaryState(boundary, {}, registry);

    const entry = registry.get("components/Widget.tsx")!;
    // inst-1 gets restored
    expect(entry.stateMap.get("inst-1")).toEqual({ value: "restored" });
    // inst-outside is untouched (Req 11.3)
    expect(entry.stateMap.get("inst-outside")).toEqual({ value: "original" });
  });
});

// ---------------------------------------------------------------------------
// applyBoundaryRefresh — full fast refresh flow (Req 11.2, 11.4, 11.6)
// ---------------------------------------------------------------------------

describe("applyBoundaryRefresh (Req 11.2, 11.4, 11.6)", () => {
  // Req 11.4: Root layout change triggers full page reload
  it("triggers full page reload when changed file is the root layout", async () => {
    const graph = makeGraph([
      { moduleId: "app/layout.tsx", isComponentBoundary: true, isRootLayout: true, importedBy: [] }
    ]);
    const registry = makeFiberRegistry([]);
    const triggerFullReload = vi.fn();
    const logFallback = vi.fn();
    const renderBoundary = vi.fn();
    const applyFlight = vi.fn();

    await applyBoundaryRefresh({
      changedFile: "app/layout.tsx",
      moduleGraph: graph,
      fiberRegistry: registry,
      renderBoundary,
      applyFlight,
      triggerFullReload,
      logFallback
    });

    expect(triggerFullReload).toHaveBeenCalledOnce();
    expect(renderBoundary).not.toHaveBeenCalled();
    expect(applyFlight).not.toHaveBeenCalled();
  });

  // Req 11.2: Boundary refresh renders only the affected boundary via RSC_Worker_Pool
  it("renders and applies only the affected boundary on success", async () => {
    const graph = makeGraph([
      { moduleId: "components/Card.tsx", isComponentBoundary: true, isRootLayout: false, importedBy: [] }
    ]);
    const registry = makeFiberRegistry([
      { moduleId: "components/Card.tsx", instanceIds: ["inst-1"], componentType: {}, stateMap: new Map() }
    ]);

    const fakeStream = new ReadableStream();
    const renderBoundary = vi.fn().mockResolvedValue(fakeStream);
    const applyFlight = vi.fn().mockResolvedValue(undefined);
    const triggerFullReload = vi.fn();
    const logFallback = vi.fn();

    await applyBoundaryRefresh({
      changedFile: "components/Card.tsx",
      moduleGraph: graph,
      fiberRegistry: registry,
      renderBoundary,
      applyFlight,
      triggerFullReload,
      logFallback
    });

    expect(renderBoundary).toHaveBeenCalledWith("components/Card.tsx");
    expect(applyFlight).toHaveBeenCalledWith("components/Card.tsx", fakeStream);
    expect(triggerFullReload).not.toHaveBeenCalled();
    expect(logFallback).not.toHaveBeenCalled();
  });

  // Req 11.6: Boundary refresh failure triggers full page reload + [SOURCEOG-FALLBACK] log
  it("logs [SOURCEOG-FALLBACK] and triggers full page reload on render failure", async () => {
    const graph = makeGraph([
      { moduleId: "components/Broken.tsx", isComponentBoundary: true, isRootLayout: false, importedBy: [] }
    ]);
    const registry = makeFiberRegistry([]);
    const renderError = new Error("RSC render failed");
    const renderBoundary = vi.fn().mockRejectedValue(renderError);
    const applyFlight = vi.fn();
    const triggerFullReload = vi.fn();
    const logFallback = vi.fn();

    await applyBoundaryRefresh({
      changedFile: "components/Broken.tsx",
      moduleGraph: graph,
      fiberRegistry: registry,
      renderBoundary,
      applyFlight,
      triggerFullReload,
      logFallback
    });

    // [SOURCEOG-FALLBACK] must be logged (Req 11.6)
    expect(logFallback).toHaveBeenCalledWith(renderError);
    // Full page reload must follow (Req 11.6)
    expect(triggerFullReload).toHaveBeenCalledOnce();
  });

  it("logs [SOURCEOG-FALLBACK] and triggers full page reload on applyFlight failure", async () => {
    const graph = makeGraph([
      { moduleId: "components/Widget.tsx", isComponentBoundary: true, isRootLayout: false, importedBy: [] }
    ]);
    const registry = makeFiberRegistry([]);
    const applyError = new Error("Flight apply failed");
    const renderBoundary = vi.fn().mockResolvedValue(new ReadableStream());
    const applyFlight = vi.fn().mockRejectedValue(applyError);
    const triggerFullReload = vi.fn();
    const logFallback = vi.fn();

    await applyBoundaryRefresh({
      changedFile: "components/Widget.tsx",
      moduleGraph: graph,
      fiberRegistry: registry,
      renderBoundary,
      applyFlight,
      triggerFullReload,
      logFallback
    });

    expect(logFallback).toHaveBeenCalledWith(applyError);
    expect(triggerFullReload).toHaveBeenCalledOnce();
  });

  // Req 11.3: Components outside changed boundary must not be re-rendered
  it("does not call renderBoundary for modules outside the changed boundary", async () => {
    // utils.ts → Card.tsx (boundary) — only Card.tsx should be rendered
    const graph = makeGraph([
      { moduleId: "utils/format.ts", isComponentBoundary: false, isRootLayout: false, importedBy: ["components/Card.tsx"] },
      { moduleId: "components/Card.tsx", isComponentBoundary: true, isRootLayout: false, importedBy: [] }
    ]);
    const registry = makeFiberRegistry([
      { moduleId: "components/Card.tsx", instanceIds: [], componentType: {}, stateMap: new Map() }
    ]);

    const renderBoundary = vi.fn().mockResolvedValue(new ReadableStream());
    const applyFlight = vi.fn().mockResolvedValue(undefined);
    const triggerFullReload = vi.fn();
    const logFallback = vi.fn();

    await applyBoundaryRefresh({
      changedFile: "utils/format.ts",
      moduleGraph: graph,
      fiberRegistry: registry,
      renderBoundary,
      applyFlight,
      triggerFullReload,
      logFallback
    });

    // Only the boundary (Card.tsx) is rendered — not utils/format.ts or any other module
    expect(renderBoundary).toHaveBeenCalledOnce();
    expect(renderBoundary).toHaveBeenCalledWith("components/Card.tsx");
  });
});

// ---------------------------------------------------------------------------
// Client runtime script: fast refresh WebSocket handler (Req 11.1, 11.6)
// ---------------------------------------------------------------------------

describe("client runtime script fast refresh (Req 11.1, 11.6)", () => {
  it("handles boundaryId + flightHref in sync payload for boundary refresh", () => {
    const script = getClientRuntimeScript();

    // Must check for boundaryId and flightHref in the sync payload
    expect(script).toContain("payload.boundaryId");
    expect(script).toContain("payload.flightHref");
  });

  it("emits [SOURCEOG-FALLBACK] log before reload on boundary refresh failure", () => {
    const script = getClientRuntimeScript();

    // The catch block in the boundary refresh path must log [SOURCEOG-FALLBACK]
    expect(script).toContain("[SOURCEOG-FALLBACK]");
    // And then reload
    expect(script).toContain("location.reload()");
  });

  it("fetches boundary Flight with Accept: text/x-component header", () => {
    const script = getClientRuntimeScript();

    // The boundary refresh fetch must include the correct Accept header
    expect(script).toContain('"Accept": "text/x-component"');
  });

  it("falls back to full page reload when boundary fetch fails (not ok)", () => {
    const script = getClientRuntimeScript();

    // When streamResponse is not ok, must reload
    expect(script).toContain("if (!streamResponse.ok)");
    expect(script).toContain("location.reload()");
  });
});
