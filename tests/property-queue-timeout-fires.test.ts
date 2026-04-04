/**
 * Property 7: Queue Timeout Fires
 * Validates: Requirements 6.2, 6.3
 * Tag: `Feature: sourceog-rsc-contract-remediation, Property 7: Queue Timeout Fires`
 *
 * Saturate the pool so all workers are busy, enqueue an additional request,
 * wait past `queueTimeoutMs`, and assert the queued request is rejected with
 * `[SOURCEOG-FALLBACK]`.
 *
 * Also validates Req 6.2: the timeout countdown starts AFTER initialize()
 * resolves, not at render() call time.
 */

import { describe, it, afterEach } from "vitest";
import * as fc from "fast-check";
import { EventEmitter } from "node:events";

// ---------------------------------------------------------------------------
// MockWorker — never responds to render requests (simulates busy workers)
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

  postMessage(_message: unknown): void {
    // Intentionally never respond — simulates a permanently busy worker
  }

  terminate(): Promise<number> {
    this._terminated = true;
    setImmediate(() => this.emit("exit", 0));
    return Promise.resolve(0);
  }

  get isTerminated(): boolean {
    return this._terminated;
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

import { vi } from "vitest";

const { RscWorkerPool } = await import("@sourceog/renderer");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFakeRoute(id = "page:/test") {
  return {
    id,
    pathname: "/test",
    file: process.cwd() + "/fake/page.tsx",
    layouts: [],
    middlewareFiles: [],
    segments: [],
    capabilities: [],
    kind: "page" as const
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

/** Wait for real time to pass. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Property 7: Queue Timeout Fires
// ---------------------------------------------------------------------------

describe("Property 7: Queue Timeout Fires", () => {
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
    "queued request is rejected with [SOURCEOG-FALLBACK] after queueTimeoutMs elapses (Req 6.3)",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          // workerCount: 1–2 workers (kept small for speed)
          fc.integer({ min: 1, max: 2 }),
          // queueTimeoutMs: 30–80 ms (short but real)
          fc.integer({ min: 30, max: 80 }),
          async (workerCount, queueTimeoutMs) => {
            pool = new RscWorkerPool({
              workerCount,
              queueTimeoutMs,
              workerTimeoutMs: 60_000,
              maxQueueDepth: 10_000,
              manifestPath: ""
            });

            // initialize() must complete before render() is called so that
            // the timeout starts AFTER initialization (Req 6.2).
            await pool.initialize();

            const route = makeFakeRoute();
            const ctx = makeFakeContext();

            // Saturate all workers — each render hangs because MockWorker never responds
            const saturatingRenders = Array.from({ length: workerCount }, () =>
              pool?.render(route, ctx)?.catch(() => null) ?? Promise.resolve(null)
            );

            // Give dispatch a tick to assign the saturating renders to workers
            await new Promise<void>((resolve) => setImmediate(resolve));

            // Enqueue one more request — it will be queued (all workers busy)
            let rejectionError: Error | undefined;
            const queuedRender = pool?.render(route, ctx)?.catch((err: Error) => {
              rejectionError = err;
            }) ?? Promise.resolve();

            // Wait past queueTimeoutMs — the timeout should fire
            await sleep(queueTimeoutMs + 50);
            await queuedRender;

            // Req 6.3 — rejection must contain [SOURCEOG-FALLBACK]
            const passed =
              rejectionError !== undefined &&
              rejectionError.message.includes("[SOURCEOG-FALLBACK]");

            // Clean up
            await pool?.shutdown();
            pool = undefined;
            await Promise.allSettled(saturatingRenders);

            return passed;
          }
        ),
        { numRuns: 15 }
      );
    },
    30_000
  );

  it(
    "timeout does not fire before queueTimeoutMs elapses — no premature rejection (Req 6.2)",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 2 }),
          // Use a longer timeout so we can safely check before it fires
          fc.integer({ min: 150, max: 300 }),
          async (workerCount, queueTimeoutMs) => {
            pool = new RscWorkerPool({
              workerCount,
              queueTimeoutMs,
              workerTimeoutMs: 60_000,
              maxQueueDepth: 10_000,
              manifestPath: ""
            });

            await pool.initialize();

            const route = makeFakeRoute();
            const ctx = makeFakeContext();

            // Saturate all workers
            const saturatingRenders = Array.from({ length: workerCount }, () =>
              pool
                ? pool.render(route, ctx).catch(() => null)
                : Promise.resolve(null)
            );

            await new Promise<void>((resolve) => setImmediate(resolve));

            let rejected = false;
            const queuedRender = pool
              ? pool.render(route, ctx).catch(() => {
                  rejected = true;
                })
              : Promise.resolve();

            // Wait for half the timeout — should NOT have fired yet
            await sleep(Math.floor(queueTimeoutMs / 2));

            const notYetRejected = !rejected;

            // Clean up before the timeout fires
            if (pool) {
              await pool.shutdown();
            }
            pool = undefined;
            await Promise.allSettled([...saturatingRenders, queuedRender]);

            return notYetRejected;
          }
        ),
        { numRuns: 10 }
      );
    },
    30_000
  );
});
