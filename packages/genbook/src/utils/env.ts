// packages/genbook/src/utils/env.ts
// Alibaba CTO 2027 Standard — Environment Detection Helpers

import type { SourceOGRuntimeName, EnvironmentMode } from '../types/runtime.js';

// ---------------------------------------------------------------------------
// GlobalThis Extensions
// ---------------------------------------------------------------------------

declare global {
  interface GlobalThis {
    Bun?: { version?: string };
    Deno?: { version?: { deno?: string } };
  }
}

// ---------------------------------------------------------------------------
// Runtime Detection (Constants)
// ---------------------------------------------------------------------------

/**
 * Detects if running inside Bun.
 * Bun has specific globals and behaves differently regarding transpilation.
 */
export const isBun: boolean = typeof globalThis.Bun !== 'undefined';

/**
 * Detects if running inside Deno.
 * Deno has native TypeScript support and Web Standard APIs.
 */
export const isDeno: boolean = typeof globalThis.Deno !== 'undefined';

/**
 * Detects if running inside Node.js.
 * Assumed true if not Bun or Deno and process.versions.node exists.
 */
export const isNode: boolean = !isBun && !isDeno && typeof process !== 'undefined' && !!process.versions?.node;

/**
 * Detects if running in an Edge Runtime (Cloudflare Workers, Vercel Edge, etc.).
 * Typically characterized by lack of process.versions.node and presence of global caches.
 * Note: For this package, we generally assume a full server environment, but this flag 
 * helps identify restricted environments.
 */
export const isEdge: boolean = !isBun && !isDeno && !isNode;

// ---------------------------------------------------------------------------
// Version Extraction
// ---------------------------------------------------------------------------

function getVersion(): string {
  if (isBun) return globalThis.Bun.version ?? 'unknown';
  if (isDeno) return globalThis.Deno.version?.deno ?? 'unknown';
  if (isNode) return process.versions.node;
  return 'unknown';
}

/**
 * The detected runtime version string.
 */
export const RUNTIME_VERSION: string = getVersion();

/**
 * The major version number of the runtime.
 * Useful for feature flagging (e.g., Node 22 vs 20).
 */
export const RUNTIME_MAJOR: number = parseInt(RUNTIME_VERSION.split('.')[0], 10) || 0;

/**
 * The normalized name of the runtime.
 */
export const RUNTIME_NAME: SourceOGRuntimeName = isBun 
  ? 'bun' 
  : isDeno 
    ? 'deno' 
    : isNode 
      ? 'node' 
      : 'edge';

// ---------------------------------------------------------------------------
// Environment Mode Detection
// ---------------------------------------------------------------------------

function getMode(): EnvironmentMode {
  // Check for test environments first
  if (typeof process !== 'undefined') {
    if (process.env.NODE_ENV === 'test') return 'test';
    // Check for common test runners
    if (process.env.VITEST || process.env.JEST_WORKER_ID) return 'test';
    
    // Standard NODE_ENV
    if (process.env.NODE_ENV === 'production') return 'production';
  }
  
  // Deno specific check
  if (isDeno) {
    const denoEnv = (globalThis as unknown as { Deno: { env: { get(key: string): string | undefined } } }).Deno.env;
    const nodeEnv = denoEnv.get('NODE_ENV');
    if (nodeEnv === 'test' || denoEnv.get('DENO_TEST')) return 'test';
    if (nodeEnv === 'production') return 'production';
  }

  // Default to production for Edge/Unknown or if NODE_ENV is unset
  return 'production';
}

/**
 * The current environment mode.
 */
export const ENV_MODE: EnvironmentMode = getMode();

/**
 * Boolean helpers for environment mode.
 */
export const isProduction: boolean = ENV_MODE === 'production';
export const isDevelopment: boolean = ENV_MODE === 'development';
export const isTest: boolean = ENV_MODE === 'test';

// ---------------------------------------------------------------------------
// Feature Detection
// ---------------------------------------------------------------------------

/**
 * Check if the runtime supports native ESM imports.
 * (Bun, Deno, Node 14+)
 */
export const supportsESM: boolean = isBun || isDeno || (isNode && RUNTIME_MAJOR >= 14);

/**
 * Check if the runtime can handle TypeScript/TSX natively.
 * (Bun, Deno, Node 22.6+ with experimental flags)
 * Note: This only checks version capability; actual flag presence is checked by transpiler.
 */
export const supportsNativeTypeScript: boolean = isBun || isDeno || (isNode && RUNTIME_MAJOR >= 22);

/**
 * Check if `node:worker_threads` is available.
 */
export const supportsWorkerThreads: boolean = isNode || isBun;