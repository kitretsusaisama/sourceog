import type { ConsistencyGraphManifest } from "@sourceog/genbook/types";

type InvalidationListener = (nodeId: string) => void;

export class ClientConsistencyGraph {
  private readonly dependents = new Map<string, Set<string>>();
  private readonly listeners = new Map<string, Set<InvalidationListener>>();

  seedFromManifest(manifest: ConsistencyGraphManifest): void {
    this.dependents.clear();
    for (const edge of manifest.edges) {
      const current = this.dependents.get(edge.to) ?? new Set<string>();
      current.add(edge.from);
      this.dependents.set(edge.to, current);
    }
  }

  dependentsOf(nodeId: string): string[] {
    return [...(this.dependents.get(nodeId) ?? new Set<string>())];
  }

  subscribe(nodeId: string, listener: InvalidationListener): () => void {
    const current = this.listeners.get(nodeId) ?? new Set<InvalidationListener>();
    current.add(listener);
    this.listeners.set(nodeId, current);
    return () => {
      current.delete(listener);
      if (current.size === 0) {
        this.listeners.delete(nodeId);
      }
    };
  }

  emit(nodeId: string): void {
    for (const listener of this.listeners.get(nodeId) ?? []) {
      listener(nodeId);
    }
  }
}
