// sourceog-renderer/src/orchestrator/renderer-orchestrator.ts
// Alibaba CTO 2027 Standard — Top-Level Public API

import type { RouteDefinition } from '@sourceog/router';
import type { SourceOGRequestContext } from '@sourceog/runtime';
import type {
  Renderer,
  RenderRouteOptions,
  RendererPoolStats,
} from '../types/public.js';
import type { WorkerRenderResponse } from '../types/internal.js';
import { getSharedWorkerPool, shutdownAllPools } from './pool-registry.js';
import { logger } from '../core/logger.js';

/**
 * The primary public interface for the rendering engine.
 *
 * Abstracts the complexity of worker pools, manifest resolution, and caching.
 * This is the main entry point used by the HTTP/request handler.
 */
export class RendererOrchestrator implements Renderer {
  /**
   * Renders a route to the official RSC payload.
   *
   * Workflow:
   * 1. Resolve the correct worker pool based on the route's manifest.
   * 2. Ensure the pool is initialized (handled internally by the pool).
   * 3. Dispatch the render request.
   */
  public async renderRoute(
    route: RouteDefinition,
    context: SourceOGRequestContext,
    options?: RenderRouteOptions,
  ): Promise<WorkerRenderResponse> {
    // The registry handles pool reuse and initialization.
    const pool = getSharedWorkerPool(route.file);

    try {
      return await pool.render(route, context, options);
    } catch (error) {
      logger.error(`Render failed for route ${route.id}`, error, {
        routeId: route.id,
        routeFile: route.file,
      });
      throw error;
    }
  }
   
  /**
   * Retrieves aggregated statistics from the active worker pools.
   *
   * Note: In a multi-tenant environment, this aggregates stats from all
   * active pools. The concrete implementation depends on exposing stats
   * from the registry and WorkerPool.
   */
  public getStats(): RendererPoolStats {
    // Placeholder implementation; to be wired to pool-registry / WorkerPool stats.
    return {
      workerCount: 0,
      busyWorkers: 0,
      idleWorkers: 0,
      queuedRequests: 0,
      requestCounts: [],
      workerThreadIds: [],
      maxQueueDepth: 0,
    };
  }

  /**
   * Gracefully shuts down all active worker pools.
   *
   * Intended to be called during process shutdown or server drain.
   */
  public async shutdown(): Promise<void> {
    logger.info('Shutting down Renderer Orchestrator...');
    await shutdownAllPools();
  }
}

/**
 * Factory function to create a renderer instance.
 * Recommended for dependency injection and testing.
 */
export function createRenderer(): Renderer {
  return new RendererOrchestrator();
}