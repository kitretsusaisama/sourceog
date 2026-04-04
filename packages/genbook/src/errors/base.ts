// packages/genbook/src/errors/base.ts
// Alibaba CTO 2027 Standard — Universal Error Contract

/**
 * High-level taxonomy for error classification.
 * Used by monitoring systems to aggregate and route alerts.
 */
export type ErrorCategory =
  | 'core'       // Critical infrastructure (Env, Config, Invariants)
  | 'render'     // Rendering pipeline (SSR, RSC, Flight)
  | 'transpile'  // Build-time or runtime transformation
  | 'network'    // Fetch, IO, or external service calls
  | 'manifest'   // Module maps, asset resolution
  | 'worker'     // Thread pool, process management
  | 'validation';// Input validation, user errors

/**
 * Severity levels for operational triage.
 */
export type ErrorSeverity = 
  | 'low'        // Informational, automatic recovery likely
  | 'medium'     // Recoverable, but degraded experience
  | 'high'       // Feature failure, requires intervention
  | 'critical';  // System instability, fatal to process

/**
 * Abstract base error for the entire SourceOG ecosystem.
 * 
 * Design Goals:
 * 1. Serializable: Safe for JSON.stringify (logs/telemetry).
 * 2. Actionable: Includes resolution hints for smarter tooling.
 * 3. Structured: Machine-readable codes over string matching.
 */
export abstract class SourceOGBaseError extends Error {
  /**
   * Unique machine-readable error code (e.g., 'RENDER_TIMEOUT').
   * Must be overridden by subclasses.
   */
  public abstract readonly code: string;

  /**
   * High-level classification for error grouping.
   */
  public abstract readonly category: ErrorCategory;

  /**
   * Operational severity level.
   * Defaults to 'medium' (recoverable error).
   */
  public readonly severity: ErrorSeverity = 'medium';

  /**
   * If true, the error is unrecoverable and the process/worker 
   * should likely terminate or restart.
   */
  public readonly isFatal: boolean = false;

  /**
   * ISO 8601 timestamp of error instantiation.
   */
  public readonly timestamp: string;

  /**
   * Arbitrary structured metadata (e.g., routeId, filePath, duration).
   * Must be JSON-serializable.
   */
  public readonly metadata: Record<string, unknown>;

  /**
   * Flag to identify SourceOG errors via `instanceof` checks across
   * package boundaries (duck typing fallback).
   */
  public readonly isSourceOGError = true;

  constructor(
    message: string,
    options?: {
      cause?: unknown;
      metadata?: Record<string, unknown>;
    }
  ) {
    // Maintains proper stack trace in V8 environments
    super(message, options?.cause ? { cause: options.cause } : undefined);
    
    this.timestamp = new Date().toISOString();
    this.metadata = options?.metadata ?? {};

    // Correct the prototype chain for instanceof checks
    Object.setPrototypeOf(this, new.target.prototype);

    // Capture stack trace (excludes constructor from trace)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Optimistic Tuning: Provides actionable context for debugging tools.
   * Subclasses should override this to suggest specific fixes.
   * 
   * @example
   * return "Check if the 'tsx' package is installed correctly.";
   */
  public get resolutionHint(): string | null {
    return null;
  }

  /**
   * Converts the error to a plain object for logging/telemetry.
   * Handles circular references and nested errors gracefully.
   */
  public toJSON(): Record<string, unknown> {
    const cause = this.cause;
    let causeData: unknown = undefined;

    // Recursively serialize nested SourceOG errors
    if (cause instanceof SourceOGBaseError) {
      causeData = cause.toJSON();
    } else if (cause instanceof Error) {
      causeData = {
        name: cause.name,
        message: cause.message,
        stack: cause.stack,
      };
    } else if (cause) {
      causeData = String(cause);
    }

    return {
      type: this.constructor.name,
      code: this.code,
      category: this.category,
      severity: this.severity,
      isFatal: this.isFatal,
      message: this.message,
      metadata: this.metadata,
      resolutionHint: this.resolutionHint,
      timestamp: this.timestamp,
      stack: this.stack,
      cause: causeData,
    };
  }
}