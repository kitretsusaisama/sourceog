/**
 * Property-Based Tests for bounded L1 cache with LRU eviction in DataCache (RF-10)
 * Validates: Requirement 8 (Bounded L1 Cache with LRU Eviction)
 *
 * Properties tested:
 *   P1 — After any sequence of set() calls, the number of L1-resident entries
 *        never exceeds maxL1Size.
 *   P2 — The most-recently-set entry is always retrievable (never self-evicted).
 *   P3 — An entry accessed via get() immediately before a cache-filling insert
 *        is never the one evicted.
 */
import { describe, it } from "vitest";
import * as fc from "fast-check";
import { DataCache } from "@sourceog/runtime";
import type { DataCacheKey } from "@sourceog/runtime";

function makeKey(id: number): DataCacheKey {
  return {
    url: `https://example.com/item/${id}`,
    method: "GET",
    bodyHash: "",
    tags: [],
    runtimeTarget: "node",
  };
}

describe("Property: L1 size never exceeds maxL1Size (Requirement 8.3)", () => {
  it("l1 size is bounded after arbitrary set() sequences", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 20 }),   // maxL1Size
        fc.array(fc.integer({ min: 0, max: 49 }), { minLength: 1, maxLength: 100 }), // key IDs to set
        async (maxL1Size, keyIds) => {
          const cache = new DataCache(undefined, { maxL1Size });
          const setKeys = new Set<number>();

          for (const id of keyIds) {
            await cache.set(makeKey(id), `value-${id}`);
            setKeys.add(id);
          }

          // Count how many of the distinct keys are still in L1
          let l1Count = 0;
          for (const id of setKeys) {
            const result = await cache.get(makeKey(id), false);
            if (result !== null) l1Count++;
          }

          return l1Count <= maxL1Size;
        }
      ),
      { numRuns: 200 }
    );
  });
});

describe("Property: most-recently-set entry is always present (Requirement 8.2)", () => {
  it("the last set() entry is always retrievable", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 10 }),   // maxL1Size
        fc.array(fc.integer({ min: 0, max: 49 }), { minLength: 1, maxLength: 50 }), // key IDs
        async (maxL1Size, keyIds) => {
          const cache = new DataCache(undefined, { maxL1Size });

          for (const id of keyIds) {
            await cache.set(makeKey(id), `value-${id}`);
          }

          // The last inserted key must always be present
          const lastId = keyIds[keyIds.length - 1];
          const result = await cache.get(makeKey(lastId), false);
          return result !== null && result.value === `value-${lastId}`;
        }
      ),
      { numRuns: 200 }
    );
  });
});

describe("Property: get() promotes entry to MRU, protecting it from next eviction (Requirement 8.4)", () => {
  it("an entry accessed just before a full-cache insert is not evicted", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 10 }),   // maxL1Size (at least 2 so there's room for the test)
        async (maxL1Size) => {
          const cache = new DataCache(undefined, { maxL1Size });

          // Fill the cache to capacity with keys 0..maxL1Size-1
          for (let i = 0; i < maxL1Size; i++) {
            await cache.set(makeKey(i), `v${i}`);
          }

          // Access key 0 — it becomes MRU; key 1 becomes LRU
          await cache.get(makeKey(0), false);

          // Insert a new key — should evict key 1 (LRU), not key 0
          await cache.set(makeKey(maxL1Size), `v${maxL1Size}`);

          const key0Result = await cache.get(makeKey(0), false);
          const key1Result = await cache.get(makeKey(1), false);

          // key 0 must still be present (was promoted to MRU)
          if (key0Result === null) return false;
          // key 1 must be evicted (was LRU after key 0 was accessed)
          if (key1Result !== null) return false;

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe("Property: tag index remains consistent after LRU evictions", () => {
  it("revalidateTag after evictions does not throw and only removes L1-resident entries", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 5 }),    // maxL1Size
        fc.array(fc.integer({ min: 0, max: 19 }), { minLength: 1, maxLength: 30 }), // key IDs
        fc.string({ minLength: 1, maxLength: 10 }),  // tag to invalidate
        async (maxL1Size, keyIds, tag) => {
          const cache = new DataCache(undefined, { maxL1Size });

          for (const id of keyIds) {
            await cache.set(makeKey(id), `v${id}`, { tags: [tag] });
          }

          // revalidateTag must not throw even after evictions have occurred
          await cache.revalidateTag(tag);

          // After invalidation, no entry with this tag should be in L1
          for (const id of new Set(keyIds)) {
            const result = await cache.get(makeKey(id), false);
            if (result !== null) return false;
          }

          return true;
        }
      ),
      { numRuns: 200 }
    );
  });
});
