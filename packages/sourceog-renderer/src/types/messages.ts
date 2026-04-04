// sourceog-renderer/src/types/messages.ts
// Alibaba CTO 2027 Standard — Worker Wire Protocols

import type { WorkerRouteDefinition, WorkerRequestContext, WorkerRenderResponse } from './internal.js';

/**
 * The request payload sent from the main thread to the worker.
 * Uses a discriminated union ('type') to allow for future command extensions.
 */
export interface WorkerRenderRequest {
  readonly type: 'render';
  readonly requestId: string;
  readonly payload: {
    readonly runtimeTarget: 'node' | 'edge';
    readonly route: WorkerRouteDefinition;
    readonly parallelRoutes: Readonly<Record<string, WorkerRouteDefinition>>;
    readonly context: WorkerRequestContext & {
      readonly renderContextKey: string;
      readonly renderContext?: string;
    };
    readonly collectChunks?: boolean;
    readonly timeoutMs?: number;
  };
}

/**
 * Streaming chunk emitted by the worker during rendering.
 * Sent in real-time if `collectChunks` is false or streaming is active.
 */
export interface WorkerRenderChunkMessage {
  readonly type: 'render_chunk';
  readonly requestId: string;
  readonly route: string;
  readonly pathname: string;
  readonly renderContextKey: string;
  readonly chunk: string;
}

/**
 * Successful completion message from the worker.
 * Includes the final render result matching the WorkerRenderResponse contract.
 */
export interface WorkerRenderResultMessage {
  readonly type: 'render_result';
  readonly requestId: string;
  readonly route: string;
  readonly pathname: string;
  readonly renderContextKey: string;
  readonly result: WorkerRenderResponse;
}

/**
 * Error message sent from the worker to the main thread.
 * Standardizes error transport across thread boundaries using Genbook error codes.
 */
export interface WorkerRenderErrorMessage {
  readonly type: 'render_error';
  readonly requestId: string;
  readonly route: string;
  readonly pathname: string;
  readonly renderContextKey: string;
  readonly error: string;
  readonly code: string; // Machine-readable error code from Genbook
  readonly stack?: string;
}

/**
 * Discriminant union of all possible messages sent from Worker -> Main Thread.
 */
export type WorkerMessage =
  | WorkerRenderChunkMessage
  | WorkerRenderResultMessage
  | WorkerRenderErrorMessage;

/**
 * Discriminant union of all possible messages sent from Main Thread -> Worker.
 */
export type ParentMessage = WorkerRenderRequest;