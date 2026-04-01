/**
 * Property 12: Data Cache Key Normalization
 * Validates: Requirements 10.4
 * Tag: `Feature: sourceog-rsc-contract-remediation, Property 12: Data Cache Key Normalization`
 */
import { describe, it } from "vitest";
import * as fc from "fast-check";
import { DataCache } from "@sourceog/runtime";

function arbitraryFetchRequest() {
  return fc.record({
    url: fc.webUrl(),
    method: fc.constantFrom("GET", "POST", "PUT", "DELETE", "PATCH", "HEAD"),
    body: fc.option(fc.string(), { nil: null }),
    tags: fc.array(fc.string({ minLength: 1, maxLength: 20 }), { maxLength: 5 }),
    runtimeTarget: fc.constantFrom("node" as const, "edge" as const),
  });
}

describe("Property 12: Data Cache Key Normalization", () => {
  it(
    "idempotency: normalizing the same request twice produces identical keys",
    () => {
      fc.assert(
        fc.property(arbitraryFetchRequest(), (req) => {
          const k1 = DataCache.normalizeKey(req);
          const k2 = DataCache.normalizeKey(req);
          return DataCache.serializeKey(k1) === DataCache.serializeKey(k2);
        }),
        { numRuns: 100 }
      );
    }
  );

  it(
    "method is uppercase: the method field in the normalized key is always uppercase",
    () => {
      fc.assert(
        fc.property(arbitraryFetchRequest(), (req) => {
          const key = DataCache.normalizeKey(req);
          return key.method === key.method.toUpperCase();
        }),
        { numRuns: 100 }
      );
    }
  );

  it(
    "tags are sorted: the tags field in the normalized key is always sorted lexicographically",
    () => {
      fc.assert(
        fc.property(arbitraryFetchRequest(), (req) => {
          const key = DataCache.normalizeKey(req);
          const sorted = [...key.tags].sort((a, b) => a.localeCompare(b));
          return JSON.stringify(key.tags) === JSON.stringify(sorted);
        }),
        { numRuns: 100 }
      );
    }
  );

  it(
    "semantic equivalence: requests differing only in method casing or tag order produce the same key",
    () => {
      fc.assert(
        fc.property(arbitraryFetchRequest(), (req) => {
          const variant = {
            ...req,
            method: req.method.toLowerCase(),
            tags: [...req.tags].reverse(),
          };
          const k1 = DataCache.normalizeKey(req);
          const k2 = DataCache.normalizeKey(variant);
          return DataCache.serializeKey(k1) === DataCache.serializeKey(k2);
        }),
        { numRuns: 100 }
      );
    }
  );

  it(
    "distinct requests produce different keys: requests differing in a meaningful dimension produce different serialized keys",
    () => {
      fc.assert(
        fc.property(
          fc.tuple(arbitraryFetchRequest(), arbitraryFetchRequest()),
          ([req1, req2]) => {
            const k1 = DataCache.normalizeKey(req1);
            const k2 = DataCache.normalizeKey(req2);

            // Filter to only pairs that are meaningfully different after normalization
            fc.pre(
              k1.url !== k2.url ||
              k1.method !== k2.method ||
              k1.bodyHash !== k2.bodyHash ||
              k1.runtimeTarget !== k2.runtimeTarget ||
              JSON.stringify(k1.tags) !== JSON.stringify(k2.tags)
            );

            return DataCache.serializeKey(k1) !== DataCache.serializeKey(k2);
          }
        ),
        { numRuns: 100 }
      );
    }
  );
});
