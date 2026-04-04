// packages/genbook/src/errors/worker.errors.ts
// Alibaba CTO 2027 Standard — Worker & Orchestration Errors

import { SourceOGBaseError, ErrorCategory, ErrorSeverity } from './base.js';

/**
 * Base class for errors related to worker_threads, process management,
 * and thread pool orchestration.
 */
export abstract class WorkerBaseError extends SourceOGBaseError {
  public readonly category: ErrorCategory = 'worker';
  public readonly severity: ErrorSeverity = 'high';
  public readonly isFatal = false;
}

/**
 * Thrown when the worker pool queue is saturated and cannot accept new requests.
 * Implements "Admission Control" to prevent cascading failures.
 */
export class WorkerPoolExhaustedError extends WorkerBaseError {
  public readonly code = 'POOL_EXHAUSTED';

  constructor(
    public readonly queueDepth: number,
    public readonly maxWorkers: number
  ) {
    super(
      `[SOURCEOG-FALLBACK] Worker pool exhausted. Queue is full (depth: ${queueDepth}) with ${maxWorkers} active workers.`,
      { metadata: { queueDepth, maxWorkers } }
    );
  }

  public override get resolutionHint(): string {
    return 'Optimize component render times, increase SOURCEOG_RSC_WORKERS count, or implement request throttling at the edge.';
  }
}

/**
 * Thrown when the system fails to spawn a new worker thread.
 * This can happen due to resource limits (memory, file descriptors) or missing entry files.
 */
export class WorkerSpawnError extends WorkerBaseError {
  public readonly code = 'WORKER_SPAWN_FAILED';
  public readonly severity: ErrorSeverity = 'critical';

  constructor(
    public readonly workerPath: string,
    cause: unknown
  ) {
    const errorMessage = cause instanceof Error ? cause.message : String(cause);
    super(
      `Failed to spawn worker at "${workerPath}": ${errorMessage}`,
      { cause, metadata: { workerPath } }
    );
  }

  public override get resolutionHint(): string {
    return `Verify the file "${this.workerPath}" exists and is valid JavaScript. Check system memory limits (ulimit).`;
  }
}

/**
 * Thrown when a worker process exits unexpectedly during operation.
 */
export class WorkerUnexpectedExitError extends WorkerBaseError {
  public readonly code = 'WORKER_UNEXPECTED_EXIT';

  constructor(
    public readonly workerId: number,
    public readonly exitCode: number | null,
    public readonly signal: string | null
  ) {
    super(
      `Worker ${workerId} exited unexpectedly with code ${exitCode ?? 'null'} (signal: ${signal ?? 'none'}).`,
      { metadata: { workerId, exitCode, signal } }
    );
  }

  public override get resolutionHint(): string {
    if (this.signal === 'SIGKILL' || this.signal === 'SIGABRT') {
      return 'Worker was likely killed by the OS (Out of Memory). Check memory consumption.';
    }
    return 'Check stderr logs for unhandled exceptions or uncaught promise rejections inside the worker.';
  }
}

/**
 * Thrown when a request times out while waiting for an available worker slot
 * (Queue Timeout), distinct from the render execution timeout.
 */
export class WorkerQueueTimeoutError extends WorkerBaseError {
  public readonly code = 'WORKER_QUEUE_TIMEOUT';

  constructor(
    public readonly routeId: string,
    public readonly waitTimeMs: number
  ) {
    super(
      `[SOURCEOG-FALLBACK] Request for route "${routeId}" timed out after waiting ${waitTimeMs}ms for an available worker.`,
      { metadata: { routeId, waitTimeMs } }
    );
  }

  public override get resolutionHint(): string {
    return 'The server is under high load. Consider increasing queue timeout (SOURCEOG_RSC_TIMEOUT_MS) or vertical scaling.';
  }
}

/**
 * Thrown when the message channel between main thread and worker fails
 * (e.g., serialization error, port closed).
 */
export class WorkerCommunicationError extends WorkerBaseError {
  public readonly code = 'WORKER_COMM_FAILURE';

  constructor(
    public readonly workerId: number,
    public readonly reason: string
  ) {
    super(
      `Communication failed with worker ${workerId}: ${reason}`,
      { metadata: { workerId, reason } }
    );
  }

  public override get resolutionHint(): string {
    return 'This usually indicates a serialization issue (e.g., passing a function or large buffer) in postMessage.';
  }
}
