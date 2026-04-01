/**
 * Property 1: Worker Pool Size Invariant
 * Validates: Requirements 7.1, 7.2, 7.3
 * Tag: `Feature: sourceog-rsc-contract-remediation, Property 1: Worker Pool Size Invariant`
 *
 * For any sequence of concurrent recycle events, `workers.length >= workerCount`
 * must hold at every observable point while the pool is active and not shutting down.
 *
 * This property specifically validates the fix for CRITICAL-03:
 *   recycleWorker() must spawn the replacement BEFORE removing the old worker.
 */

import { describe, it, afterEach, vi } from "vitest";
import * as fc from "fast-check";
import { EventEmitter } from "node:events";

// ---------------------------------------------------------------------------
// MockWorker — simulates worker_threads.Worker behaviour
// ---------------------------------------------------------------------------

class MockWorker extends EventEmitter {
  readonly threadId: number;
  private static _nextId = 1;
  private _terminated = false;

  constructor(
    _filename: string,
    _options?: { workerData?: unknown; execArgv?: string[] }
  ) {
    super();
    this.threadId = MockWorker._nextId++;
  }

  postMessage(message: unknown): void {
    if (this._terminated) return;
    setImmediate(() => {
      if (this._terminated) return;
      const msg = message as { type: string; requestId: string };
      if (msg.type === "render") {
        this.emit("message", {
          type: "render_result",
          requestId: msg.requestId,
          result: { format: "react-flight-text", chunks: ["0:D{}\n"] }
        });
      }
    });
  }

  terminate(): Promise<number> {
    this._terminated = true;
    setImmediate(() => this.emit("exit", 0));
    return Promise.resolve(0);
  }

  static resetIdCounter(): void {
    MockWorker._nextId = 1;
  }
}

vi.mock("node:worker_threads", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:worker_threads")>();
  return {
    ...original,
    Worker: MockWorker,
    workerData: { manifestPath: "" }
  };
});

const { RscWorkerPool } = await import("@sourceog/renderer");

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Generate a pool size between 1 and 4 workers. */
const arbitraryWorkerCount = fc.integer({ min: 1, max: 4 });

/** Generate a batch of 1–20 concurrent render requests. */
const arbitraryRequestBatch = fc.integer({ min: 1, max: 20 });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFakeRoute(id = "page:/test") {
  return {
    id,
    pathname: "/test",
    // Use a path within the project root so manifest path resolution doesn't throw
    file: process.cwd() + "/fake/page.tsx",
    layouts: [],
    middlewareFiles: [],
    segments: [],
    urlSegments: [],
    segmentPath: [],
    capabilities: [],
    isParallelSlot: false,
    isIntercepting: false,
    score: 0,
    kind: "page" as const,
    modules: { layouts: [], middleware: [] }
  };
}

function makeFakeContext() {
  return {
    request: {
      url: new URL("http://localhost/test"),
      method: "GET",
      headers: new Headers(),
      cookies: new Map(),
      requestId: "prop-test",
      runtime: "node" as const,
      async bodyText() { return ""; },
      async bodyJson<T>() { return {} as T; }
    },
    params: {},
    query: new URLSearchParams()
  };
}

// ---------------------------------------------------------------------------
// Property 1: Worker Pool Size Invariant
// ---------------------------------------------------------------------------

describe("Property 1: Worker Pool Size Invariant", () => {
  let pool: InstanceType<typeof RscWorkerPool> | undefined;

  afterEach(async () => {
    try {
      await pool?.shutdown();
    } catch {
      // ignore cleanup errors
    }
    pool = undefined;
    MockWorker.resetIdCounter();
  });

  it(
    "workers.length >= workerCount holds at every observable point during concurrent recycle events",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryWorkerCount,
          arbitraryRequestBatch,
          async (workerCount, requestCount) => {
            // Use maxRequestsPerWorker=1 to force recycling on every request,
            // maximising concurrent recycle events.
            pool = new RscWorkerPool({
              workerCount,
              maxRequestsPerWorker: 1,
              manifestPath: "",
              workerTimeoutMs: 10_000,
              queueTimeoutMs: 10_000
            });

            await pool.initialize();

            // Invariant: after init, pool must have exactly workerCount workers
            const statsInit = pool.getStats();
            if (statsInit.workerCount < workerCount) return false;

            const fakeRoute = makeFakeRoute();
            const fakeContext = makeFakeContext();

            // Snapshot pool size at every observable tick during concurrent renders.
            // Each render triggers a recycle (maxRequestsPerWorker=1), so we get
            // concurrent recycle events when requestCount > workerCount.
            const sizeSnapshots: number[] = [];

            const renderPromises = Array.from({ length: requestCount }, () =>
              pool!.render(fakeRoute, fakeContext).catch(() => null)
            );

            // Poll pool size while renders are in flight (Req 7.2, 7.3)
            const pollInterval = setInterval(() => {
              sizeSnapshots.push(pool!.getStats().workerCount);
            }, 0);

            await Promise.allSettled(renderPromises);
            clearInterval(pollInterval);

            // Capture final snapshot
            sizeSnapshots.push(pool!.getStats().workerCount);

            // Req 7.2, 7.3: workers.length >= workerCount at every observable point
            const violated = sizeSnapshots.some((size) => size < workerCount);
            if (violated) return false;

            await pool!.shutdown();
            pool = undefined;
            return true;
          }
        ),
        { numRuns: 50 }
      );
    },
    120_000
  );

  it(
    "workers.length >= workerCount holds after a single recycle (Req 7.1)",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryWorkerCount,
          async (workerCount) => {
            // maxRequestsPerWorker=1 forces a recycle after the first render
            pool = new RscWorkerPool({
              workerCount,
              maxRequestsPerWorker: 1,
              manifestPath: "",
              workerTimeoutMs: 10_000,
              queueTimeoutMs: 10_000
            });

            await pool.initialize();

            const sizeBefore = pool.getStats().workerCount;
            if (sizeBefore < workerCount) return false;

            const fakeRoute = makeFakeRoute();
            const fakeContext = makeFakeContext();

            // Trigger exactly one recycle
            await pool.render(fakeRoute, fakeContext);

            // Allow the async recycle to complete
            await new Promise<void>((resolve) => setTimeout(resolve, 50));

            // Req 7.1: pool size must still be >= workerCount after recycle
            const sizeAfter = pool.getStats().workerCount;
            if (sizeAfter < workerCount) return false;

            await pool.shutdown();
            pool = undefined;
            return true;
          }
        ),
        { numRuns: 50 }
      );
    },
    60_000
  );
});
