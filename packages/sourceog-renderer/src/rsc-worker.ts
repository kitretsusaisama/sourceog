/**
 * sourceog-renderer/src/rsc-worker.ts
 *
 * Production-grade RSC message router for Node runtime.
 * Bridges worker_threads with the isolated render engine (rsc-worker-core).
 *
 * Responsibilities:
 * - Type-safe message routing via discriminated unions.
 * - Render Mutex: Serializes concurrent render messages so chunk streams 
 *   from Route A don't interleave with chunks from Route B on parentPort.
 * - Structured success/error payloads including route + renderContextKey.
 * 
 * Notes:
 * - Does NOT contain rendering logic (delegates to rsc-worker-core).
 * - Does NOT contain transpiler logic (delegates to rsc-worker-core).
 */

import { workerData, parentPort, isMainThread, type MessagePort } from "node:worker_threads";
import {
  loadManifestFromPath,
  normalizeClientManifest,
  renderFlightStream,
  toError,
  type WorkerRenderRequest,
  type WorkerRenderResponse,
} from "./rsc-worker-core.js";


if (isMainThread) {
  throw new Error("This module can only be run as a Worker");
}

// ---------------------------------------------------------------------------
// Strict Typed Messages (Discriminated Unions)
// ---------------------------------------------------------------------------

type ParentRenderChunkMessage = {
  type: "render_chunk";
  requestId: string;
  route: string;
  pathname: string;
  renderContextKey: string;
  chunk: string;
};

type ParentRenderResultMessage = {
  type: "render_result";
  requestId: string;
  route: string;
  pathname: string;
  renderContextKey: string;
  result: WorkerRenderResponse;
};

type ParentRenderErrorMessage = {
  type: "render_error";
  requestId: string;
  route: string;
  pathname: string;
  renderContextKey: string;
  error: string;
  stack?: string;
};

type ParentMessage = 
  | ParentRenderChunkMessage 
  | ParentRenderResultMessage 
  | ParentRenderErrorMessage;

function getParentPort(): MessagePort {
  if (parentPort == null) {
    throw new Error("RSC worker requires parentPort");
  }
  return parentPort;
}

function safePostMessage(message: ParentMessage): void {
  const port = getParentPort();
  port.postMessage(message);
}

// ---------------------------------------------------------------------------
// Manifest Initialization (Once per worker lifetime)
// ---------------------------------------------------------------------------

const rawManifest = loadManifestFromPath(String(workerData?.manifestPath ?? ""));
const manifestForRender = normalizeClientManifest(rawManifest);

// ---------------------------------------------------------------------------
// Render Mutex (Prevents chunk interleaving)
// ---------------------------------------------------------------------------

let renderMutex: Promise<unknown> = Promise.resolve();

/**
 * Wraps render execution in a mutex. Ensures that if two render requests 
 * arrive concurrently, their `render_chunk` postMessage calls are strictly 
 * serialized so the parent pool doesn't mix up chunks.
 */
function enqueueRender<T>(task: () => Promise<T>): Promise<T> {
  const chain = renderMutex.then(() => task());
  renderMutex = chain.catch(() => undefined);
  return chain;
}
// ---------------------------------------------------------------------------
// Core Message Handler
// ---------------------------------------------------------------------------

async function handleRender(requestId: string, payload: WorkerRenderRequest): Promise<void> {
  const routeId = payload.route?.id ?? "unknown-route";
  const pathname = payload.route?.pathname ?? "";
  const renderContextKey = payload.context?.renderContextKey ?? "unknown-context";

  try {
    const result = await renderFlightStream(
      requestId,
      payload,
      manifestForRender,
      (chunk) => {
        safePostMessage({
          type: "render_chunk",
          requestId,
          route: routeId,
          pathname,
          renderContextKey,
          chunk,
        });
      }
    );

    safePostMessage({
      type: "render_result",
      requestId,
      route: routeId,
      pathname,
      renderContextKey,
      result,
    });
  } catch (error) {
    const err = toError(error);

    safePostMessage({
      type: "render_error",
      requestId,
      route: routeId,
      pathname,
      renderContextKey,
      error: err.message,
      stack: err.stack,
    });
  }
}

export async function handleWorkerMessage(message: {
  type: string;
  requestId: string;
  payload: WorkerRenderRequest;
}): Promise<void> {
  if (message.type !== "render") return;
  
  // Pass through the mutex to prevent stream interleaving
  return enqueueRender(() => handleRender(message.requestId, message.payload));
}