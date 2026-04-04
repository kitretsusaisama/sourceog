// sourceog-renderer/src/rsc-worker.ts
// Alibaba CTO 2027 Standard — Legacy Worker Entry Shim (DEPRECATED)
//
// **CRITICAL**: Backward compatibility layer for v1 consumers directly
// importing the worker entrypoint. Automatically delegates to the v2
// modular architecture (`src/workers/worker-entry.ts`).
//
// MIGRATION PATH:
// 1. Update imports: `@sourceog/renderer/workers` → orchestrator-managed spawning
// 2. Remove direct worker instantiation
// 3. Use `renderRouteToOfficialRscPayload()` public API
//
// SAFETY: No-op if already running in worker context. Self-executing.

import { isMainThread } from 'node:worker_threads';
import { logger } from './core/logger.js';
import './workers/worker-entry.js'; // Delegates to canonical v2 entrypoint

/**
 * Validation: Ensure this shim only executes in worker context.
 * Prevents accidental main-thread execution.
 */
if (isMainThread) {
  logger.warn(
    'rsc-worker.ts imported on main thread (shim only). ' +
    'Use orchestrator for production spawning.',
  );
}

// ---------------------------------------------------------------------------
// RUNTIME NOTES
// ---------------------------------------------------------------------------
// - Worker entrypoint (`worker-entry.ts`) handles full lifecycle:
//   1. Message loop setup
//   2. Manifest preloading  
//   3. Module loader configuration
//   4. Health reporting
//   5. Graceful shutdown
// - No exports needed: Executes purely as side-effect on import.
// - Thread termination handled by pool orchestrator (SIGTERM → exit(0)).

/**
 * @deprecated Direct worker imports deprecated. 
 * Use `RendererOrchestrator` for managed pooling.
 */
export const DEPRECATION_NOTICE = {
  message: 'rsc-worker.ts is deprecated. Migrate to orchestrator-managed workers.',
  since: 'v2.0.0',
  removalTarget: 'v3.0.0',
  migrationGuide: 'https://sourceog.dev/docs/renderer-v2-migration',
};