// packages/genbook/src/types/runtime.ts
// Alibaba CTO 2027 Standard — Runtime Detection & Capabilities

/**
 * Supported runtime environments for the SourceOG engine.
 */
export type SourceOGRuntimeName =
  | 'node'
  | 'bun'
  | 'deno'
  | 'edge'
  | 'vercel-node'
  | 'vercel-edge'
  | 'cloudflare';

/**
 * Standard environment modes.
 */
export type EnvironmentMode = 'development' | 'production' | 'test';

/**
 * Describes the capabilities of the detected runtime.
 * Used by the Transpiler and Orchestrator to make intelligent decisions
 * (e.g., skipping TSX transformation in Bun).
 */
export interface RuntimeCapabilities {
  /** The name of the runtime environment. */
  name: SourceOGRuntimeName;
  
  /** The version string of the runtime (e.g., "v20.11.0"). */
  version: string;

  /** True if the runtime supports TypeScript/TSX natively without transpilation. */
  supportsNativeTypeScript: boolean;

  /** True if the runtime supports Web Standard APIs (fetch, Request, Response) globally. */
  supportsWebAPIs: boolean;

  /** True if the runtime uses worker_threads (Node/Bun) vs Isolates (Edge). */
  supportsWorkerThreads: boolean;

  /** The detected NODE_ENV or equivalent. */
  mode: EnvironmentMode;
}

// ---------------------------------------------------------------------------
// Runtime Detection Logic
// ---------------------------------------------------------------------------

/**
 * Detects the current runtime environment.
 * Optimized for performance and accuracy across Node, Bun, and Deno.
 */
export function detectRuntimeCapabilities(): RuntimeCapabilities {
  // 1. Detect Bun (Prioritize due to specific global)
  // @ts-expect-error - Bun global
  if (typeof globalThis.Bun !== 'undefined') {
    // @ts-expect-error - Bun global
    const version = typeof Bun.version === 'string' ? Bun.version : 'unknown';
    return {
      name: 'bun',
      version,
      supportsNativeTypeScript: true, // Bun has native TSX support
      supportsWebAPIs: true,
      supportsWorkerThreads: true,
      mode: getMode(),
    };
  }

  // 2. Detect Deno
  // @ts-expect-error - Deno global
  if (typeof globalThis.Deno !== 'undefined') {
    // @ts-expect-error - Deno global
    const version = typeof Deno.version?.deno === 'string' ? Deno.version.deno : 'unknown';
    return {
      name: 'deno',
      version,
      supportsNativeTypeScript: true, // Deno has native TS support
      supportsWebAPIs: true,
      supportsWorkerThreads: false, // Deno uses Web Workers, not node:worker_threads
      mode: getMode(),
    };
  }

  // 3. Detect Node.js (Default for most server environments)
  // Check process.versions for node vs edge/V8 isolates
  if (process.versions?.node) {
    const nodeMajor = parseInt(process.versions.node.split('.')[0], 10);
    
    // Check for experimental transform types support (Node 22.6+)
    // Note: We check version here; actual flag presence is checked by transpiler.
    const supportsNativeTypeScript = nodeMajor >= 22;

    return {
      name: 'node',
      version: process.versions.node,
      supportsNativeTypeScript,
      supportsWebAPIs: nodeMajor >= 18, // Node 18+ has global fetch
      supportsWorkerThreads: true,
      mode: getMode(),
    };
  }

  // 4. Fallback for Edge Runtimes (No process.versions, no Bun/Deno globals)
  return {
    name: 'edge',
    version: 'unknown',
    supportsNativeTypeScript: false,
    supportsWebAPIs: true, // Edge implies Web Standards
    supportsWorkerThreads: false,
    mode: getMode(),
  };
}

/**
 * Determines the current environment mode.
 * Resilient to missing process.env (Edge runtimes).
 */
function getMode(): EnvironmentMode {
  // Try process.env (Node/Bun)
  if (typeof process !== 'undefined' && process.env?.NODE_ENV) {
    const env = process.env.NODE_ENV;
    if (env === 'test' || process.env.VITEST || process.env.JEST_WORKER_ID) return 'test';
    if (env === 'production') return 'production';
    return 'development';
  }

  // Try Deno.env
  // @ts-expect-error - Deno global
  if (typeof globalThis.Deno !== 'undefined' && Deno.env) {
    // @ts-expect-error - Deno global
    const env = Deno.env.get('NODE_ENV') || Deno.env.get('DENO_ENV');
    if (env === 'production') return 'production';
    if (env === 'test') return 'test';
    return 'development';
  }

  // Default assumption for Edge is production
  return 'production';
}