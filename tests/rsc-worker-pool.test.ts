// tests/rsc-worker-pool.test.ts
import path from "node:path";
import { promises as fs } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { buildApplication } from "@sourceog/compiler";
import { resolveConfig, type ResolvedSourceOGConfig } from "@sourceog/platform/config";
import { matchPageRoute, scanRoutes, type RouteDefinition } from "@sourceog/router";
import { RscWorkerPool } from "@sourceog/renderer";
import type { SourceOGRequestContext } from "@sourceog/runtime";

let tempDir: string | undefined;

function shouldCopyFixture(sourcePath: string): boolean {
  const name = path.basename(sourcePath);
  return name !== "node_modules" && name !== ".sourceog" && name !== "out-test";
}

afterEach(async () => {
  if (tempDir) {
    await fs.rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

function createRequestContext(url: string): SourceOGRequestContext {
  return {
    request: {
      url: new URL(url),
      method: "GET",
      headers: new Headers(),
      cookies: new Map(),
      requestId: "worker-pool-test",
      runtime: "node",
      async bodyText() {
        return "";
      },
      async bodyJson<T>() {
        return {} as T;
      }
    },
    params: {},
    query: new URLSearchParams()
  };
}

describe.sequential("rsc worker pool", () => {
  it("reuses workers across multiple renders and emits Flight chunks", async () => {
    const fixtureRoot = path.resolve(process.cwd(), "examples/app-basic");
    const tempRoot = path.join(process.cwd(), ".tmp-tests");

    await fs.mkdir(tempRoot, { recursive: true });
    tempDir = await fs.mkdtemp(path.join(tempRoot, "sourceog-rsc-pool-"));
    await fs.cp(fixtureRoot, tempDir, {
      recursive: true,
      filter: shouldCopyFixture
    });

    const cwd = tempDir;
    await buildApplication(cwd);

    const config = await resolveConfig(cwd) as unknown as ResolvedSourceOGConfig;
    const manifest = await scanRoutes(config);
    const match = matchPageRoute(manifest, "/about");

    expect(match).not.toBeNull();
    if (!match) {
      throw new Error('Expected match to be non-null');
    }

    const pool = new RscWorkerPool({
      workerCount: 1,
      manifestPath: path.join(
        cwd,
        ".sourceog",
        "manifests",
        "client-reference-manifest.json"
      )
    });

    try {
      const first = await pool.render(
        match.route,
        createRequestContext("http://sourceog.local/about"),
        { parallelRoutes: match.parallelRoutes }
      );

      const afterFirst = pool.getStats();

      const second = await pool.render(
        match.route,
        createRequestContext("http://sourceog.local/about"),
        { parallelRoutes: match.parallelRoutes }
      );

      const afterSecond = pool.getStats();

      expect(first.format).toBe("react-flight-text");
      expect(first.chunks.length).toBeGreaterThan(0);

      expect(second.format).toBe("react-flight-text");
      expect(second.chunks.length).toBeGreaterThan(0);

      expect(afterFirst.workerCount).toBe(1);
      expect(afterSecond.workerCount).toBe(1);
      expect(afterFirst.workerThreadIds).toEqual(afterSecond.workerThreadIds);
      expect(afterSecond.requestCounts[0]).toBeGreaterThanOrEqual(2);
    } finally {
      await pool.shutdown();
    }
  }, 75_000);

  it("rejects worker render failures explicitly", async () => {
    const pool = new RscWorkerPool({
      workerCount: 1,
      manifestPath: path.join(process.cwd(), "does-not-exist.json")
    });

    const brokenRoute: RouteDefinition = {
      id: "page:/broken",
      kind: "page",
      pathname: "/broken",
      file: path.join(process.cwd(), "missing-route-file.tsx"),
      segmentPath: ["broken"],
      segments: [],
      urlSegments: [],
      layouts: [],
      middlewareFiles: [],
      capabilities: [],
      isParallelSlot: false,
      isIntercepting: false,
      score: 0,
      modules: {
        page: path.join(process.cwd(), "missing-route-file.tsx"),
        layouts: [],
        middleware: []
      }
    };

    try {
      await expect(
        pool.render(
          brokenRoute,
          createRequestContext("http://sourceog.local/broken")
        )
      ).rejects.toThrow();
    } finally {
      await pool.shutdown();
    }
  }, 30_000);
});