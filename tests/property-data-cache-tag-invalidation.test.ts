/**
 * Property 13: Data Cache Tag Invalidation Round-Trip
 * Validates: Requirements 10.6
 * Tag: `Feature: sourceog-rsc-contract-remediation, Property 13: Data Cache Tag Invalidation Round-Trip`
 */
import { describe, it } from "vitest";
import * as fc from "fast-check";
import { DataCache } from "@sourceog/runtime";
import type { DataCacheKey } from "@sourceog/runtime";

function arbitraryCacheKey(): fc.Arbitrary<DataCacheKey> {
  return fc.record({
    url: fc.webUrl(),
    method: fc.constantFrom("GET", "POST"),
    bodyHash: fc.constant(""),
    tags: fc.array(fc.string({ minLength: 1, maxLength: 20 }), { maxLength: 3 }),
    runtimeTarget: fc.constant("node" as const),
  });
}

function arbitraryCacheEntry() {
  return fc.record({
    key: arbitraryCacheKey(),
    value: fc.jsonValue(),
    ttl: fc.option(fc.integer({ min: 60, max: 3600 }), { nil: undefined }),
    tags: fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 1, maxLength: 3 }),
    createdAt: fc.constant(Date.now()),
  });
}

describe("Property 13: Data Cache Tag Invalidation Round-Trip", () => {
  it("revalidateTag removes all entries with that tag from L1", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(arbitraryCacheEntry(), { minLength: 1, maxLength: 10 }),
        fc.string({ minLength: 1, maxLength: 20 }),
        async (entries, tag) => {
          const cache = new DataCache(); // no L2 backend — pure L1 test

          // Populate cache with entries all tagged with T
          // Use DataCache.normalizeKey to get proper keys
          const keys: DataCacheKey[] = [];
          for (const entry of entries) {
            const key = entry.key;
            keys.push(key);
            // Set with the tag T included in the tags
            await cache.set(key, entry.value, { tags: [...entry.tags, tag] });
          }

          // Call revalidateTag(T)
          await cache.revalidateTag(tag);

          // Assert get(key) returns null for all those keys
          for (const key of keys) {
            const result = await cache.get(key);
            if (result !== null) return false;
          }
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it("revalidateTag preserves entries not tagged with T", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(arbitraryCacheEntry(), { minLength: 1, maxLength: 5 }),
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.string({ minLength: 1, maxLength: 20 }),
        async (entries, tagToInvalidate, otherTag) => {
          fc.pre(tagToInvalidate !== otherTag);
          const cache = new DataCache();

          const preservedKeys: DataCacheKey[] = [];
          for (const entry of entries) {
            preservedKeys.push(entry.key);
            // Tag with otherTag only — NOT tagToInvalidate
            await cache.set(entry.key, entry.value, { tags: [otherTag] });
          }

          await cache.revalidateTag(tagToInvalidate);

          // All entries should still be present
          for (const key of preservedKeys) {
            const result = await cache.get(key);
            if (result === null) return false;
          }
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});
