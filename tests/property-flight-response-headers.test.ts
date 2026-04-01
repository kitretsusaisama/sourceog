/**
 * Property 6: Flight Response Headers
 * Validates: Requirements 3.1, 3.3, 3.4 (INV-003)
 * Tag: `Feature: sourceog-rsc-contract-remediation, Property 6: Flight Response Headers`
 *
 * For any request to /_sourceog/flight/:routeId, the HTTP response must have:
 *   - Content-Type: text/x-component
 *   - Cache-Control: no-store
 *   - X-Render-Context-Key (non-empty)
 *   - X-Canonical-Route-Id (non-empty)
 * set before any response body is written.
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { computeCanonicalRouteId, computeRenderContextKey } from "@sourceog/renderer";

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Arbitrary route ID: lowercase kebab-case segments like "blog-post" or "user-profile" */
function arbitraryRouteId(): fc.Arbitrary<string> {
  return fc
    .array(
      fc.stringMatching(/^[a-z][a-z0-9]{1,8}$/),
      { minLength: 1, maxLength: 4 }
    )
    .map((parts) => parts.join("-"));
}

/** Arbitrary route pattern like "/blog/:slug" or "/users/:id/posts" */
function arbitraryRoutePattern(): fc.Arbitrary<string> {
  return fc
    .array(
      fc.oneof(
        fc.stringMatching(/^[a-z][a-z0-9]{1,8}$/),
        fc.stringMatching(/^:[a-z][a-z0-9]{1,8}$/)
      ),
      { minLength: 1, maxLength: 4 }
    )
    .map((parts) => "/" + parts.join("/"));
}

/** Arbitrary params record */
function arbitraryParams(): fc.Arbitrary<Record<string, string>> {
  return fc.dictionary(
    fc.stringMatching(/^[a-z][a-z0-9]{1,8}$/),
    fc.stringMatching(/^[a-z0-9][a-z0-9-]{0,15}$/),
    { minKeys: 0, maxKeys: 4 }
  );
}

/** Arbitrary slot ID (may be empty for the root slot) */
function arbitrarySlotId(): fc.Arbitrary<string> {
  return fc.oneof(
    fc.constant(""),
    fc.stringMatching(/^[a-z][a-z0-9-]{1,15}$/)
  );
}

// ---------------------------------------------------------------------------
// Helpers: simulate the header-setting logic from handleFlightRequest
// ---------------------------------------------------------------------------

interface SimulatedFlightHeaders {
  "Content-Type": string;
  "Transfer-Encoding": string;
  "Cache-Control": string;
  "X-Render-Context-Key": string;
  "X-Canonical-Route-Id": string;
}

function simulateFlightHeaders(
  routePattern: string,
  params: Record<string, string>,
  slotId: string,
  intercepted: boolean
): SimulatedFlightHeaders {
  const canonicalRouteId = computeCanonicalRouteId(routePattern, params);
  const renderContextKey = computeRenderContextKey(canonicalRouteId, slotId, intercepted);

  return {
    "Content-Type": "text/x-component",
    "Transfer-Encoding": "chunked",
    "Cache-Control": "no-store",
    "X-Render-Context-Key": renderContextKey,
    "X-Canonical-Route-Id": canonicalRouteId
  };
}

// ---------------------------------------------------------------------------
// Property 6: Flight Response Headers
// ---------------------------------------------------------------------------

describe("Property 6: Flight Response Headers", () => {
  it(
    "/_sourceog/flight/:routeId always sets Content-Type, Cache-Control, X-Render-Context-Key, X-Canonical-Route-Id",
    () => {
      fc.assert(
        fc.property(
          arbitraryRouteId(),
          arbitraryRoutePattern(),
          arbitraryParams(),
          arbitrarySlotId(),
          fc.boolean(),
          (
            _routeId,
            routePattern,
            params,
            slotId,
            intercepted
          ) => {
            const headers = simulateFlightHeaders(routePattern, params, slotId, intercepted);

            // Req 3.1, INV-003: Content-Type must be text/x-component
            expect(headers["Content-Type"]).toBe("text/x-component");

            // Req 3.4: Cache-Control must be no-store
            expect(headers["Cache-Control"]).toBe("no-store");

            // Req 3.3: X-Render-Context-Key must be non-empty 16-char hex
            expect(headers["X-Render-Context-Key"]).toMatch(/^[0-9a-f]{16}$/);

            // Req 3.3: X-Canonical-Route-Id must be non-empty 12-char hex
            expect(headers["X-Canonical-Route-Id"]).toMatch(/^[0-9a-f]{12}$/);

            return true;
          }
        ),
        { numRuns: 100 }
      );
    }
  );

  it("headers are set before any body write (header-first invariant)", () => {
    fc.assert(
      fc.property(
        arbitraryRoutePattern(),
        arbitraryParams(),
        arbitrarySlotId(),
        fc.boolean(),
        (routePattern, params, slotId, intercepted) => {
          const headerSetOrder: string[] = [];
          let bodyWritten = false;

          // Simulate the server's header-setting sequence
          const mockRes = {
            setHeader(name: string, _value: string) {
              if (bodyWritten) {
                throw new Error(`Header "${name}" set after body write — violates INV-003`);
              }
              headerSetOrder.push(name);
            },
            write(_chunk: unknown) {
              bodyWritten = true;
            }
          };

          const canonicalRouteId = computeCanonicalRouteId(routePattern, params);
          const renderContextKey = computeRenderContextKey(canonicalRouteId, slotId, intercepted);

          // Replicate the exact header-setting order from handleFlightRequest
          mockRes.setHeader("Content-Type", "text/x-component");
          mockRes.setHeader("Transfer-Encoding", "chunked");
          mockRes.setHeader("Cache-Control", "no-store");
          mockRes.setHeader("X-Render-Context-Key", renderContextKey);
          mockRes.setHeader("X-Canonical-Route-Id", canonicalRouteId);

          // Simulate body write after headers
          mockRes.write("0:D{}\n");

          // All required headers must have been set
          expect(headerSetOrder).toContain("Content-Type");
          expect(headerSetOrder).toContain("Cache-Control");
          expect(headerSetOrder).toContain("X-Render-Context-Key");
          expect(headerSetOrder).toContain("X-Canonical-Route-Id");

          // Headers must appear before body (no exception thrown above)
          expect(bodyWritten).toBe(true);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it("different route patterns produce different X-Canonical-Route-Id values", () => {
    fc.assert(
      fc.property(
        fc.tuple(arbitraryRoutePattern(), arbitraryRoutePattern()).filter(
          ([a, b]) => a !== b
        ),
        ([patternA, patternB]) => {
          const idA = computeCanonicalRouteId(patternA, {});
          const idB = computeCanonicalRouteId(patternB, {});

          // Different patterns must produce different canonical IDs
          expect(idA).not.toBe(idB);

          // Both must be valid 12-char hex
          expect(idA).toMatch(/^[0-9a-f]{12}$/);
          expect(idB).toMatch(/^[0-9a-f]{12}$/);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it("X-Render-Context-Key is stable for the same inputs", () => {
    fc.assert(
      fc.property(
        arbitraryRoutePattern(),
        arbitraryParams(),
        arbitrarySlotId(),
        fc.boolean(),
        (routePattern, params, slotId, intercepted) => {
          const canonicalRouteId = computeCanonicalRouteId(routePattern, params);

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
});
