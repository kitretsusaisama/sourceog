// packages/genbook/src/errors/render.errors.ts
// Alibaba CTO 2027 Standard — Rendering Pipeline Errors

import { SourceOGBaseError, ErrorCategory, ErrorSeverity } from './base.js';

/**
 * Base class for errors occurring during the rendering lifecycle.
 * These errors generally affect a specific route or request but are not
 * fatal to the entire process.
 */
export abstract class RenderBaseError extends SourceOGBaseError {
  public readonly category: ErrorCategory = 'render';
  public readonly severity: ErrorSeverity = 'high';
  public readonly isFatal: boolean = false;
}

/**
 * Thrown when a render operation exceeds the allocated time budget.
 * Critical for maintaining Time-To-Interactive (TTI) SLAs.
 */
export class RenderTimeoutError extends RenderBaseError {
  public readonly code = 'RENDER_TIMEOUT';

  constructor(
    public readonly routeId: string,
    public readonly timeoutMs: number,
    public readonly segmentId?: string
  ) {
    super(
      `Render timed out after ${timeoutMs}ms for route "${routeId}"${segmentId ? ` (segment: ${segmentId})` : ''}.`,
      { metadata: { routeId, timeoutMs, segmentId } }
    );
  }

  public override get resolutionHint(): string {
    return `Profile the component tree for "${this.routeId}". Check for synchronous heavy computations or unawaited promises in data fetching.`;
  }
}

/**
 * Thrown when a render stream is aborted prematurely.
 * This often happens if the client disconnects or the server initiates a shutdown.
 */
export class RenderAbortError extends RenderBaseError {
  public readonly code = 'RENDER_ABORTED';

  constructor(
    public readonly routeId: string,
    public readonly reason: 'client_disconnect' | 'server_shutdown' | 'unknown'
  ) {
    super(`Render aborted for route "${routeId}" due to ${reason}.`, {
      metadata: { routeId, reason },
    });
  }

  public override get resolutionHint(): string {
    if (this.reason === 'client_disconnect') {
      return 'No action required. The client navigated away before rendering completed.';
    }
    return 'Check server health logs. The render was interrupted by a system signal.';
  }
}

/**
 * Thrown when a React component throws during server-side rendering.
 */
export class ComponentRenderError extends RenderBaseError {
  public readonly code = 'COMPONENT_FAILURE';

  constructor(
    public readonly routeId: string,
    public readonly componentTrace: string,
    cause: unknown
  ) {
    const errorMessage = cause instanceof Error ? cause.message : String(cause);
    super(
      `Component failed to render in route "${routeId}": ${errorMessage}`,
      { cause, metadata: { routeId, componentTrace } }
    );
  }

  public override get resolutionHint(): string {
    return `Review the component stack trace. Error originated near: "${this.componentTrace}".`;
  }
}

/**
 * Thrown when the RSC (React Server Components) flight stream encounters
 * serialization issues (e.g., non-serializable props).
 */
export class FlightSerializationError extends RenderBaseError {
  public readonly code = 'FLIGHT_SERIALIZE_FAILURE';

  constructor(
    public readonly routeId: string,
    public readonly invalidProperty: string
  ) {
    super(
      `Failed to serialize props for route "${routeId}". Property "${invalidProperty}" is not serializable.`,
      { metadata: { routeId, invalidProperty } }
    );
  }

  public override get resolutionHint(): string {
    return `Ensure all props passed from server to client components are JSON-serializable (strings, numbers, arrays, plain objects). Check "${this.invalidProperty}".`;
  }
}

/**
 * Thrown when the rendering engine encounters an invalid state or configuration
 * (e.g., missing Manifest).
 */
export class RenderConfigError extends RenderBaseError {
  public readonly code = 'RENDER_CONFIG_INVALID';
  public readonly severity: ErrorSeverity = 'critical';
  public readonly isFatal = true;

  constructor(message: string, metadata?: Record<string, unknown>) {
    super(message, { metadata });
  }
}

/**
 * General-purpose render error for use in renderer internals.
 */
export class RenderError extends RenderBaseError {
  public readonly code: string;

  constructor(
    code: string,
    message: string,
    public readonly routeId?: string,
    metadata?: Record<string, unknown>
  ) {
    super(message, { metadata: { code, routeId, ...metadata } });
    this.code = code;
  }
}