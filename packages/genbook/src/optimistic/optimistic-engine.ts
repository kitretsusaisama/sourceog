import type { ConsistencyGraph } from "../graph/consistency-graph.js";
import type { OptimisticAction, PatchLogEntry } from "../types/adosf.js";
import { PatchLog } from "./patch-log.js";

export interface OptimisticEngineOptions<TState> {
  read(): TState;
  write(nextState: TState): void;
  graph?: ConsistencyGraph;
}

export class DeterministicOptimisticEngine<TState> {
  private readonly patchLog = new PatchLog();
  private readonly snapshots = new Map<string, TState>();
  private readonly actions = new Map<string, OptimisticAction<TState>>();

  constructor(private readonly options: OptimisticEngineOptions<TState>) {}

  apply(action: OptimisticAction<TState>): void {
    const currentState = this.options.read();
    this.snapshots.set(action.id, currentState);
    this.actions.set(action.id, action);
    this.options.write(action.apply(currentState));
    this.patchLog.append({
      actionId: action.id,
      resourceId: action.resourceId,
      appliedAt: Date.now(),
      status: "pending",
    });
  }

  resolve(id: string, serverPayload: unknown): void {
    const action = this.actions.get(id);
    if (!action) {
      return;
    }

    const optimisticState = this.options.read();
    const nextState = action.reconcile
      ? action.reconcile(optimisticState, serverPayload)
      : optimisticState;
    this.options.write(nextState);
    this.patchLog.mark(id, "resolved");
    if (action.resourceId) {
      this.options.graph?.invalidate(action.resourceId);
    }
  }

  rollback(id: string, error: unknown): void {
    const action = this.actions.get(id);
    const snapshot = this.snapshots.get(id);
    if (!action || snapshot === undefined) {
      return;
    }

    const optimisticState = this.options.read();
    const nextState = action.rollback
      ? action.rollback(optimisticState, error)
      : snapshot;
    this.options.write(nextState);
    this.patchLog.mark(id, "rolled-back");
  }

  getPendingCount(): number {
    return this.patchLog.pendingCount();
  }

  getLog(): PatchLogEntry[] {
    return this.patchLog.list();
  }
}
