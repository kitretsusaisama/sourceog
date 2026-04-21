// sourceog-renderer/src/orchestrator/worker-pool.ts
// Alibaba CTO 2027 Standard — Worker Pool Management

import { Worker } from 'node:worker_threads';
import type {
  WorkerMessage,
  WorkerRenderRequest,
} from '../types/messages.js';
import type { WorkerRenderResponse } from '../types/internal.js';
import type { RouteDefinition } from '@sourceog/router';
import type { SourceOGRequestContext } from '@sourceog/runtime';
import type { RenderRouteOptions } from '../types/public.js';
import { PriorityQueue, Priority } from './priority-queue.js';
import { AdmissionController } from './admission-control.js';
import { Scheduler } from './scheduler.js';
import {
  WorkerSpawnError,
  WorkerQueueTimeoutError,
} from '@sourceog/genbook/errors';
import { RenderError } from '../core/errors.js';
import { logger } from '../core/logger.js';
import {
  WORKER_FILE_PATH,
  MAX_REQUESTS_PER_WORKER,
  WORKER_TIMEOUT_MS,
  QUEUE_TIMEOUT_MS,
  DEFAULT_MAX_QUEUE_DEPTH,
  DEFAULT_WORKER_COUNT,
} from '../core/constants.js';
import { toWorkerManifestUrl } from '../core/urls.js';
import { transpilerManager } from '../transpiler/transpiler-core.js';
import { deriveRenderContextKey } from '../core/hashing.js';
import type { QueuedRenderRequest } from './request-queue.js';

/**
 * Internal structure for an active render request being processed by a worker.
 */
export interface ActiveRenderRequest {
  requestId: string;
  payload: WorkerRenderRequest['payload'];
  resolve: (result: WorkerRenderResponse) => void;
  reject: (error: Error) => void;
  renderTimeout: NodeJS.Timeout;
  collectedChunks: string[];
  chunkCount: number;
  onChunk?: (chunk: string) => void;
  collectChunks: boolean;
}

/**
 * Represents a worker thread within the pool.
 */
export interface PooledWorker {
  worker: Worker;
  busy: boolean;
  requestCount: number;
  lastUsed: number;
  current?: ActiveRenderRequest;
  stopping: boolean;
}

/**
 * Configuration options for the WorkerPool.
 */
export interface WorkerPoolOptions {
  workerCount?: number;
  manifestPath?: string;
  maxQueueDepth?: number;
  maxRequestsPerWorker?: number;
  queueTimeoutMs?: number;
  workerTimeoutMs?: number;
}

type RenderableRoute = Pick<RouteDefinition, "id" | "pathname" | "file"> & Partial<RouteDefinition>;

/**
 * Manages the lifecycle of worker threads, request queuing, and distribution.
 */
export class WorkerPool {
  private readonly workerCount: number;
  private readonly manifestPath?: string;
  private readonly maxRequestsPerWorker: number;
  private readonly maxQueueDepth: number;
  private readonly queueTimeoutMs: number;
  private readonly workerTimeoutMs: number;

  private readonly workers: PooledWorker[] = [];
  private readonly queue: PriorityQueue;
  private readonly admissionController: AdmissionController;
  private readonly scheduler: Scheduler;

  private initialized = false;
  private shuttingDown = false;
  private requestCounter = 0;

  // Cached transpiler configuration
  private execArgv: string[] = [];
  private useInlineFallback = false;

  constructor(options: WorkerPoolOptions) {
    this.workerCount = options.workerCount ?? DEFAULT_WORKER_COUNT;
    this.manifestPath = options.manifestPath;
    this.maxRequestsPerWorker =
      options.maxRequestsPerWorker ?? MAX_REQUESTS_PER_WORKER;
    this.queueTimeoutMs = options.queueTimeoutMs ?? QUEUE_TIMEOUT_MS;
    this.workerTimeoutMs = options.workerTimeoutMs ?? WORKER_TIMEOUT_MS;

    const maxQueueDepth = options.maxQueueDepth ?? DEFAULT_MAX_QUEUE_DEPTH;
    this.maxQueueDepth = maxQueueDepth;

    this.queue = new PriorityQueue();
    this.admissionController = new AdmissionController({
      maxQueueDepth,
      maxWorkers: this.workerCount,
    });

    // Scheduler gets access to workers via closure to avoid circular deps.
    this.scheduler = new Scheduler(this.queue, () => this.workers);
  }

