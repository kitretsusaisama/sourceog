// sourceog-renderer/src/orchestrator/admission-control.ts
// Alibaba CTO 2027 Standard — Admission Control & Load Shedding

import { WorkerPoolExhaustedError } from '@sourceog/genbook/errors';
import type { Priority } from './priority-queue.js';

/**
 * The result of an admission control check.
 */
export interface AdmissionDecision {
  /**
   * If true, the request is accepted into the queue.
   */
  accepted: boolean;

  /**
   * If false, contains the error to be thrown/rejected.
   */
  error?: Error;

  /**
   * Optional adjusted priority for the request.
   * Can be used to upgrade/downgrade priority under pressure.
   */
  priority?: Priority;
}

/**
 * Configuration for the admission controller.
 */
export interface AdmissionControlConfig {
  /**
   * Maximum depth of the queue before rejecting requests.
   */
  maxQueueDepth: number;

  /**
   * Maximum concurrent workers.
   */
  maxWorkers: number;

  /**
   * Threshold (0.0 - 1.0) at which to start shedding low-priority requests.
   * Defaults to 0.8 if not provided.
   */
  loadShedThreshold?: number;
}

/**
 * Determines if a request should be accepted based on current system load.
 *
 * This protects the system from becoming overwhelmed (cascade failure) by
 * failing fast when saturated. It implements:
 * 1. Total saturation check (tail drop).
 * 2. Smart load shedding for low-priority traffic.
 */
export class AdmissionController {
  private readonly config: AdmissionControlConfig;

  constructor(config: AdmissionControlConfig) {
    this.config = config;
  }

  /**
   * Evaluates a request against the current load.
   *
   * @param currentQueueDepth - The current number of items waiting in the queue.
   * @param currentWorkerUsage - The number of active workers.
   * @param priority - The priority of the incoming request.
   */
  public check(
    currentQueueDepth: number,
    currentWorkerUsage: number,
    priority: Priority,
  ): AdmissionDecision {
    const {
      maxQueueDepth,
      maxWorkers,
      loadShedThreshold = 0.8,
    } = this.config;

    const activeHandles = currentWorkerUsage + currentQueueDepth;
    const capacity = maxWorkers + maxQueueDepth;

    // 1. Total Saturation Check — Tail Drop
    // Reject once the pool has already admitted the maximum amount of work it
    // can safely track, even if a worker completion races with queue sampling.
    if (currentQueueDepth >= maxQueueDepth || activeHandles >= capacity) {
      return {
        accepted: false,
        error: new WorkerPoolExhaustedError(currentQueueDepth, maxWorkers),
      };
    }

    // 2. Load Shedding — Smart Saturation
    // As utilization approaches capacity, proactively reject low-priority traffic.
    const utilization = capacity > 0 ? activeHandles / capacity : 1;

    if (utilization >= loadShedThreshold) {
      // Shed Low and Deferred requests if we are above threshold.
      // Priority values:
      //   0 = Critical
      //   1 = High
      //   2 = Normal
      //   3 = Low
      //   4 = Deferred
      if (priority === 3 /* Low */ || priority === 4 /* Deferred */) {
        return {
          accepted: false,
          error: new WorkerPoolExhaustedError(currentQueueDepth, maxWorkers),
        };
      }
    }

    // 3. Accept all other requests.
    return {
      accepted: true,
      priority,
    };
  }
}
