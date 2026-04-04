// sourceog-renderer/src/workers/worker-router.ts
// Alibaba CTO 2027 Standard — Worker Thread Request Router
//
// CENTRAL DISPATCHER for all worker-to-parent communication. Handles:
// 1. **Message Validation** (type guards, schema enforcement)
// 2. **Render Mutex** (strict single-render-at-a-time serialization)
// 3. **Flight Render Orchestration** (components → RSC chunks)
// 4. **Structured Error Propagation** (typed error payloads)
// 5. **Health Ping Responses** (lifecycle integration)
//
// CONTRACT: Stateless, pure functions. No shared mutable state beyond mutex.

import type { MessagePort } from 'node:worker_threads';
import type {
  WorkerRenderRequest,
  WorkerMessage,
} from '../types/messages.js';
import type { WorkerRenderResponse } from '../types/internal.js';
import type { NormalizedClientManifest } from '@sourceog/genbook';

import React from 'react';
import { invariant } from '@sourceog/genbook';
import { RenderError, toError } from '../core/errors.js';
import { logger } from '../core/logger.js';
import { workerHealth } from './worker-health.js';
import { WorkerLifecycle } from './worker-lifecycle.js';

// Compat layer (legacy worker contracts)
import { resolveRouteComponents } from '../rsc/compat-route-loader.js';
import { renderFlight } from '../rsc/compat-renderer.js';

// Singleton instances (injected during worker bootstrap)
const lifecycle = new WorkerLifecycle();
let clientManifest: NormalizedClientManifest;

export function initializeWorkerRouter(port: MessagePort): void {
  lifecycle.ready(port);
}

// ---------------------------------------------------------------------------
// Render Serialization Mutex
// ---------------------------------------------------------------------------
// Ensures chunks from concurrent renders don't interleave on parentPort.

let renderMutex: Promise<unknown> = Promise.resolve();

async function withRenderMutex<T>(task: () => Promise<T>): Promise<T> {
  const resultPromise = renderMutex.then(task);
  renderMutex = resultPromise.catch(() => {}); // Prevent unhandled rejection chain breakage
  return resultPromise;
}

// ---------------------------------------------------------------------------
// Message Dispatcher
// ---------------------------------------------------------------------------

/**
 * Main entry point. Dispatches validated messages to handlers.
 */
export async function handleRenderRequest(
  message: unknown,
  manifest: NormalizedClientManifest,
  port: MessagePort,
): Promise<void> {
  clientManifest = manifest;

  if (!isWorkerMessage(message)) {
    logger.debug('Dropping invalid worker message', { type: typeof message });
    return;
  }

  const msg = message;

  try {
    await dispatchMessage(msg, port);
  } catch (error) {
    const normalized = toError(error);
    const errorCode =
      typeof (normalized as { code?: unknown }).code === 'string'
        ? ((normalized as unknown as { code: string }).code)
        : undefined;

    logger.error('Worker router uncaught error', normalized, {
      messageType: msg.type,
    });

    if (msg.type === 'render' && typeof msg.requestId === 'string') {
      const renderMsg = msg as WorkerRenderRequest;

      port.postMessage({
        type: 'render_error',
        requestId: renderMsg.requestId,
        route: renderMsg.payload.route.id,
        pathname: renderMsg.payload.route.pathname,
        renderContextKey: renderMsg.payload.context.renderContextKey,
        error: normalized.message || 'Internal worker error',
        code: errorCode || 'WORKER_RENDER_FAILURE',
        stack: normalized.stack,
      });
      return;
    }

    port.postMessage({
      type: 'render_error',
      requestId: msg.requestId ?? 'unknown',
      route: 'unknown',
      pathname: 'unknown',
      renderContextKey: 'unknown',
      error: normalized.message || 'Internal worker error',
      code: errorCode || 'WORKER_INTERNAL_ERROR',
      stack: normalized.stack,
    });
  }
}

/**
 * Routes messages to handlers based on type.
 */
