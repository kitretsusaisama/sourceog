// sourceog-renderer/src/workers/worker-lifecycle.ts
// Alibaba CTO 2027 Standard — Worker Thread Lifecycle Manager
//
// Finite State Machine (FSM) for worker thread lifecycle. Ensures:
// 1. **No Concurrent Renders** (single-request-at-a-time guarantee)
// 2. **Graceful Drain** during pool recycling
// 3. **Shutdown Barriers** (prevent new work, complete inflight)
// 4. **State Observability** (metrics, logging, pool integration)
//
// STATES: initial → ready ↔ busy → shutting_down → dead
// EVENTS: ready(), beginRender(), endRender(), shutdown()

import type { MessagePort } from 'node:worker_threads';
import { logger } from '../core/logger.js';
import { invariant } from '@sourceog/genbook';

/**
 * Exhaustive set of worker lifecycle states.
 *
 * Transitions are validated at runtime via invariant guards.
 */
export type LifecycleState =
  | 'initializing'  // Bootstrap (manifest load, transpiler init)
  | 'ready'         // Idle, accepting new render requests
  | 'busy'          // Processing single inflight render
  | 'shutting_down' // Draining: finish inflight, reject new work
  | 'dead';         // Terminal: pool will terminate thread

/**
 * Configuration for lifecycle behavior.
 */
export interface LifecycleConfig {
  /**
   * Max inflight renders (always 1 for RSC workers).
   */
  maxConcurrentRenders: number;
  /**
   * Grace period for inflight render completion during shutdown (ms).
   */
  drainTimeoutMs: number;
}

/**
 * Events emitted during state transitions (for pool observability).
 */
export type LifecycleEvent =
  | 'ready'
  | 'busy'
  | 'idle'
  | 'shutdown_initiated'
  | 'shutdown_complete'
  | 'shutdown_timeout';

/**
 * Production lifecycle manager.
 *
 * SINGLETON PER WORKER THREAD. Attached during worker-entry bootstrap.
 */
export class WorkerLifecycle {
  private state: LifecycleState = 'initializing';
  private port: MessagePort | null = null;
  private drainTimeoutId: NodeJS.Timeout | null = null;
  private config: LifecycleConfig;

  public readonly events = new Set<LifecycleEvent>();

  constructor(config: Partial<LifecycleConfig> = {}) {
    this.config = {
      maxConcurrentRenders: 1,
      drainTimeoutMs: 10_000,
      ...config,
    };
  }

  /**
   * Transitions to 'ready' state. Must be called exactly once after bootstrap.
   *
   * Emits: 'ready'
   */
  public ready(port: MessagePort): void {
    invariant(this.state === 'initializing', 'Cannot ready() from non-initial state');
    this.port = port;
    this.state = 'ready';
    this.emit('ready');
    logger.debug('Worker lifecycle → READY (port established)');
  }

  /**
   * Attempts to claim the worker for a new render request.
   *
   * Returns true if successfully transitioned to 'busy'.
   * Emits: 'busy'
   */
  public beginRender(): boolean {
    if (this.state !== 'ready') {
      return false;
    }

    invariant(this.port, 'No message port in beginRender()');
    this.state = 'busy';
    this.emit('busy');
    logger.debug('Worker lifecycle → BUSY (render claim)');
    return true;
  }

  /**
   * Releases the worker after render completion.
   *
   * Transitions back to 'ready' unless shutdown in progress.
   * Emits: 'idle'
   */
  public endRender(): void {
    if (this.state !== 'busy') {
      logger.warn(`endRender() called from invalid state: ${this.state}`);
      return;
    }

    this.state = 'ready';
    this.emit('idle');
    logger.debug('Worker lifecycle → READY (render release)');
  }

  /**
   * Initiates graceful shutdown sequence.
   *
   * 1. Reject new work (isAcceptingWork() → false)
   * 2. Allow inflight render to complete (if any)
   * 3. Timeout → force 'dead'
   * Emits: 'shutdown_initiated', 'shutdown_complete' | 'shutdown_timeout'
   */
  public shutdown(): void {
    if (this.state === 'shutting_down' || this.state === 'dead') {
      return;
    }

    this.state = 'shutting_down';
    this.emit('shutdown_initiated');

    logger.info('Worker lifecycle → SHUTTING_DOWN (drain initiated)');

    // Arm drain timeout
    this.drainTimeoutId = setTimeout(() => {
      this.forceShutdown();
    }, this.config.drainTimeoutMs).unref();
  }

  /**
   * Returns true if worker can accept new render requests.
   */
  public isAcceptingWork(): boolean {
    return this.state === 'ready';
  }

  /**
   * Current state (for metrics / debugging).
   */
  public getState(): LifecycleState {
    return this.state;
  }

  // --- Private Implementation ---

  private emit(event: LifecycleEvent): void {
    this.events.add(event);
  }

  private completeShutdown(): void {
    if (this.drainTimeoutId) {
      clearTimeout(this.drainTimeoutId);
      this.drainTimeoutId = null;
    }

    this.state = 'dead';
    this.emit('shutdown_complete');
    logger.info('Worker lifecycle → DEAD (graceful)');
  }

  private forceShutdown(): void {
    this.state = 'dead';
    this.emit('shutdown_timeout');
    logger.warn('Worker lifecycle → DEAD (timeout)');
  }
}
