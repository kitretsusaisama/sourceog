// sourceog-renderer/src/orchestrator/scheduler.ts
// Alibaba CTO 2027 Standard — Worker Scheduling & Dispatch

import type { PriorityQueue } from './priority-queue.js';
import type { PooledWorker } from './worker-pool.js'; // forward reference
import type {
  WorkerRenderRequest,
  WorkerMessage,
} from '../types/messages.js';
import type { QueuedRenderRequest } from './request-queue.js';
import { logger } from '../core/logger.js';

/**
 * Interface for the Worker Pool dependency.
 * Narrowly typed to what the scheduler actually needs.
 */
export interface WorkerPoolInterface {
  workers: PooledWorker[];
}

/**
 * The Scheduler is the active agent that moves requests from the Queue
 * to the Workers.
 *
 * It implements the Pull model:
 * - Whenever a worker becomes idle, the scheduler attempts to pull the
 *   highest-priority request from the queue and assign it.
 */
export class Scheduler {
  private readonly queue: PriorityQueue;
  private readonly getWorkers: () => PooledWorker[];

  constructor(queue: PriorityQueue, getWorkers: () => PooledWorker[]) {
    this.queue = queue;
    this.getWorkers = getWorkers;
  }

  /**
   * Main dispatch loop.
   *
   * Attempts to assign work to all available idle workers.
   * @returns The number of workers that were dispatched.
   */
  public dispatch(): number {
    let dispatchedCount = 0;

    // Continue dispatching as long as we have queue items and idle workers.
    while (this.queue.size > 0) {
      const idleWorker = this.findIdleWorker();
      if (!idleWorker) break; // No free workers

      const request = this.queue.dequeue();
      if (!request) break; // Queue empty (race condition safety)

      this.assignWork(idleWorker, request);
      dispatchedCount++;
    }

    return dispatchedCount;
  }

  /**
   * Finds the first available idle worker.
   */
  private findIdleWorker(): PooledWorker | undefined {
    return this.getWorkers().find((w) => !w.busy && !w.stopping);
  }

  /**
   * Assigns a specific render request to a worker.
   */
  private assignWork(worker: PooledWorker, request: QueuedRenderRequest): void {
    // Clear the queue timeout (admission control timeout).
    clearTimeout(request.queueTimeout);

    worker.busy = true;
    worker.requestCount += 1;
    worker.lastUsed = Date.now();

    worker.current = {
      requestId: request.requestId,
      payload: request.payload,
      resolve: request.resolve,
      reject: request.reject,
      renderTimeout: setTimeout(() => {
        // This will trigger the failure handler in the pool.
        worker.worker.emit(
          'error',
          new Error(`Render timeout for route ${request.payload.route.id}`),
        );
      }, request.renderTimeoutMs),
      collectedChunks: [] as string[],
      chunkCount: 0,
      onChunk: request.onChunk,
      collectChunks: request.collectChunks,
    };

    const msg: WorkerRenderRequest = {
      type: 'render',
      requestId: request.requestId,
      payload: request.payload,
    };

    logger.debug('Dispatching request to worker', {
      requestId: request.requestId,
      routeId: request.payload.route.id,
      threadId: worker.worker.threadId,
    });

    worker.worker.postMessage(msg as unknown as WorkerMessage);
  }
}
