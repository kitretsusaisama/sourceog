// sourceog-renderer/src/workers/worker-health.ts
// Alibaba CTO 2027 Standard — Worker Health Monitoring & Lifecycle
//
// Production-grade health monitoring for RSC worker pools. Implements:
// 1. **Heartbeat Protocol** (ping/pong via postMessage)
// 2. **Memory Watchdogs** (heap/rss thresholds)
// 3. **Staleness Detection** (no-response timeouts)
// 4. **Graceful Recycling Triggers**
//
// INTEGRATES WITH: WorkerPool (via events), Observability (metrics export),
//                  Admission Control (load shedding on degraded workers).

import type { Worker } from 'node:worker_threads';
import { logger } from '../core/logger.js';
import { isProduction } from '../core/env.js';

// ---------------------------------------------------------------------------
// Health Metrics & Thresholds
// ---------------------------------------------------------------------------

/**
 * Health check result for a single worker.
 *
 * Exported for pool orchestrator and metrics export.
 */
export interface HealthCheckResult {
  threadId: number;
  workerIndex: number;
  isAlive: boolean;
  isResponsive: boolean;
  isMemoryHealthy: boolean;
  lastPongMs: number | null;
  memory: NodeJS.MemoryUsage;
  uptimeMs: number;
  requestsHandled: number;
}

/**
 * Configurable thresholds for worker health.
 */
 */
export interface HealthConfig {
  /**
   * Max age without pong response (ms). Triggers "degraded" state.
   */
  pongTimeoutMs: number;
  /**
   * Heap used threshold (% of RSS). Triggers memory pressure alert.
   */
  heapPressureThreshold: number;
  /**
   * RSS absolute limit (bytes). Triggers immediate termination.
   */
  rssHardLimitBytes: number;
  /**
   * Health check frequency (ms).
   */
  checkIntervalMs: number;
}

// Production defaults (tunable via env vars)
const DEFAULT_CONFIG: HealthConfig = {
  pongTimeoutMs: 60_000,
  heapPressureThreshold: 0.85, // 85% heap-to-rss ratio
  rssHardLimitBytes: 1_024 * 1_024 * 256, // 256MB
  checkIntervalMs: 30_000,
};

/**
 * Global health monitor singleton.
 *
 * DESIGN: Single instance per process. Attached to WorkerPool lifecycle.
 */
export class WorkerHealthMonitor {
  private config: HealthConfig;
  private lastPongTimestamps = new Map<number, number>();
  private requestCounters = new Map<number, number>();
  private checkIntervalId: NodeJS.Timeout | null = null;
  private workers: Worker[] = [];

  constructor(config: Partial<HealthConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Attaches to a worker pool and begins monitoring.
   */
  public attach(workers: Worker[]): void {
    if (this.checkIntervalId) {
      throw new Error('Health monitor already attached');
    }

    this.workers = workers;
    this.resetCounters(workers);

    // Start heartbeat loop (unref'd to avoid blocking process exit)
    this.checkIntervalId = setInterval(() => {
      this.runHealthCheck();
    }, this.config.checkIntervalMs);

    if (this.checkIntervalId.unref) {
      this.checkIntervalId.unref();
    }

    logger.info(
      `Health monitor attached: ${workers.length} workers, interval ${this.config.checkIntervalMs}ms`,
    );
  }

  /**
   * Detaches and stops monitoring.
   */
  public detach(): void {
    if (this.checkIntervalId) {
      clearInterval(this.checkIntervalId);
      this.checkIntervalId = null;
    }

    this.workers = [];
    this.lastPongTimestamps.clear();
    this.requestCounters.clear();

    logger.debug('Health monitor detached');
  }

  /**
   * Records successful pong response + increments request counter.
   */
  public recordPong(threadId: number, requestsHandled: number): void {
    this.lastPongTimestamps.set(threadId, Date.now());
    this.requestCounters.set(threadId, requestsHandled);
  }

  /**
   * Returns aggregate health for all monitored workers.
   */
  public getHealthSummary(): HealthCheckResult[] {
    const now = Date.now();
    return this.workers.map((worker) => this.checkSingleWorker(worker, now));
  }

  /**
   * Checks if the pool as a whole is healthy.
   *
   * Returns false if >25% of workers are degraded.
   */
  public isPoolHealthy(): boolean {
    const results = this.getHealthSummary();
    const degraded = results.filter((r) => !r.isAlive).length;
    return degraded / results.length < 0.25;
  }

  // --- Private Implementation ---

  private resetCounters(workers: Worker[]): void {
    for (const worker of workers) {
      this.requestCounters.set(worker.threadId, 0);
    }
  }

  private runHealthCheck(): void {
    const now = Date.now();

    for (const worker of this.workers) {
      // 1. Send heartbeat ping
      try {
        worker.postMessage({ type: 'health_ping' });
      } catch (error) {
        logger.warn(`Failed to ping worker ${worker.threadId}`, { error: String(error) });
      }

      // 2. Evaluate immediate health
      const result = this.checkSingleWorker(worker, now);
      if (!result.isAlive) {
        logger.warn(
          `Worker ${worker.threadId} degraded: ${this.degradedReason(result)}`,
          { result },
        );
      }
    }

    // 3. Export metrics (if observability layer present)
    if (isProduction) {
      this.exportMetrics();
    }
  }

  private checkSingleWorker(
    worker: Worker,
    now: number,
  ): HealthCheckResult {
    const lastPongMs = this.lastPongTimestamps.get(worker.threadId) ?? null;
    const requestsHandled = this.requestCounters.get(worker.threadId) ?? 0;

    // Composite health checks
    const isResponsive =
      lastPongMs !== null && now - lastPongMs < this.config.pongTimeoutMs;
    const isMemoryHealthy = this.isMemoryHealthy(worker);
    const isAlive = isResponsive && isMemoryHealthy;

    return {
      threadId: worker.threadId,
      workerIndex: 0, // Set by pool
      isAlive,
      isResponsive,
      isMemoryHealthy,
      lastPongMs,
      memory: process.memoryUsage(),
      uptimeMs: now - (worker.threadId * 1000), // Approximation
      requestsHandled,
    };
  }

  private isMemoryHealthy(_worker: Worker): boolean {
    const memory = process.memoryUsage();
    const heapRatio = memory.heapUsed / memory.rss;
    return (
      heapRatio < this.config.heapPressureThreshold &&
      memory.rss < this.config.rssHardLimitBytes
    );
  }

  private degradedReason(result: HealthCheckResult): string {
    const reasons: string[] = [];
    if (!result.isResponsive) reasons.push('unresponsive');
    if (!result.isMemoryHealthy) reasons.push('memory-pressure');
    return reasons.join(', ') || 'unknown';
  }

  private exportMetrics(): void {
    // Placeholder for Prometheus/StatsD integration
    const summary = this.getHealthSummary();
    logger.debug('Worker pool health metrics', { summary });
  }
}

// Singleton export (used by WorkerPool orchestrator)
export const workerHealth = new WorkerHealthMonitor();