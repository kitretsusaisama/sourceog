/**
 * Property 8: renderContextKey Uniqueness
 * Validates: Requirements 5.1
 * Tag: `Feature: sourceog-rsc-contract-remediation, Property 8: renderContextKey Uniqueness`
 *
 * For any two distinct combinations of (canonicalRouteId, slotId, intercepted),
 * the derived renderContextKey values must be different.
 * Each key must always be exactly 16 lowercase hex characters.
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { computeRenderContextKey } from "@sourceog/renderer";

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Arbitrary canonicalRouteId: 12-char lowercase hex */
function arbitraryCanonicalRouteId(): fc.Arbitrary<string> {
  return fc.stringMatching(/^[0-9a-f]{12}$/);
}

/** Arbitrary slotId: empty string or short kebab-case identifier */
function arbitrarySlotId(): fc.Arbitrary<string> {
  return fc.oneof(
    fc.constant(""),
    fc.stringMatching(/^[a-z][a-z0-9-]{1,15}$/)
  );
}

// ---------------------------------------------------------------------------
// Property 8: renderContextKey Uniqueness
// ---------------------------------------------------------------------------

describe("Property 8: renderContextKey Uniqueness", () => {
  it(
    "two distinct (canonicalRouteId, slotId, intercepted) tuples produce different renderContextKey values",
    () => {
      fc.assert(
        fc.property(
          fc.tuple(arbitraryCanonicalRouteId(), arbitrarySlotId(), fc.boolean()),
          fc.tuple(arbitraryCanonicalRouteId(), arbitrarySlotId(), fc.boolean()),
          (tupleA, tupleB) => {
            // fc.pre guard: the two tuples must be distinct
            fc.pre(
              tupleA[0] !== tupleB[0] ||
              tupleA[1] !== tupleB[1] ||
              tupleA[2] !== tupleB[2]
            );

            const [canonicalRouteIdA, slotIdA, interceptedA] = tupleA;
            const [canonicalRouteIdB, slotIdB, interceptedB] = tupleB;

            const keyA = computeRenderContextKey(canonicalRouteIdA, slotIdA, interceptedA);
            const keyB = computeRenderContextKey(canonicalRouteIdB, slotIdB, interceptedB);

            // Keys must differ for distinct inputs
            expect(keyA).not.toBe(keyB);

            // Both keys must be exactly 16 lowercase hex characters
            expect(keyA).toMatch(/^[0-9a-f]{16}$/);
            expect(keyB).toMatch(/^[0-9a-f]{16}$/);

            return true;
          }
        ),
        { numRuns: 100 }
      );
    }
  );

  it("renderContextKey is stable for the same inputs (deterministic)", () => {
    fc.assert(
      fc.property(
        arbitraryCanonicalRouteId(),
        arbitrarySlotId(),
        fc.boolean(),
        (canonicalRouteId, slotId, intercepted) => {
          const key1 = computeRenderContextKey(canonicalRouteId, slotId, intercepted);
          const key2 = computeRenderContextKey(canonicalRouteId, slotId, intercepted);

          expect(key1).toBe(key2);
          expect(key1).toMatch(/^[0-9a-f]{16}$/);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it("intercepted=true and intercepted=false produce different keys for the same route+slot", () => {
    fc.assert(
      fc.property(
        arbitraryCanonicalRouteId(),
        arbitrarySlotId(),
        (canonicalRouteId, slotId) => {
          const keyFalse = computeRenderContextKey(canonicalRouteId, slotId, false);
          const keyTrue = computeRenderContextKey(canonicalRouteId, slotId, true);

          expect(keyFalse).not.toBe(keyTrue);
          expect(keyFalse).toMatch(/^[0-9a-f]{16}$/);
          expect(keyTrue).toMatch(/^[0-9a-f]{16}$/);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it("different slotIds produce different keys for the same route+intercepted", () => {
    fc.assert(
      fc.property(
        arbitraryCanonicalRouteId(),
        fc.tuple(
          fc.stringMatching(/^[a-z][a-z0-9-]{1,10}$/),
          fc.stringMatching(/^[a-z][a-z0-9-]{1,10}$/)
        ).filter(([a, b]) => a !== b),
        fc.boolean(),
        (canonicalRouteId, [slotIdA, slotIdB], intercepted) => {
          const keyA = computeRenderContextKey(canonicalRouteId, slotIdA, intercepted);
          const keyB = computeRenderContextKey(canonicalRouteId, slotIdB, intercepted);

          expect(keyA).not.toBe(keyB);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});
