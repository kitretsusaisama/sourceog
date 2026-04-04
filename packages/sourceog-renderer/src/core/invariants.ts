// sourceog-renderer/src/core/invariants.ts
// Alibaba CTO 2027 Standard — Internal Invariant Checks

// Re-export core invariant utilities from the shared Genbook package.
// These are the only primitives that should be used for assertions across
// the SourceOG ecosystem (renderer, planner, platform, etc.).
export {
  invariant,
  devInvariant,
  exhaustiveCheck,
  assertDefined,
} from '@sourceog/genbook';

import { invariant } from '@sourceog/genbook';

// ---------------------------------------------------------------------------
// Renderer-Specific Assertions
// ---------------------------------------------------------------------------

/**
 * Asserts that a worker pool is not in a shutting-down state
 * before accepting new render work.
 *
 * Used by admission control and orchestrator to prevent new tasks
 * from entering a pool that is undergoing graceful shutdown.
 */
export function assertPoolActive(
  isShuttingDown: boolean,
  routeId?: string,
): void {
  invariant(
    !isShuttingDown,
    `Cannot accept render request for route "${routeId}": Worker pool is shutting down.`,
  );
}

/**
 * Asserts that the queue has not exceeded the configured maximum depth.
 *
 * Protects the system from unbounded memory growth and signals upstream
 * to start shedding load (via WorkerPoolExhaustedError in admission control).
 */
export function assertQueueDepth(
  depth: number,
  maxDepth: number,
  routeId?: string,
): void {
  invariant(
    depth < maxDepth,
    `Queue overflow for route "${routeId}": Maximum depth ${maxDepth} reached.`,
  );
}