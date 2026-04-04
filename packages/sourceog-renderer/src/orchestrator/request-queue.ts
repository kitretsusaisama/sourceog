// sourceog-renderer/src/orchestrator/request-queue.ts
// Alibaba CTO 2027 Standard — O(1) Doubly Linked Request Queue

import type { WorkerRenderRequest } from '../types/messages.js';

/**
 * Internal payload for a queued render request.
 */
export interface QueuedRenderRequest {
  requestId: string;
  payload: WorkerRenderRequest['payload'];
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  queueTimeout: NodeJS.Timeout;
  renderTimeoutMs: number;
  onChunk?: (chunk: string) => void;
  collectChunks: boolean;
  /**
   * Back-reference to the node for O(1) removal.
   * This is set by the LinkedQueue implementation.
   */
  node?: QueueNode;
}

/**
 * Node for the doubly linked list.
 */
interface QueueNode {
  value: QueuedRenderRequest;
  prev: QueueNode | null;
  next: QueueNode | null;
}

/**
 * High-performance O(1) queue implementation using a doubly linked list.
 *
 * Why not Array?
 * - Array.shift() is O(n).
 * - Array.splice(index, 1) is O(n).
 * - This implementation ensures constant time for add, remove, and drain
 *   operations, critical for high-throughput worker pool management.
 */
export class LinkedQueue {
  private head: QueueNode | null = null;
  private tail: QueueNode | null = null;
  private _size = 0;

  /**
   * Current number of items in the queue.
   */
  get size(): number {
    return this._size;
  }

  /**
   * Adds a request to the end of the queue.
   * @returns The node reference, needed for O(1) removal later.
   */
  push(value: QueuedRenderRequest): QueueNode {
    const node: QueueNode = { value, prev: this.tail, next: null };

    // Store back-reference
    value.node = node;

    if (this.tail) {
      this.tail.next = node;
    } else {
      this.head = node;
    }
    this.tail = node;
    this._size++;

    return node;
  }

  /**
   * Removes and returns the request from the front of the queue.
   */
  shift(): QueuedRenderRequest | undefined {
    if (!this.head) return undefined;

    const value = this.head.value;
    this.head = this.head.next;

    if (this.head) {
      this.head.prev = null;
    } else {
      this.tail = null;
    }

    this._size--;
    value.node = undefined; // Clean up reference
    return value;
  }

  /**
   * Removes a specific request from the queue.
   * Used primarily for request cancellation or timeouts.
   *
   * @param node - The node reference returned by `push`.
   * @returns True if removed, false if not found.
   */
  remove(node: QueueNode): boolean {
    // Validate node is still part of this queue
    if (node.prev === null && node.next === null && this.head !== node) {
      return false;
    }

    if (node.prev) {
      node.prev.next = node.next;
    } else if (this.head === node) {
      this.head = node.next;
    }

    if (node.next) {
      node.next.prev = node.prev;
    } else if (this.tail === node) {
      this.tail = node.prev;
    }

    node.prev = null;
    node.next = null;
    node.value.node = undefined;

    this._size--;
    return true;
  }

  /**
   * Clears the queue and returns all items.
   * Useful during shutdown or when cancelling all pending work.
   */
  drain(): QueuedRenderRequest[] {
    const items: QueuedRenderRequest[] = [];
    let current = this.head;

    while (current) {
      items.push(current.value);
      current.value.node = undefined; // cleanup
      current = current.next;
    }

    this.head = this.tail = null;
    this._size = 0;

    return items;
  }
}