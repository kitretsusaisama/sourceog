/**
 * Unit tests for RscWorkerPool behavior
 * Requirements: 2.6, 2.7, 2.8, 2.10
 *
 * Covers:
 *  - Queue timeout rejection after QUEUE_TIMEOUT_MS
 *  - Worker recycling after MAX_REQUESTS_PER_WORKER requests
 *  - Worker count logged on initialization
 *  - [SOURCEOG-FALLBACK] logged on worker crash
 *  - Workers reused across requests (not spawned per request)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";

// ---------------------------------------------------------------------------
// Controllable MockWorker
// ---------------------------------------------------------------------------

type PostMessageHandler = (message: unknown) => void;

class MockWorker extends EventEmitter {
  readonly threadId: number;
  private static _nextId = 1;
  private _terminated = false;
  private _postMessageHandler: PostMessageHandler | null = null;

  constructor(
    _filename: string,
    _options?: { workerData?: unknown; execArgv?: string[] }
  ) {
    super();
    this.threadId = MockWorker._nextId++;
  }

  setPostMessageHandler(handler: PostMessageHandler): void {
    this._postMessageHandler = handler;
  }

  postMessage(message: unknown): void {
    if (this._terminated) return;
    if (this._postMessageHandler) {
      this._postMessageHandler(message);
    } else {
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
  }

  terminate(): Promise<number> {
    this._terminated = true;
    setImmediate(() => this.emit("exit", 0));
    return Promise.resolve(0);
  }

  simulateCrash(code = 1): void {
    if (this._terminated) return;
    this._terminated = true;
    this.emit("exit", code);
  }

  get isTerminated(): boolean {
    return this._terminated;
  }

  static resetIdCounter(): void {
    MockWorker._nextId = 1;
  }
}

// Track all created workers so tests can control them
const createdWorkers: MockWorker[] = [];

vi.mock("node:worker_threads", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:worker_threads")>();
  return {
    ...original,
    Worker: class TrackedMockWorker extends MockWorker {
      constructor(filename: string, options?: { workerData?: unknown; execArgv?: string[] }) {
        super(filename, options);
        createdWorkers.push(this);
      }
    },
    workerData: { manifestPath: "" }
  };
});

const { RscWorkerPool } = await import("@sourceog/renderer");

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
      requestId: "unit-test",
      runtime: "node" as const,
      async bodyText() { return ""; },
      async bodyJson<T>() { return {} as T; }
    },
    params: {},
    query: new URLSearchParams()
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RscWorkerPool unit tests", () => {
  let pool: InstanceType<typeof RscWorkerPool>;

  beforeEach(() => {
    createdWorkers.length = 0;
    MockWorker.resetIdCounter();
  });

  afterEach(async () => {
    try {
      await pool?.shutdown();
    } catch {
      // ignore
    }
  });

  // -------------------------------------------------------------------------
  // Req 2.10 — worker count logged at info level on initialization
  // -------------------------------------------------------------------------
  it("logs worker count to stdout at info level on initialization (Req 2.10)", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    pool = new RscWorkerPool({ workerCount: 3, manifestPath: "" });
    await pool.initialize();

    const calls = infoSpy.mock.calls.map((c) => String(c[0]));
    const hasWorkerCountLog = calls.some(
      (msg) => msg.includes("3") && msg.toLowerCase().includes("worker")
    );
    expect(hasWorkerCountLog).toBe(true);

    infoSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // Req 2.6 — queue timeout rejection after QUEUE_TIMEOUT_MS
  // -------------------------------------------------------------------------
  it("rejects queued request with structured error after QUEUE_TIMEOUT_MS (Req 2.6)", async () => {
    pool = new RscWorkerPool({
      workerCount: 1,
      queueTimeoutMs: 50,
      workerTimeoutMs: 10_000,
      manifestPath: ""
    });
    await pool.initialize();

    // Make the single worker hang indefinitely
    const worker = createdWorkers[0]!;
    worker.setPostMessageHandler(() => {
      // intentionally never respond
    });

    const route = makeFakeRoute();
    const ctx = makeFakeContext();

    // First render occupies the only worker
    const hangingRender = pool.render(route, ctx).catch(() => null);

    // Second render should be queued and time out
    await expect(pool.render(route, ctx)).rejects.toThrow(/SOURCEOG-FALLBACK/);

    worker.simulateCrash(1);
    await hangingRender;
  }, 10_000);

  // -------------------------------------------------------------------------
  // Req 2.8 — worker recycled after MAX_REQUESTS_PER_WORKER requests
  // -------------------------------------------------------------------------
  it("recycles worker after maxRequestsPerWorker requests (Req 2.8)", async () => {
    const maxRequests = 3;

    pool = new RscWorkerPool({
      workerCount: 1,
      maxRequestsPerWorker: maxRequests,
      workerTimeoutMs: 10_000,
      queueTimeoutMs: 10_000,
      manifestPath: ""
    });
    await pool.initialize();

    const route = makeFakeRoute();
    const ctx = makeFakeContext();

    const threadIdsBefore = pool.getStats().workerThreadIds.slice();

    for (let i = 0; i < maxRequests; i++) {
      await pool.render(route, ctx);
    }

    // Give the pool time to spawn the replacement worker
    await new Promise((resolve) => setTimeout(resolve, 50));

    const threadIdsAfter = pool.getStats().workerThreadIds.slice();

    // Worker should have been replaced — thread IDs differ
    expect(threadIdsAfter).not.toEqual(threadIdsBefore);
    // Pool still has exactly 1 worker
    expect(pool.getStats().workerCount).toBe(1);
  }, 10_000);

  // -------------------------------------------------------------------------
  // Req 2.7 — [SOURCEOG-FALLBACK] logged on worker crash
  // -------------------------------------------------------------------------
  it("logs [SOURCEOG-FALLBACK] when a worker crashes (Req 2.7)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    pool = new RscWorkerPool({
      workerCount: 1,
      workerTimeoutMs: 10_000,
      queueTimeoutMs: 10_000,
      manifestPath: ""
    });
    await pool.initialize();

    const worker = createdWorkers[0]!;

    // Make the worker hang so there's an in-flight request when it crashes
    worker.setPostMessageHandler(() => {
      // never respond
    });

    const route = makeFakeRoute();
    const ctx = makeFakeContext();

    const renderPromise = pool.render(route, ctx).catch(() => null);

    await new Promise((resolve) => setTimeout(resolve, 10));
    worker.simulateCrash(1);

    await renderPromise;
    await new Promise((resolve) => setTimeout(resolve, 50));

    const errorCalls = errorSpy.mock.calls.map((c) => String(c[0]));
    const hasFallbackLog = errorCalls.some((msg) => msg.includes("[SOURCEOG-FALLBACK]"));
    expect(hasFallbackLog).toBe(true);

    errorSpy.mockRestore();
  }, 10_000);

  // -------------------------------------------------------------------------
  // Req 2.2 — workers reused across requests (not spawned per request)
  // -------------------------------------------------------------------------
  it("reuses workers across requests — does not spawn a new worker per render (Req 2.2)", async () => {
    pool = new RscWorkerPool({
      workerCount: 2,
      maxRequestsPerWorker: 1000,
      workerTimeoutMs: 10_000,
      queueTimeoutMs: 10_000,
      manifestPath: ""
    });
    await pool.initialize();

    expect(pool.getStats().workerCount).toBe(2);

    const route = makeFakeRoute();
    const ctx = makeFakeContext();

    for (let i = 0; i < 5; i++) {
      await pool.render(route, ctx);
    }

    // Worker count must still be 2 — no new workers spawned per request
    expect(pool.getStats().workerCount).toBe(2);
    expect(createdWorkers.length).toBe(2);
  }, 10_000);
});
