/**
 * Supported runtime environments for the SourceOG engine.
 */
export type SourceOGRuntimeName = 'node' | 'bun' | 'deno' | 'edge' | 'vercel-node' | 'vercel-edge' | 'cloudflare';
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
/**
 * Detects the current runtime environment.
 * Optimized for performance and accuracy across Node, Bun, and Deno.
 */
export declare function detectRuntimeCapabilities(): RuntimeCapabilities;
