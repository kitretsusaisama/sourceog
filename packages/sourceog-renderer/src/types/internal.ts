// sourceog-renderer/src/types/internal.ts
// Alibaba CTO 2027 Standard — Internal Shared Contracts

import type { SourceOGRuntimeName } from '@sourceog/runtime';

/**
 * Serialized route definition passed to the worker via `postMessage`.
 * 
 * Optimization:
 * Properties are flattened and converted to primitives (strings) because
 * `postMessage` uses the structured clone algorithm, which is expensive for
 * complex objects. URLs are passed as strings to avoid serialization overhead.
 */
export interface WorkerRouteDefinition {
  /** Unique identifier for the route (e.g., "app/pages/index"). */
  readonly id: string;

  /** The URL pathname pattern (e.g., "/blog/[slug]"). */
  readonly pathname: string;

  /** The URL to the route module entry point (file:// or http://). */
  readonly file: string;

  /** Optional URL to the template module. */
  readonly templateFile?: string;

  /** Ordered list of layout module URLs (file://). */
  readonly layouts: readonly string[];
}

/**
 * Serialized request context passed to the worker.
 * 
 * Optimization:
 * Standard Web API objects like `Headers` or `URL` are not ideal for structured cloning.
 * We convert them to simple arrays/primitives for maximum throughput.
 */
export interface WorkerRequestContext {
  /** The request metadata. */
  readonly request: {
    /** The full request URL string. */
    readonly url: string;
    /** HTTP method (GET, POST, etc.). */
    readonly method: string;
    /** Headers as a flat array of tuples for O(1) iteration and small payload. */
    readonly headers: ReadonlyArray<readonly [string, string]>;
    /** Cookies as a flat array of tuples. */
    readonly cookies: ReadonlyArray<readonly [string, string]>;
    /** Unique request identifier for logging/tracing. */
    readonly requestId: string;
    /** The detected runtime environment. */
    readonly runtime: SourceOGRuntimeName;
  };

  /** Route parameters extracted from the pathname. */
  readonly params: Record<string, string | readonly string[]>;

  /** Query parameters as a flat array of tuples. */
  readonly query: ReadonlyArray<readonly [string, string]>;

  /** Optional locale identifier for i18n. */
  readonly locale?: string;
}

/**
 * The response payload returned from the RSC renderer to the main thread.
 * This structure is designed to be serializable and allows for both streamed
 * and buffered responses.
 */
export interface WorkerRenderResponse {
  /** The content format of the payload. */
  readonly format: 'react-flight-text';

  /** The collected chunks of the RSC payload. */
  readonly chunks: readonly string[];

  /** Indicates if the response was streamed in real-time. */
  readonly streamed?: boolean;

  /** Total number of chunks generated. */
  readonly chunkCount?: number;

  /** List of client reference IDs used in the render (for preloading hints). */
  readonly usedClientRefs?: readonly string[];
}
