export interface GraphNode {
  id: string;
  type: "data" | "component" | "route" | "optimistic";
  deps: string[];
  dependents: string[];
  lastInvalidated?: number;
  quarantined?: boolean;
}

export interface GraphEdge {
  from: string;
  to: string;
}

export interface ConsistencyGraphManifest {
  version: string;
  generatedAt: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface InvalidationResult {
  affected: string[];
  serverRoutes: string[];
  clientNodes: string[];
  cacheKeys: string[];
  propagationMs: number;
}

export interface OptimisticAction<TState> {
  id: string;
  resourceId: string;
  apply(state: TState): TState;
  reconcile?(optimisticState: TState, serverPayload: unknown): TState;
  rollback?(optimisticState: TState, error: unknown): TState;
}

export interface PatchLogEntry {
  actionId: string;
  resourceId: string;
  appliedAt: number;
  status: "pending" | "resolved" | "rolled-back" | "conflict";
}

export declare class ClientConsistencyGraph {
  seedFromManifest(manifest: ConsistencyGraphManifest): void;
  dependentsOf(nodeId: string): string[];
  subscribe(nodeId: string, listener: (nodeId: string) => void): () => void;
  emit(nodeId: string): void;
}

export declare class ConsistencyGraph {
  seedFromManifest(manifest: ConsistencyGraphManifest): void;
  link(fromId: string, toId: string): void;
  invalidate(nodeId: string): InvalidationResult;
  dependentsOf(nodeId: string, maxDepth?: number): GraphNode[];
  size(): number;
  toJSON(): ConsistencyGraphManifest;
  fromJSON(manifest: ConsistencyGraphManifest): void;
}

export declare class MemoryGraphStore {
  read(): Promise<ConsistencyGraphManifest | null>;
  write(manifest: ConsistencyGraphManifest): Promise<void>;
}

export declare class DeterministicOptimisticEngine<TState> {
  constructor(options: {
    read(): TState;
    write(nextState: TState): void;
    graph?: ConsistencyGraph;
  });
  apply(action: OptimisticAction<TState>): void;
  resolve(id: string, serverPayload: unknown): void;
  rollback(id: string, error: unknown): void;
  getPendingCount(): number;
  getLog(): PatchLogEntry[];
}
