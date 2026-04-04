/**
 * Property 12: Route Module Cache Bounded Size
 * Validates: Requirements 8.1, 8.2
 *
 * For any sequence of `loadRouteModule` calls with more than
 * `ROUTE_MODULE_CACHE_MAX` distinct file paths, the Route_Module_Cache size
 * must never exceed `ROUTE_MODULE_CACHE_MAX` entries.
 *
 * Since rsc-worker-bootstrap.mjs runs inside a worker_threads Worker and
 * cannot be directly imported, this test validates the LRU eviction algorithm
 * by reimplementing it faithfully and asserting the bounded-size property
 * across arbitrary call sequences.
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

// ---------------------------------------------------------------------------
// LRU cache implementation — mirrors rsc-worker-bootstrap.mjs exactly
// ---------------------------------------------------------------------------

const ROUTE_MODULE_CACHE_MAX = 50;

/**
 * Create a fresh LRU route module cache pair (module cache + error cache)
 * matching the implementation in rsc-worker-bootstrap.mjs.
 */
function createLruCache() {
  const routeModuleCache = new Map<string, unknown>();
  const routeModuleErrorCache = new Map<string, Error>();

  /**
   * Simulate loadRouteModule: returns a fake module object on success,
   * or throws/caches an error for paths in `failingPaths`.
   */
  async function loadRouteModule(
    file: string,
    failingPaths: Set<string> = new Set()
  ): Promise<unknown> {
    // Req 8.3: return cached error without re-attempting import
    if (routeModuleErrorCache.has(file)) {
      const cachedErr = routeModuleErrorCache.get(file);
      if (cachedErr) {
        throw cachedErr;
      }
      throw new Error(`Unexpected missing error for file: ${file}`);
    }

    if (routeModuleCache.has(file)) {
      // Req 8.2: promote to MRU position by delete + re-insert
      const mod = routeModuleCache.get(file);
      routeModuleCache.delete(file);
      routeModuleCache.set(file, mod);
      return mod;
    }

    if (failingPaths.has(file)) {
      const err = new Error(`Failed to import: ${file}`);
      // Req 8.3: store error in negative-result cache
      routeModuleErrorCache.set(file, err);
      throw err;
    }

    // Simulate a successful module load
    const mod = { default: () => null, __file: file };
    routeModuleCache.set(file, mod);

    // Req 8.1: evict LRU entry when cache exceeds max size
    if (routeModuleCache.size > ROUTE_MODULE_CACHE_MAX) {
      const lruKey = routeModuleCache.keys().next().value;
      if (lruKey !== undefined) {
        routeModuleCache.delete(lruKey);
      }
    }

    return mod;
  }

  return { routeModuleCache, routeModuleErrorCache, loadRouteModule };
}

// ---------------------------------------------------------------------------
// Property 12: Route Module Cache Bounded Size
// ---------------------------------------------------------------------------

describe("Property 12: Route Module Cache Bounded Size", () => {
  it(
    "cache size never exceeds ROUTE_MODULE_CACHE_MAX after loading more than the limit",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          // Number of distinct paths: always more than ROUTE_MODULE_CACHE_MAX
          fc.integer({ min: ROUTE_MODULE_CACHE_MAX + 1, max: ROUTE_MODULE_CACHE_MAX + 100 }),
          async (pathCount) => {
            const { routeModuleCache, loadRouteModule } = createLruCache();
            const sizeSnapshots: number[] = [];

            // Load pathCount distinct paths sequentially
            for (let i = 0; i < pathCount; i++) {
              const file = `/routes/page-${i}.tsx`;
              await loadRouteModule(file);
              sizeSnapshots.push(routeModuleCache.size);
            }

            // Req 8.1: cache size must never exceed ROUTE_MODULE_CACHE_MAX
            const exceeded = sizeSnapshots.some((s) => s > ROUTE_MODULE_CACHE_MAX);
            return !exceeded;
          }
        ),
        { numRuns: 100 }
      );
    }
  );

  it(
    "cache size stays at ROUTE_MODULE_CACHE_MAX after loading many distinct paths",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: ROUTE_MODULE_CACHE_MAX + 1, max: ROUTE_MODULE_CACHE_MAX + 200 }),
          async (pathCount) => {
            const { routeModuleCache, loadRouteModule } = createLruCache();

            for (let i = 0; i < pathCount; i++) {
              await loadRouteModule(`/routes/page-${i}.tsx`);
            }

            // After loading more than the max, size must equal exactly ROUTE_MODULE_CACHE_MAX
            return routeModuleCache.size === ROUTE_MODULE_CACHE_MAX;
          }
        ),
        { numRuns: 100 }
      );
    }
  );

  it(
    "accessing a cached entry promotes it to MRU and it survives subsequent evictions (Req 8.2)",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          // accessIndex: which of the first ROUTE_MODULE_CACHE_MAX entries to re-access
          fc.integer({ min: 0, max: ROUTE_MODULE_CACHE_MAX - 1 }),
          async (accessIndex) => {
            const { routeModuleCache, loadRouteModule } = createLruCache();

            // Fill cache to exactly ROUTE_MODULE_CACHE_MAX entries
            for (let i = 0; i < ROUTE_MODULE_CACHE_MAX; i++) {
              await loadRouteModule(`/routes/page-${i}.tsx`);
            }

            const promotedFile = `/routes/page-${accessIndex}.tsx`;

            // Re-access the entry at accessIndex — promotes it to MRU (Req 8.2)
            await loadRouteModule(promotedFile);

            // Now load one new entry — this must evict the LRU (not the promoted one)
            await loadRouteModule(`/routes/page-new.tsx`);

            // The promoted entry must still be in the cache
            const promotedSurvived = routeModuleCache.has(promotedFile);

            // Cache size must still be bounded
            const sizeBounded = routeModuleCache.size <= ROUTE_MODULE_CACHE_MAX;

            return promotedSurvived && sizeBounded;
          }
        ),
        { numRuns: 100 }
      );
    }
  );

  it(
    "negative-result cache returns cached error without re-attempting import (Req 8.3)",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 10 }),
          async (retryCount) => {
            const { routeModuleErrorCache, loadRouteModule } = createLruCache();
            const failingFile = "/routes/broken.tsx";
            const failingPaths = new Set([failingFile]);

            // First call: should fail and cache the error
            let firstError: Error | undefined;
            try {
              await loadRouteModule(failingFile, failingPaths);
            } catch (e) {
              firstError = e as Error;
            }

            if (!firstError) return false;
            if (!routeModuleErrorCache.has(failingFile)) return false;

            // Subsequent calls: must throw the same cached error
            for (let i = 0; i < retryCount; i++) {
              let retryError: Error | undefined;
              try {
                // Pass empty failingPaths — error must come from cache, not re-attempt
                await loadRouteModule(failingFile, new Set());
              } catch (e) {
                retryError = e as Error;
              }
              if (!retryError) return false;
              if (retryError !== firstError) return false;
            }

            return true;
          }
        ),
        { numRuns: 100 }
      );
    }
  );
});
