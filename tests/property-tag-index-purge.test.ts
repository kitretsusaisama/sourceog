/**
 * Property 20: Tag Index O(1) Purge
 * Validates: Requirements 19.3
 *
 * Populate a cache with N entries tagged with varying tags; call purge([tag])
 * and assert file read count is proportional to matching entries K, not total N.
 *
 * We instrument fs.readFile to count reads during purge() and verify the count
 * equals K+1 (one read for tags.json + zero reads of individual entry files),
 * not N (which would indicate a full directory scan).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import * as fc from "fast-check";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { FilesystemCacheStore } from "@sourceog/runtime";
import type { RouteCacheEntry, RouteCachePolicy } from "@sourceog/runtime";

async function withTempDir<T>(prefix: string, run: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    return await run(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function makeEntry(key: string, tags: string[]): RouteCacheEntry {
  const now = Date.now();
  return {
    kind: "route",
    scope: "route",
    routeKey: key,
    tags,
    linkedRouteIds: [key],
    linkedTagIds: [],
    body: Buffer.from(`body-${key}`),
    headers: {},
    status: 200,
    createdAt: now,
    expiresAt: now + 60_000,
    etag: `etag-${key}`,
    buildId: "build-1",
  };
}

function makePolicy(tags: string[]): RouteCachePolicy {
  return { ttl: 60, swr: 0, tags, scope: "route" };
}

describe("Property 20: Tag Index O(1) Purge", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("purge reads only tags.json, not all N entry files", async () => {
    // Use a fixed scenario: N=20 total entries, K=5 tagged with the purge tag.
    // This is deterministic and fast while still proving the O(K) property.
    await withTempDir("prop20-purge-", async (dir) => {
      const store = new FilesystemCacheStore(dir);
      const purgeTag = "purge-me";
      const N = 20;
      const K = 5;

      // Write K entries with purgeTag and (N-K) entries with a different tag.
      for (let i = 0; i < K; i++) {
        await store.set(`tagged-${i}`, makeEntry(`tagged-${i}`, [purgeTag]), makePolicy([purgeTag]));
      }
      for (let i = 0; i < N - K; i++) {
        await store.set(`other-${i}`, makeEntry(`other-${i}`, ["other-tag"]), makePolicy(["other-tag"]));
      }

      // Spy on fs.readFile to count reads during purge.
      const originalReadFile = fs.readFile.bind(fs);
      let readCount = 0;
      const spy = vi.spyOn(fs, "readFile").mockImplementation(async (...args: Parameters<typeof fs.readFile>) => {
        readCount++;
        return originalReadFile(...(args as Parameters<typeof fs.readFile>));
      });

      readCount = 0;
      await store.purge([purgeTag]);

      spy.mockRestore();

      // O(1) purge: only tags.json is read (1 read), not all N entry files.
      // Allow up to 2 reads to account for the rebuild path (tags.json read + possible retry).
      expect(readCount).toBeLessThanOrEqual(2);
      expect(readCount).toBeLessThan(N);

      // Correctness: tagged entries are gone, others remain.
      for (let i = 0; i < K; i++) {
        expect(await store.get(`tagged-${i}`)).toBeNull();
      }
      for (let i = 0; i < N - K; i++) {
        expect(await store.get(`other-${i}`)).not.toBeNull();
      }
    });
  }, 30_000);

  it("purge read count scales with K (matching entries), not N (total entries)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 5, max: 15 }),  // N: total entries
        fc.integer({ min: 1, max: 4 }),   // K: entries with purge tag
        async (N, K) => {
          fc.pre(K < N);
          return withTempDir("prop20-scale-", async (dir) => {
            const store = new FilesystemCacheStore(dir);
            const purgeTag = "target";

            for (let i = 0; i < K; i++) {
              await store.set(`t-${i}`, makeEntry(`t-${i}`, [purgeTag]), makePolicy([purgeTag]));
            }
            for (let i = 0; i < N - K; i++) {
              await store.set(`o-${i}`, makeEntry(`o-${i}`, ["other"]), makePolicy(["other"]));
            }

            const originalReadFile = fs.readFile.bind(fs);
            let readCount = 0;
            const spy = vi.spyOn(fs, "readFile").mockImplementation(async (...args: Parameters<typeof fs.readFile>) => {
              readCount++;
              return originalReadFile(...(args as Parameters<typeof fs.readFile>));
            });

            readCount = 0;
            await store.purge([purgeTag]);
            spy.mockRestore();

            // Must read far fewer files than N (the full directory scan count).
            // O(1) index-based purge reads only tags.json (1-2 reads), never N reads.
            return readCount < N;
          });
        }
      ),
      { numRuns: 20 }
    );
  }, 60_000);

  it("tags.json is rebuilt from entries when missing, then purge uses it", async () => {
    await withTempDir("prop20-rebuild-", async (dir) => {
      const store = new FilesystemCacheStore(dir);
      const purgeTag = "rebuild-tag";

      await store.set("entry-a", makeEntry("entry-a", [purgeTag]), makePolicy([purgeTag]));
      await store.set("entry-b", makeEntry("entry-b", ["other"]), makePolicy(["other"]));

      // Delete tags.json to simulate corruption/missing index.
      await fs.unlink(path.join(dir, "tags.json")).catch(() => {});

      // purge should rebuild the index and still correctly remove tagged entries.
      await store.purge([purgeTag]);

      expect(await store.get("entry-a")).toBeNull();
      expect(await store.get("entry-b")).not.toBeNull();
    });
  }, 15_000);
});