async function dispatchMessage(
  msg: { type: string; requestId?: string },
  port: MessagePort,
): Promise<void> {
  switch (msg.type) {
    case 'health_ping':
      await handleHealthPing(port);
      break;
    case 'render':
      await handleRenderRequestImpl(msg as WorkerRenderRequest, port);
      break;
    case 'shutdown':
      await handleShutdown(port);
      break;
    default:
      logger.warn(`Unknown worker message type: ${msg.type}`);
  }
}

// ---------------------------------------------------------------------------
// Message Handlers
// ---------------------------------------------------------------------------

async function handleHealthPing(port: MessagePort): Promise<void> {
  const requestsHandled = 0;
  workerHealth.recordPong(process.pid, requestsHandled);

  port.postMessage({
    type: 'health_pong',
    threadId: process.pid,
    timestamp: Date.now(),
    requestsHandled,
  });
}

async function handleRenderRequestImpl(
  msg: WorkerRenderRequest,
  port: MessagePort,
): Promise<void> {
  // 1. Lifecycle gate (reject if not ready)
  if (!lifecycle.isAcceptingWork()) {
    port.postMessage({
      type: 'render_error',
      requestId: msg.requestId,
      error: 'Worker not accepting requests (shutting down)',
      code: 'WORKER_UNAVAILABLE',
    });
    return;
  }

  // 2. Claim mutex + lifecycle state
  lifecycle.beginRender();
  try {
    await withRenderMutex(async () => {
      const result = await executeRender(msg.payload);
      port.postMessage({
        type: 'render_result',
        requestId: msg.requestId,
        route: msg.payload.route.id,
        pathname: msg.payload.route.pathname,
        renderContextKey: msg.payload.context.renderContextKey,
        result,
      });
    });
  } finally {
    lifecycle.endRender();
  }
}

async function handleShutdown(port: MessagePort): Promise<void> {
  lifecycle.shutdown();
  port.postMessage({ type: 'shutdown_ack' });
}

// ---------------------------------------------------------------------------
// Core Render Execution
// ---------------------------------------------------------------------------

async function executeRender(
  payload: WorkerRenderRequest['payload'],
): Promise<WorkerRenderResponse> {
  const { route, context, timeoutMs = 5000 } = payload;

  invariant(route?.id, 'Missing route.id');
  invariant(clientManifest, 'Client manifest unavailable');

  const runtimeGlobals = globalThis as typeof globalThis & {
    __SOURCEOG_RSC_WORKER__?: boolean;
    __SOURCEOG_CLIENT_REFERENCE_MANIFEST__?: NormalizedClientManifest;
  };
  const previousWorkerFlag = runtimeGlobals.__SOURCEOG_RSC_WORKER__;
  const previousManifest = runtimeGlobals.__SOURCEOG_CLIENT_REFERENCE_MANIFEST__;
  runtimeGlobals.__SOURCEOG_RSC_WORKER__ = true;
  runtimeGlobals.__SOURCEOG_CLIENT_REFERENCE_MANIFEST__ = clientManifest;

  try {
    const components = await resolveRouteComponents(route);

    const element = React.createElement(
      components.component as React.ComponentType<{ params: Record<string, string>; searchParams: Record<string, string>; }>,
      {
        params: context.params ?? {},
        searchParams: Object.fromEntries(context.query ?? []),
      }
    );

    const chunks = await renderFlight(element, clientManifest, {
      routeId: route.id,
      timeoutMs,
    });

    return {
      format: 'react-flight-text',
      chunks,
      usedClientRefs: [],
    };
  } finally {
    runtimeGlobals.__SOURCEOG_RSC_WORKER__ = previousWorkerFlag;
    runtimeGlobals.__SOURCEOG_CLIENT_REFERENCE_MANIFEST__ = previousManifest;
  }
}

// ---------------------------------------------------------------------------
// Type Guards & Utilities
// ---------------------------------------------------------------------------

function isWorkerMessage(msg: unknown): msg is { type: string; requestId?: string } {
  return (
    msg !== null &&
    typeof msg === 'object' &&
    'type' in msg &&
    typeof (msg as { type: unknown }).type === 'string'
  );
}
