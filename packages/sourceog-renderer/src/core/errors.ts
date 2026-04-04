// sourceog-renderer/src/core/errors.ts
// Alibaba CTO 2027 Standard — Renderer Error Utilities

import {
  SourceOGBaseError,
  ManifestTraversalError,
  RenderError,
  RenderTimeoutError,
  WorkerPoolExhaustedError,
} from '@sourceog/genbook';

// ---------------------------------------------------------------------------
// Re-exports for Internal / Public Convenience
// ---------------------------------------------------------------------------

export {
  SourceOGBaseError,
  ManifestTraversalError,
  RenderError,
  RenderTimeoutError,
  WorkerPoolExhaustedError,
};

// ---------------------------------------------------------------------------
// Renderer-Specific Error Definitions
// ---------------------------------------------------------------------------

/**
 * Wrapper for errors occurring during the compilation / resolution phase
 * within the renderer context (planning, manifest wiring, worker boot, etc.).
 *
 * These are treated as high-severity transpile/runtime integration failures.
 */
export class CompilerError extends SourceOGBaseError {
  public readonly code: string;
  public readonly category = 'transpile' as const;
  public readonly severity = 'critical' as const;
  public readonly isFatal = true;

  constructor(
    /**
     * Internal sub-code to distinguish specific compiler failure modes
     * (e.g., "TRANSFORM_STRATEGY_FAILED", "MODULE_RESOLVE_FAILED").
     */
    public readonly internalCode: string,
    message: string,
    metadata?: Record<string, unknown>,
    cause?: unknown,
  ) {
    super(message, { metadata: { internalCode, ...(metadata ?? {}) }, cause });
    this.code = internalCode;
    this.name = 'CompilerError';
  }

  public override get resolutionHint(): string {
    switch (this.internalCode) {
      case 'TRANSFORM_STRATEGY_FAILED':
        return 'Inspect the transpiler configuration (esbuild/sucrase) and check for unsupported syntax or missing dependencies.';
      case 'MODULE_RESOLVE_FAILED':
        return 'Verify import specifiers and module exports. Ensure all referenced files exist and paths are correct.';
      case 'WORKER_BOOTSTRAP_FAILED':
        return 'Ensure worker bootstrap files are built and accessible. Check the RSC worker entry and Node flags.';
      default:
        return 'Check renderer and transpiler logs for detailed stack traces. This is typically a configuration or build pipeline issue.';
    }
  }
}

// ---------------------------------------------------------------------------
// Error Conversion & Introspection Utilities
// ---------------------------------------------------------------------------

/**
 * Helper to safely convert an unknown thrown value into a proper Error object.
 *
 * - Preserves existing Error/SourceOGBaseError instances.
 * - Normalizes string / primitive throws into Error.
 * - Falls back to a generic Error if stringification fails.
 */
export function toError(value: unknown): Error {
  if (value instanceof Error) return value;

  // Handle non-Error throws (strings, objects, etc.)
  try {
    return new Error(String(value));
  } catch {
    // Fallback for complex objects
    return new Error('An unknown error occurred.');
  }
}

/**
 * Type guard to check if an object is a SourceOG error.
 * Works across package boundaries via the isSourceOGError duck-typing flag.
 */
export function isSourceOGError(error: unknown): error is SourceOGBaseError {
  return (
    error instanceof SourceOGBaseError ||
    (typeof error === 'object' &&
      error !== null &&
      (error as any).isSourceOGError === true)
  );
}
