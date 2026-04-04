// sourceog-renderer/src/types/public.ts
// Alibaba CTO 2027 Standard — Public API Types

import type { RouteDefinition } from '@sourceog/router';
import type { SourceOGRequestContext } from '@sourceog/runtime';
import type { WorkerRenderResponse } from './internal.js';
import type { ExecutionPlan } from './planning.js';

/**
 * Configuration options for rendering a route to an RSC payload.
 * These options control rendering behavior, timeouts, and streaming modes.
 */
export interface RenderRouteOptions {
  readonly pathname?: string;

  readonly clientAssets?: unknown;

  readonly clientReferenceManifest?: unknown;

  readonly clientReferenceDistRoot?: string;

  readonly routeIdentity?: unknown;

  /** 
   * Parallel routes to render in the same pass.
   * Useful for simultaneously rendering slots or modals alongside the main route.
   */
  readonly parallelRoutes?: Readonly<Record<string, RouteDefinition>>;

  /** 
   * Maximum time in milliseconds to wait for the render to complete.
   * If exceeded, the render is aborted and an error is thrown.
   */
  readonly timeoutMs?: number;

  /** 
   * Callback invoked for each streaming chunk generated during rendering.
   * Enables real-time streaming to the client.
   */
  readonly onChunk?: (chunk: string) => void;

  /** 
   * If true, collects all chunks in memory and includes them in the response.
   * Useful for SSR or debugging. Defaults to false (streaming).
   */
  readonly collectChunks?: boolean;
}

/**
 * Statistical snapshot of the worker pool's health and load.
 * Used for monitoring, autoscaling, and diagnostics.
 */
export interface RendererPoolStats {
  /** Total number of worker threads in the pool. */
  readonly workerCount: number;

  /** Number of workers currently processing requests. */
  readonly busyWorkers: number;

  /** Number of workers available for immediate dispatch. */
  readonly idleWorkers: number;

  /** Number of requests waiting in the queue. */
  readonly queuedRequests: number;

  /** 
   * Histogram of request counts per worker.
   * Useful for detecting load imbalance.
   */
  readonly requestCounts: ReadonlyArray<number>;

  /** System thread IDs of the active workers. */
  readonly workerThreadIds: ReadonlyArray<number>;

  /** Maximum allowed depth of the request queue. */
  readonly maxQueueDepth: number;
}

/**
 * The primary public interface for the Renderer Orchestrator.
 * 
 * This abstracts the underlying worker pool, scheduling, and error handling,
 * providing a stable contract for higher-level frameworks or servers.
 */
export interface Renderer {
  /**
   * Renders a route to the official RSC payload format.
   * 
   * @param route - The route definition to render.
   * @param context - The request context (headers, cookies, params).
   * @param options - Optional rendering configuration.
   * @returns A promise resolving to the render response.
   */
  renderRoute(
    route: RouteDefinition,
    context: SourceOGRequestContext,
    options?: RenderRouteOptions
  ): Promise<WorkerRenderResponse>;

  /**
   * Retrieves current statistics from the worker pool.
   * 
   * @returns A snapshot of pool statistics.
   */
  getStats(): RendererPoolStats;

  /**
   * Gracefully shuts down the renderer and all associated workers.
   * Ensures in-flight requests are completed or rejected before resolving.
   */
  shutdown(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Public Type Re-exports
// ---------------------------------------------------------------------------

export type { ExecutionPlan } from './planning.js';
export type { WorkerRenderResponse } from './internal.js';
