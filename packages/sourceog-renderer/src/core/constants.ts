// sourceog-renderer/src/core/constants.ts
// Alibaba CTO 2027 Standard — Core Constants & Configuration

import os from 'node:os';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Internal Helpers (Not Exported)
// ---------------------------------------------------------------------------

/**
 * Safely parses an integer from an environment variable with sane bounds.
 *
 * - Returns the provided default if the variable is unset or invalid.
 * - Applies optional min/max clamping to avoid pathological configs.
 */
function readIntEnv(
  key: string,
  defaultValue: number,
  options: { min?: number; max?: number } = {},
): number {
  const raw = process.env[key];
  if (!raw) return defaultValue;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    return defaultValue;
  }

  let value = parsed;

  if (options.min !== undefined && value < options.min) {
    value = options.min;
  }
  if (options.max !== undefined && value > options.max) {
    value = options.max;
  }

  return value;
}

/**
 * Detected CPU core count, normalized to a minimum of 1.
 * Used for deriving worker pool sizing defaults.
 */
const CPU_COUNT = Math.max(os.cpus()?.length ?? 1, 1);

// ---------------------------------------------------------------------------
// Worker Pool Defaults
// ---------------------------------------------------------------------------

/**
 * Default number of workers to spawn.
 *
 * Priority:
 * 1. Explicit env override: SOURCEOG_RSC_WORKERS
 * 2. CPU-based heuristic: cores - 1 (never below 2, never above 32)
 *
 * This keeps enough headroom for the main event loop and other services
 * while avoiding unbounded worker creation on very large machines.
 */
export const DEFAULT_WORKER_COUNT: number = readIntEnv(
  'SOURCEOG_RSC_WORKERS',
  Math.max(2, CPU_COUNT - 1),
  { min: 1, max: 32 },
);

/**
 * Maximum requests a worker handles before recycling.
 * Prevents unbounded memory growth in long‑running processes.
 *
 * Env: SOURCEOG_RSC_MAX_REQUESTS
 */
export const MAX_REQUESTS_PER_WORKER: number = readIntEnv(
  'SOURCEOG_RSC_MAX_REQUESTS',
  500,
  { min: 1, max: 10_000 },
);

/**
 * Time in milliseconds before a request in the queue times out
 * (Admission‑control level timeout, distinct from render timeout).
 *
 * Env: SOURCEOG_RSC_QUEUE_TIMEOUT_MS
 */
export const QUEUE_TIMEOUT_MS: number = readIntEnv(
  'SOURCEOG_RSC_QUEUE_TIMEOUT_MS',
  10_000,
  { min: 100, max: 120_000 },
);

/**
 * Time in milliseconds before a render operation times out inside the worker.
 *
 * Env: SOURCEOG_RSC_TIMEOUT_MS
 */
export const WORKER_TIMEOUT_MS: number = readIntEnv(
  'SOURCEOG_RSC_TIMEOUT_MS',
  5_000,
  { min: 500, max: 300_000 },
);

/**
 * Default maximum depth for the render queue.
 * Protects the system from unbounded backpressure.
 *
 * Env: SOURCEOG_RSC_MAX_QUEUE
 */
export const DEFAULT_MAX_QUEUE_DEPTH: number = readIntEnv(
  'SOURCEOG_RSC_MAX_QUEUE',
  1_000,
  { min: 1, max: 100_000 },
);

/**
 * Time‑to‑live for shared worker pools in milliseconds.
 * Pools that are idle longer than this will be swept.
 *
 * Env: SOURCEOG_POOL_TTL_MS
 */
export const POOL_TTL_MS: number = readIntEnv(
  'SOURCEOG_POOL_TTL_MS',
  300_000, // 5 minutes
  { min: 60_000, max: 3_600_000 },
);

/**
 * Interval for sweeping stale pools in milliseconds.
 *
 * Env: SOURCEOG_POOL_SWEEP_INTERVAL_MS
 */
export const SWEEP_INTERVAL_MS: number = readIntEnv(
  'SOURCEOG_POOL_SWEEP_INTERVAL_MS',
  60_000,
  { min: 5_000, max: 600_000 },
);

// ---------------------------------------------------------------------------
// Manifest & Cache Constants
// ---------------------------------------------------------------------------

/**
 * Maximum size for the LRU manifest path/content caches.
 * Tunable for very large multi‑tenant deployments.
 *
 * Env: SOURCEOG_MANIFEST_CACHE_MAX
 */
export const MANIFEST_CACHE_MAX: number = readIntEnv(
  'SOURCEOG_MANIFEST_CACHE_MAX',
  256,
  { min: 16, max: 10_000 },
);

/**
 * The subdirectory name for storing manifests relative to the project root.
 * Example: <PROJECT_ROOT>/.sourceog
 */
export const MANIFEST_DIR_NAME = '.sourceog';

// ---------------------------------------------------------------------------
// Transpiler / Runtime Constants
// ---------------------------------------------------------------------------

/**
 * Node.js major version requirement for native type stripping support
 * (Node 22+ with experimental transform‑types support).
 */
export const NODE_MAJOR_FOR_NATIVE_TYPES = 22;

/**
 * Condition name used for ESM resolution in Node for RSC/RSC‑aware bundles.
 * Passed via --conditions when spawning worker processes.
 */
export const REACT_SERVER_CONDITION = 'react-server';

// ---------------------------------------------------------------------------
// Project & Worker Entrypoints
// ---------------------------------------------------------------------------

/**
 * The resolved project root directory.
 * Used for security checks (path traversal) and manifest resolution.
 */
export const PROJECT_ROOT: string = path.resolve(process.cwd());

/**
 * Absolute filesystem path to the worker bootstrap entry.
 *
 * This indirection allows the WorkerPool to remain agnostic of the exact
 * on‑disk layout (TS vs JS, dist vs src). The bootstrap in turn locates
 * and loads the actual worker entry implementation.
 */
const WORKER_BOOTSTRAP_CANDIDATES = [
  new URL('../rsc-worker-bootstrap.mjs', import.meta.url),
  new URL('./rsc-worker-bootstrap.mjs', import.meta.url),
];

export const WORKER_FILE_PATH: string = fileURLToPath(
  WORKER_BOOTSTRAP_CANDIDATES.find((candidate) => existsSync(fileURLToPath(candidate)))
  ?? WORKER_BOOTSTRAP_CANDIDATES[0],
);
