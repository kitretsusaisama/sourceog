// sourceog-renderer/src/core/env.ts
// Alibaba CTO 2027 Standard — Renderer Environment Context

import {
  isBun,
  isDeno,
  isNode,
  isProduction,
  isDevelopment,
  isTest,
  RUNTIME_MAJOR,
  RUNTIME_NAME,
  supportsNativeTypeScript,
  type SourceOGRuntimeName,
} from '@sourceog/genbook';

// ---------------------------------------------------------------------------
// Runtime Re-exports for Convenience
// ---------------------------------------------------------------------------

export {
  isBun,
  isDeno,
  isNode,
  isProduction,
  isDevelopment,
  isTest,
  RUNTIME_MAJOR,
  RUNTIME_NAME,
};

// ---------------------------------------------------------------------------
// Renderer-Specific Environment Logic
// ---------------------------------------------------------------------------

/**
 * True when running in a local development or test environment.
 * Used to relax strict security checks (e.g., manifest traversal)
 * and enable more verbose diagnostics.
 */
export const isLocalDev: boolean = isDevelopment || isTest;

/**
 * Determines if debug logging is enabled.
 *
 * Signals:
 * - SOURCEOG_DEBUG = "true"
 * - DEBUG contains "sourceog"
 * - NODE_ENV = "development" (fallback for local dev)
 */
export const isDebug: boolean =
  process.env.SOURCEOG_DEBUG === 'true' ||
  (process.env.DEBUG?.includes('sourceog') ?? false) ||
  (!isProduction && isLocalDev);

/**
 * True if the current runtime supports native TypeScript/TSX handling
 * without external loaders (Bun, Deno, or Node >= 22 with flags).
 *
 * Note: This reports capability only; actual flags are validated
 * by the Transpiler Manager.
 */
export const supportsNativeTransform: boolean = supportsNativeTypeScript;

/**
 * Detects if the process is likely running inside a container
 * (Docker, Kubernetes, Heroku, etc.).
 *
 * This is a heuristic used for tuning worker counts and timeouts.
 */
export const isContainerized: boolean =
  !!process.env.KUBERNETES_SERVICE_HOST || // Kubernetes
  !!process.env.DYNO || // Heroku
  false;

/**
 * Resolves the effective runtime name for worker targeting.
 *
 * For the renderer, Bun/Deno/Node are all treated as "node" from the
 * perspective of worker_threads configuration. Edge runtimes are
 * explicitly tagged as "edge".
 */
export function resolveRuntimeTarget(
  runtime?: SourceOGRuntimeName,
): 'node' | 'edge' {
  if (runtime === 'edge') return 'edge';
  return 'node';
}

/**
 * Safe environment variable access.
 *
 * Overload:
 * - getEnv(key) -> string | undefined
 * - getEnv(key, defaultValue) -> string | T
 */
export function getEnv(key: string): string | undefined;
export function getEnv<T>(key: string, defaultValue: T): string | T;
export function getEnv<T>(key: string, defaultValue?: T): string | T | undefined {
  const value = process.env[key];
  if (value === undefined) return defaultValue as T | undefined;
  return value;
}

// ---------------------------------------------------------------------------
// User-Agent Heuristics (Hydration / Policy Helpers)
// ---------------------------------------------------------------------------

/**
 * Heuristic to detect mobile user agents.
 * Used by hydration and planning policies to tune strategies for
 * constrained devices (e.g., prefer deferred hydration).
 */
export function isMobile(ua: string | null | undefined): boolean {
  if (!ua) return false;
  const value = ua.toLowerCase();
  return /android|iphone|ipad|ipod|mobile|windows phone/.test(value);
}

/**
 * Default export for compatibility with modules importing:
 *   import isMobile from './env.js';
 */
export default isMobile;