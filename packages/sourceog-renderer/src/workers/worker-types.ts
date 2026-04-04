// sourceog-renderer/src/workers/worker-types.ts
// Alibaba CTO 2027 Standard — Worker Pool Type System
//
// Comprehensive type definitions for the worker pool subsystem. Provides:
// 1. **PooledWorker** lifecycle contract (health, capacity, metrics)
// 2. **Spawn Configuration** (Node.js worker_threads exec options)
// 3. **Health Status** (composite observability snapshot)
// 4. **Pool Statistics** (capacity planning, load metrics)
// 5. **Request Tracking** (inflight + historical render state)
//
// TYPE SAFETY: Exhaustive unions, branded types, discriminated unions.

import type { Worker } from 'node:worker_threads';
import type { RouteDefinition } from '@sourceog/router';
import type { SourceOGRequestContext } from '@sourceog/runtime';
import type { HealthCheckResult } from './worker-health.js';
import type { LifecycleState } from './worker-lifecycle.js';
import type {
  WorkerRenderRequest,
} from '../types/messages.js';
import type { WorkerRenderResponse } from '../types/internal.js';

/**
 * Branded type for worker identifiers (prevents confusion with threadId).
 */
export type WorkerId = number & { readonly brand: unique symbol };

/**
 * Core worker instance managed by the pool orchestrator.
 *
 * CONTAINS: Native Worker handle + derived runtime state.
 */
export interface PooledWorker {
  /** Native Node.js Worker thread handle. */
  readonly worker: Worker;

  /** Unique pool-assigned identifier. */
  readonly id: WorkerId;

  /** Current lifecycle state (FSM-driven). */
  lifecycleState: LifecycleState;

  /** Is worker currently processing a render request? */
  isBusy: boolean;

  /** Total renders completed by this worker instance. */
  requestCount: number;

  /** Timestamp of last request assignment/completion. */
  lastActivityMs: number;

  /** Currently active render request (if busy). */
  currentRequest?: ActiveRenderRequest;

  /** Worker marked for proactive recycling. */
  isStopping: boolean;

  /** Health status snapshot (updated by health monitor). */
  health: HealthCheckResult;

  /** Pool-relative index (for logging/observability). */
  workerIndex: number;
}

/**
 * Request currently inflight within a worker.
 */
export interface ActiveRenderRequest {
  /** Client-assigned request identifier. */
  requestId: string;

  /** Route being rendered. */
  route: RouteDefinition;

  /** Render context (params, search params, headers). */
  context: SourceOGRequestContext;

  /** Request enqueue timestamp. */
  enqueuedAt: number;

  /** Worker assignment timestamp. */
  assignedAt: number;
}

/**
 * Configuration for spawning a new worker thread.
 */
export interface WorkerSpawnOptions {
  /** Absolute path to worker entrypoint (worker-entry.ts). */
  entryPath: string;

  /** Client manifest path (pre-loaded during bootstrap). */
  manifestPath?: string;

  /** Node.js execution arguments (e.g., `--conditions react-server`). */
  execArgv?: string[];

  /** Data serialized to worker via `workerData` (bootstrap config). */
  workerData?: {
    manifestPath?: string;
    useInlineTransform: boolean;
    workerIndex: number;
  };

  /** Max requests before proactive recycling (memory hygiene). */
  maxRequestsPerWorker?: number;
}

/**
 * Aggregate pool health & capacity metrics.
 */
export interface WorkerPoolStats {
  /** Total workers in pool. */
  totalWorkers: number;

  /** Workers in 'ready' state (accepting new requests). */
  availableWorkers: number;

  /** Workers currently processing renders. */
  busyWorkers: number;

  /** Workers in degraded/shutdown state. */
  degradedWorkers: number;

  /** Queue depth (pending render requests). */
  queueDepth: number;

  /** Requests completed since pool creation. */
  totalRequests: number;

  /** Average render latency (ms). */
  avgRenderLatencyMs: number;

  /** Pool utilization (%). */
  utilization: number;

  /** Memory pressure indicator (pool RSS). */
  memoryPressure: number; // 0.0-1.0
}

/**
 * Comprehensive health status for a single worker (pool + monitor snapshot).
 */
export interface WorkerHealthStatus {
  /** Pool-assigned worker ID. */
  id: WorkerId;

  /** Underlying OS thread ID. */
  threadId: number;

  /** Current lifecycle state. */
  lifecycleState: LifecycleState;

  /** Composite health (alive + responsive + memory). */
  isHealthy: boolean;

  /** Can accept new render requests? */
  isAvailable: boolean;

  /** Uptime since worker spawn (ms). */
  uptimeMs: number;

  /** Total requests handled. */
  requestCount: number;

  /** Last activity timestamp (ms). */
  lastActivityMs: number;

  /** Memory usage snapshot. */
  memoryUsage: NodeJS.MemoryUsage;

  /** Health check details (heartbeat, memory watchdogs). */
  checks: HealthCheckResult;
}

/**
 * Worker pool configuration (capacity, backpressure, recycling).
 */
export interface WorkerPoolConfig {
  /** Target concurrent workers (auto-scales with load). */
  minWorkers: number;

  /** Maximum concurrent workers. */
  maxWorkers: number;

  /** Max pending requests before load shedding. */
  maxQueueDepth: number;

  /** Requests per worker before recycling (memory hygiene). */
  maxRequestsPerWorker: number;

  /** Worker spawn timeout (ms). */
  spawnTimeoutMs: number;

  /** Idle worker TTL (ms). */
  idleWorkerTtlMs: number;
}

/**
 * Events emitted by the worker pool (observability integration).
 */
export type WorkerPoolEvent =
  | 'worker_spawned'
  | 'worker_ready'
  | 'worker_busy'
  | 'worker_idle'
  | 'worker_failed'
  | 'worker_recycled'
  | 'pool_exhausted'
  | 'queue_overflow';

/**
 * Discriminated union for worker pool messages (internal + IPC).
 */
export type WorkerPoolMessage =
  | WorkerRenderRequest
  | WorkerRenderResponse
  | { type: 'health_ping'; timestamp: number }
  | { type: 'health_pong'; threadId: number; requestsHandled: number }
  | { type: 'shutdown'; reason?: string }
  | { type: 'shutdown_ack' };