  /**
   * Initializes the pool by spawning workers.
   */
  public async initialize(): Promise<void> {
    if (this.initialized) return;

    await transpilerManager.initialize();
    const execSetup = transpilerManager.getWorkerExecArgv();
    this.execArgv = execSetup.execArgv;
    this.useInlineFallback = transpilerManager.useInlineTransform();

    logger.info(
      `Initializing WorkerPool with ${this.workerCount} workers. Strategy=${execSetup.strategy}`,
    );
    await Promise.all(
      Array.from({ length: this.workerCount }, () => this.spawnWorker()),
    );

    this.initialized = true;
  }

  /**
   * Renders a route using the worker pool.
   */
  public async render(
    route: RenderableRoute,
    context: SourceOGRequestContext,
    options: RenderRouteOptions = {},
  ): Promise<WorkerRenderResponse> {
    await this.initialize();

    if (this.shuttingDown) {
      throw new RenderError('POOL_SHUTDOWN', 'Pool is shutting down.');
    }

    // 1. Determine Priority (simple heuristic: streaming > non-streaming).
    const priority =
      typeof options.onChunk === 'function' ? Priority.High : Priority.Normal;

    // 2. Admission Control
    const decision = this.admissionController.check(
      this.queue.size,
      this.workers.filter((w) => w.busy).length,
      priority,
    );

    if (!decision.accepted) {
      throw decision.error ?? new RenderError('ADMISSION_REJECTED', 'Rejected');
    }

    // 3. Prepare Payload
    const renderContextKey = deriveRenderContextKey(route.pathname, false);

    const payload: WorkerRenderRequest['payload'] = {
      runtimeTarget: 'node', // TODO: Derive from context/runtime
      route: {
        id: route.id,
        pathname: route.pathname,
        file: route.file,
        templateFile: route.templateFile,
        layouts: route.layouts ?? [],
      },
      parallelRoutes: {}, // TODO: handle parallel routes
      context: {
        request: {
          url: context.request.url.toString(),
          method: context.request.method,
          headers: Array.from(context.request.headers.entries()),
          cookies: Array.from(context.request.cookies.entries()),
          requestId: context.request.requestId,
          runtime: context.request.runtime,
        },
        params: context.params,
        query: Array.from(context.query.entries()),
        locale: context.locale,
        renderContextKey,
        renderContext: undefined,
      },
      collectChunks: options.collectChunks ?? false,
      timeoutMs: options.timeoutMs ?? this.workerTimeoutMs,
    };

    // 4. Queue Request
    return new Promise<WorkerRenderResponse>((resolve, reject) => {
      const requestId = `rsc-${(this.requestCounter++).toString(36)}`;

      const queued: QueuedRenderRequest = {
        requestId,
        payload,
        resolve,
        reject,
        queueTimeout: setTimeout(() => {
          if (queued.node) {
            this.queue.remove(queued);
          }
          reject(new WorkerQueueTimeoutError(payload.routeId, this.queueTimeoutMs));
        }, this.queueTimeoutMs),
        renderTimeoutMs: payload.timeoutMs ?? this.workerTimeoutMs,
        onChunk: options.onChunk,
        collectChunks: options.collectChunks ?? false,
      };

      this.queue.enqueue(queued, decision.priority ?? priority);

      // 5. Trigger Dispatch
      this.scheduler.dispatch();
    });
  }

  /**
   * Spawns a new worker thread.
   */
  private async spawnWorker(): Promise<PooledWorker> {
    const manifestUrl = toWorkerManifestUrl(this.manifestPath);

    const worker = new Worker(WORKER_FILE_PATH, {
      execArgv: this.execArgv,
      workerData: {
        manifestPath: manifestUrl,
        useInlineTransform: this.useInlineFallback,
      },
    });

    const pooledWorker: PooledWorker = {
      worker,
      busy: false,
      requestCount: 0,
      lastUsed: Date.now(),
      stopping: false,
    };

    worker.on('message', (message: WorkerMessage) =>
      this.handleWorkerMessage(pooledWorker, message),
    );

    worker.on('error', (error) =>
      this.handleWorkerFailure(pooledWorker, error as Error),
    );

    worker.on('exit', (code) => {
      if (code !== 0 && !pooledWorker.stopping && !this.shuttingDown) {
        this.handleWorkerFailure(
          pooledWorker,
          new WorkerSpawnError(WORKER_FILE_PATH, `Worker exited with code ${code}`),
        );
      }
    });

    this.workers.push(pooledWorker);
    return pooledWorker;
  }

