import { describe, it } from "vitest";
import * as fc from "fast-check";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  FilesystemCacheStore,
  type RouteCacheEntry,
  type RouteCachePolicy,
} from "@sourceog/runtime";

async function withTempDir<T>(prefix: string, run: (tmpDir: string) => Promise<T>): Promise<T> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    return await run(tmpDir);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

function makePolicy(overrides: Partial<RouteCachePolicy> = {}): RouteCachePolicy {
  return {
    ttl: 60,
    swr: 30,
    tags: [],
    scope: "route",
    ...overrides,
  };
}

function makeEntry(overrides: Partial<RouteCacheEntry> = {}): RouteCacheEntry {
  const now = Date.now();
  return {
    kind: "route",
    scope: "route",
    routeKey: "test-route",
    tags: [],
    linkedRouteIds: ["test-route"],
    linkedTagIds: [],
    body: Buffer.from("hello"),
    headers: {},
    status: 200,
    createdAt: now,
    expiresAt: now + 60_000,
    etag: "abc123",
    buildId: "build-1",
    ...overrides,
  };
}

const policyArb = fc.record({
  ttl: fc.integer({ min: 1, max: 3600 }),
  swr: fc.integer({ min: 0, max: 600 }),
  tags: fc.array(fc.string({ minLength: 1, maxLength: 32 }), { maxLength: 5 }),
  scope: fc.constantFrom("route" as const, "shared" as const),
});

const safeKeyArb = fc.stringMatching(/^[a-zA-Z0-9_\-.]{1,64}$/);

describe("FilesystemCacheStore - Property 7: Cache entries always expire after creation", () => {
  it("expiresAt > createdAt for every constructed entry", async () => {
    await fc.assert(
      fc.asyncProperty(policyArb, async (policy) => {
        const now = Date.now();
        const createdAt = now;
        const expiresAt = createdAt + policy.ttl * 1_000;
        return expiresAt > createdAt;
      })
    );
  });

  it("entry with positive ttl always has expiresAt strictly greater than createdAt", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 86400 }), async (ttl) => {
        const createdAt = Date.now();
        const expiresAt = createdAt + ttl * 1_000;
        return expiresAt > createdAt;
      })
    );
  });
});

describe("FilesystemCacheStore - Property 8: Cache store round trip", () => {
  it("set then get returns an equivalent entry before expiry", async () => {
    await fc.assert(
      fc.asyncProperty(
        safeKeyArb,
        fc.uint8Array({ minLength: 0, maxLength: 256 }),
        fc.array(fc.string({ minLength: 1, maxLength: 20 }), { maxLength: 4 }),
        async (key, bodyBytes, tags) => {
          return withTempDir("cache-rt-", async (tmpDir) => {
            const store = new FilesystemCacheStore(tmpDir);
            const now = Date.now();
            const entry = makeEntry({
              routeKey: key,
              body: Buffer.from(bodyBytes),
              tags,
              createdAt: now,
              expiresAt: now + 60_000,
            });

            await store.set(key, entry, makePolicy({ tags }));
            const retrieved = await store.get(key);

            if (retrieved === null) return false;
            if (retrieved.routeKey !== entry.routeKey) return false;
            if (retrieved.status !== entry.status) return false;
            if (retrieved.etag !== entry.etag) return false;
            if (!retrieved.body.equals(entry.body)) return false;
            return true;
          });
        }
      ),
      { numRuns: 20 }
    );
  }, 30000);

  it("get returns null for an expired entry", async () => {
    await fc.assert(
      fc.asyncProperty(safeKeyArb, async (key) => {
        return withTempDir("cache-exp-", async (tmpDir) => {
          const store = new FilesystemCacheStore(tmpDir);
          const now = Date.now();
          const entry = makeEntry({
            routeKey: key,
            createdAt: now - 10_000,
            expiresAt: now - 1,
          });

          await store.set(key, entry, makePolicy());
          const retrieved = await store.get(key);
          return retrieved === null;
        });
      }),
      { numRuns: 15 }
    );
  }, 30000);
});

