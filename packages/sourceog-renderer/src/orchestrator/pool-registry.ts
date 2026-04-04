// sourceog-renderer/src/orchestrator/pool-registry.ts
// Alibaba CTO 2027 Standard — Shared Pool Registry & Lifecycle

import { resolveManifestPathForRouteFile } from '../manifests/manifest-resolver.js';
import { POOL_TTL_MS, SWEEP_INTERVAL_MS } from '../core/constants.js';
import { logger } from '../core/logger.js';
import { WorkerPool, type WorkerPoolOptions } from './worker-pool.js';

/**
 * Internal entry for tracking pool usage and lifecycle.
 */
interface PoolEntry {
  pool: WorkerPool;
  lastUsedAt: number;
}

/**
 * Global registry of active worker pools, keyed by manifest path.
 *
 * Rationale:
 * Different routes may require different manifest contexts (e.g., multiple apps
 * in a monorepo). This registry ensures we:
 * - Reuse pools with identical configurations.
 * - Isolate pools for distinct manifests.
 */
const sharedWorkerPools = new Map<string, PoolEntry>();

/**
 * Timer reference for the stale pool sweeper.
 */
let sweepTimer: NodeJS.Timeout | undefined;

/**
 * Flag to ensure the process shutdown hook is installed exactly once.
 */
let shutdownHookInstalled = false;

/**
 * Retrieves a shared WorkerPool instance for the given route file.
 *
 * If a pool for the route's manifest already exists, it is reused.
 * Otherwise, a new pool is created and registered.
 *
 * @param routeFile - The absolute path to the route file.
 * @param options - Optional overrides for pool configuration.
 */
export function getSharedWorkerPool(
  routeFile: string,
  options?: WorkerPoolOptions,
): WorkerPool {
  ensureSweepTimer();
  ensureShutdownHook();

  const now = Date.now();

  // Resolve manifest path for this route (may be undefined).
  const manifestPath =
    resolveManifestPathForRouteFile(routeFile) ?? 'sourceog-default';

  // Check for existing pool.
  const existing = sharedWorkerPools.get(manifestPath);
  if (existing) {
    existing.lastUsedAt = now;
    return existing.pool;
  }

  // Create new pool.
  logger.debug('Creating new shared worker pool for manifest', {
    manifestPath,
  });

  const pool = new WorkerPool({
    ...options,
    // For the sentinel "sourceog-default", we omit manifestPath so the pool
    // can fall back to its internal default behavior.
    manifestPath: manifestPath === 'sourceog-default' ? undefined : manifestPath,
  });

  sharedWorkerPools.set(manifestPath, {
    pool,
    lastUsedAt: now,
  });

  // Trigger initialization asynchronously; the pool handles its own mutex.
  void pool.initialize();

  return pool;
}

/**
 * Starts the timer that periodically sweeps stale pools.
 *
 * Stale pools are those that haven't been used for `POOL_TTL_MS`.
 */
function ensureSweepTimer(): void {
  if (sweepTimer) return;

  sweepTimer = setInterval(() => {
    const now = Date.now();

    for (const [key, entry] of sharedWorkerPools) {
      if (now - entry.lastUsedAt > POOL_TTL_MS) {
        logger.info('Sweeping stale worker pool', { manifestKey: key });
        sharedWorkerPools.delete(key);
        void entry.pool.shutdown();
      }
    }
  }, SWEEP_INTERVAL_MS);

  // Allow the process to exit naturally if this is the only active timer.
  sweepTimer.unref?.();
}

/**
 * Installs the global process shutdown hook for graceful termination.
 */
function ensureShutdownHook(): void {
  if (shutdownHookInstalled) return;
  shutdownHookInstalled = true;

  const handleSignal = (signal: NodeJS.Signals) => {
    logger.info(`Received ${signal}. Shutting down all worker pools...`);
    void shutdownAllPools().finally(() => {
      process.exit(0);
    });
  };

  process.once('SIGTERM', handleSignal);
  process.once('SIGINT', handleSignal);
}

/**
 * Gracefully shuts down all active worker pools.
 *
 * Used by:
 * - Process signal handlers (SIGINT/SIGTERM).
 * - Renderer orchestrator shutdown.
 */
export async function shutdownAllPools(): Promise<void> {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = undefined;
  }

  const entries = Array.from(sharedWorkerPools.values());
  sharedWorkerPools.clear();

  await Promise.all(entries.map((entry) => entry.pool.shutdown()));
}
