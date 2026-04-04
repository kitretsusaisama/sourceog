// sourceog-renderer/src/orchestrator/priority-queue.ts
// Alibaba CTO 2027 Standard — Priority-Based Queue

import { LinkedQueue, type QueuedRenderRequest } from './request-queue.js';

/**
 * Priority levels for render requests.
 * Lower numeric value = higher priority (executed first).
 */
export enum Priority {
  Critical = 0,
  High = 1,
  Normal = 2,
  Low = 3,
  Deferred = 4,
}

/**
 * A specialized queue that categorizes requests into priority bands.
 *
 * Internally uses multiple LinkedQueues (one per priority level) to ensure:
 * - O(1) enqueue by priority.
 * - O(1) dequeue across all priorities.
 * - O(1) removal when a specific request is cancelled/timed out.
 */
export class PriorityQueue {
  private readonly queues: Map<Priority, LinkedQueue> = new Map();
  private _size = 0;

  constructor() {
    // Initialize queues for all defined priorities
    (Object.values(Priority) as Array<Priority>)
      .filter((p): p is Priority => typeof p === 'number')
      .forEach((p) => {
        this.queues.set(p, new LinkedQueue());
      });
  }

  /**
   * Total number of requests across all priority queues.
   */
  get size(): number {
    return this._size;
  }

  /**
   * Adds a request to the queue based on its priority.
   */
  enqueue(request: QueuedRenderRequest, priority: Priority = Priority.Normal): void {
    const queue = this.queues.get(priority);
    if (!queue) {
      throw new Error(`Unknown priority level: ${priority}`);
    }

    queue.push(request);
    this._size++;
  }

  /**
   * Removes and returns the highest-priority request available.
   *
   * Iterates from Priority.Critical (0) upwards.
   */
  dequeue(): QueuedRenderRequest | undefined {
    for (const [, queue] of this.queues) {
      if (queue.size > 0) {
        const item = queue.shift();
        if (item) {
          this._size--;
          return item;
        }
      }
    }
    return undefined;
  }

  /**
   * Removes a specific request from its priority queue.
   *
   * We check all queues because we don't store priority on the request object
   * here (though we could optimize by adding priority to the request metadata).
   *
   * @returns True if removed, false if not found.
   */
  remove(request: QueuedRenderRequest): boolean {
    for (const [, queue] of this.queues) {
      if (request.node) {
        const removed = queue.remove(request.node);
        if (removed) {
          this._size--;
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Drains all queues and returns all requests.
   *
   * Useful during shutdown or when cancelling all pending work.
   */
  drain(): QueuedRenderRequest[] {
    const items: QueuedRenderRequest[] = [];

    for (const [, queue] of this.queues) {
      items.push(...queue.drain());
    }

    this._size = 0;
    return items;
  }
}