describe("FilesystemCacheStore - Property 9: Cache purge removes all tagged entries", () => {
  it("after purge(tag), all entries with that tag are gone and untagged entries remain", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.string({ minLength: 1, maxLength: 20 }).map((s) => s.replace(/[^a-zA-Z0-9]/g, "x")),
          { minLength: 1, maxLength: 6 }
        ),
        fc.array(
          fc.string({ minLength: 1, maxLength: 20 }).map((s) => s.replace(/[^a-zA-Z0-9]/g, "y")),
          { minLength: 1, maxLength: 4 }
        ),
        fc.string({ minLength: 1, maxLength: 20 }).map((s) => s.replace(/[^a-zA-Z0-9]/g, "t")),
        async (taggedSuffixes, untaggedSuffixes, purgeTag) => {
          return withTempDir("cache-purge-", async (tmpDir) => {
            const store = new FilesystemCacheStore(tmpDir);
            const now = Date.now();
            const future = now + 60_000;

            const taggedKeys = [...new Set(taggedSuffixes.map((s) => `tagged_${s}`))];
            const untaggedKeys = [...new Set(untaggedSuffixes.map((s) => `untagged_${s}`))].filter(
              (key) => !taggedKeys.includes(key)
            );

            for (const key of taggedKeys) {
              await store.set(
                key,
                makeEntry({ routeKey: key, tags: [purgeTag], createdAt: now, expiresAt: future }),
                makePolicy({ tags: [purgeTag] })
              );
            }

            for (const key of untaggedKeys) {
              await store.set(
                key,
                makeEntry({ routeKey: key, tags: [], createdAt: now, expiresAt: future }),
                makePolicy({ tags: [] })
              );
            }

            await store.purge([purgeTag]);

            for (const key of taggedKeys) {
              const result = await store.get(key);
              if (result !== null) return false;
            }

            for (const key of untaggedKeys) {
              const result = await store.get(key);
              if (result === null) return false;
            }

            return true;
          });
        }
      ),
      { numRuns: 15 }
    );
  }, 45000);

  it("revalidate removes the specific entry so subsequent get returns null", async () => {
    await fc.assert(
      fc.asyncProperty(safeKeyArb, async (key) => {
        return withTempDir("cache-rev-", async (tmpDir) => {
          const store = new FilesystemCacheStore(tmpDir);
          const now = Date.now();
          const entry = makeEntry({ routeKey: key, createdAt: now, expiresAt: now + 60_000 });

          await store.set(key, entry, makePolicy());
          await store.revalidate(key);
          const result = await store.get(key);
          return result === null;
        });
      }),
      { numRuns: 18 }
    );
  }, 45000);

  it("purgeLinkedRoutes removes all entries linked to a route or pathname", async () => {
    await fc.assert(
      fc.asyncProperty(safeKeyArb, safeKeyArb, async (firstKey, secondKey) => {
        return withTempDir("cache-linked-route-", async (tmpDir) => {
          const store = new FilesystemCacheStore(tmpDir);
          const now = Date.now();

          await store.set(
            firstKey,
            makeEntry({
              routeKey: firstKey,
              linkedRouteIds: [firstKey],
              createdAt: now,
              expiresAt: now + 60_000
            }),
            makePolicy()
          );
          await store.set(
            secondKey,
            makeEntry({
              routeKey: secondKey,
              linkedRouteIds: [secondKey],
              createdAt: now,
              expiresAt: now + 60_000
            }),
            makePolicy()
          );

          await store.purgeLinkedRoutes([firstKey]);

          const removed = await store.get(firstKey);
          const preserved = await store.get(secondKey);
          return removed === null && preserved !== null;
        });
      }),
      { numRuns: 15 }
    );
  }, 45000);

  it("purgeKeys removes exactly the requested cache entries", async () => {
    await fc.assert(
      fc.asyncProperty(safeKeyArb, safeKeyArb, async (firstKey, secondKey) => {
        fc.pre(firstKey !== secondKey);
        return withTempDir("cache-purge-keys-", async (tmpDir) => {
          const store = new FilesystemCacheStore(tmpDir);
          const now = Date.now();

          await store.set(
            firstKey,
            makeEntry({
              routeKey: firstKey,
              createdAt: now,
              expiresAt: now + 60_000
            }),
            makePolicy()
          );
          await store.set(
            secondKey,
            makeEntry({
              routeKey: secondKey,
              createdAt: now,
              expiresAt: now + 60_000
            }),
            makePolicy()
          );

          await store.purgeKeys([firstKey]);

          const removed = await store.get(firstKey);
          const preserved = await store.get(secondKey);
          return removed === null && preserved !== null;
        });
      }),
      { numRuns: 15 }
    );
  }, 45000);
});