  /**
   * Handles messages received from a worker.
   */
  private handleWorkerMessage(
    pw: PooledWorker,
    message: WorkerMessage,
  ): void {
    const current = pw.current;
    if (!current || current.requestId !== message.requestId) {
      return;
    }

    switch (message.type) {
      case 'render_chunk': {
        current.chunkCount += 1;
        if (current.collectChunks) {
          current.collectedChunks.push(message.chunk);
        }
        current.onChunk?.(message.chunk);
        break;
      }

      case 'render_result': {
        clearTimeout(current.renderTimeout);

        pw.busy = false;
        pw.current = undefined;

        const chunks =
          message.result.chunks && message.result.chunks.length > 0
            ? message.result.chunks
            : current.collectedChunks;

        current.resolve({
          format: message.result.format,
          chunks,
          streamed: current.chunkCount > 0,
          chunkCount: current.chunkCount,
          usedClientRefs: message.result.usedClientRefs,
        });

        this.checkRecycle(pw);
        setImmediate(() => this.scheduler.dispatch());
        break;
      }

      case 'render_error': {
        clearTimeout(current.renderTimeout);

        pw.busy = false;
        pw.current = undefined;

        current.reject(
          new RenderError(message.code ?? 'RENDER_FAILURE', message.error),
        );

        this.checkRecycle(pw);
        setImmediate(() => this.scheduler.dispatch());
        break;
      }
    }
  }

  /**
   * Handles unexpected worker failures.
   */
  private async handleWorkerFailure(pw: PooledWorker, error: Error): Promise<void> {
    logger.error('[SOURCEOG-FALLBACK] Worker failure detected', error, {
      threadId: pw.worker.threadId,
    });

    if (pw.current) {
      clearTimeout(pw.current.renderTimeout);
      pw.current.reject(error);
      pw.current = undefined;
    }

    pw.busy = false;

    await this.recycleWorker(pw);
    this.scheduler.dispatch();
  }

  /**
   * Checks if a worker needs to be recycled based on request count.
   */
  private checkRecycle(pw: PooledWorker): void {
    if (pw.requestCount >= this.maxRequestsPerWorker) {
      void this.recycleWorker(pw);
    }
  }

  /**
   * Replaces a worker with a fresh instance.
   */
  private async recycleWorker(pw: PooledWorker): Promise<void> {
    const idx = this.workers.indexOf(pw);
    if (idx === -1) return;
    if (pw.stopping) return;

    // Prevent the scheduler from reusing a worker that is already marked for
    // replacement while we spin up its successor.
    pw.stopping = true;

    // 1. Spawn replacement
    try {
      await this.spawnWorker();
    } catch (err) {
      pw.stopping = false;
      logger.error('Failed to spawn replacement worker', err as Error);
      return; // Keep old worker if we can't replace
    }

    // 2. Stop old worker
    this.workers.splice(idx, 1);

    try {
      await pw.worker.terminate();
    } catch {
      // ignore terminate errors
    }
  }

  /**
   * Gracefully shuts down the pool.
   */
  public async shutdown(): Promise<void> {
    this.shuttingDown = true;

    // Drain queue
    const pending = this.queue.drain();
    for (const req of pending) {
      clearTimeout(req.queueTimeout);
      req.reject(
        new RenderError('POOL_SHUTDOWN', 'Pool is shutting down.'),
      );
    }

    // Terminate workers
    await Promise.all(
      this.workers.map(async (pw) => {
        pw.stopping = true;
        if (pw.current) {
          clearTimeout(pw.current.renderTimeout);
          pw.current.reject(
            new RenderError('POOL_SHUTDOWN', 'Pool is shutting down.'),
          );
          pw.current = undefined;
          pw.busy = false;
        }
        await pw.worker.terminate();
      }),
    );

    this.workers.length = 0;
    this.initialized = false;
    this.shuttingDown = false;
  }

  public getStats(): {
    workerCount: number;
    busyWorkers: number;
    idleWorkers: number;
    queuedRequests: number;
    requestCounts: number[];
    workerThreadIds: number[];
    maxQueueDepth: number;
  } {
    return {
      workerCount: this.workers.length,
      busyWorkers: this.workers.filter((worker) => worker.busy).length,
      idleWorkers: this.workers.filter((worker) => !worker.busy).length,
      queuedRequests: this.queue.size,
      requestCounts: this.workers.map((worker) => worker.requestCount),
      workerThreadIds: this.workers.map((worker) => worker.worker.threadId),
      maxQueueDepth: this.maxQueueDepth,
    };
  }
}
