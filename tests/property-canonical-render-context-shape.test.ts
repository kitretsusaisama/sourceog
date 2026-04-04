/**
 * Property 9: CanonicalRenderContext Shape
 * Validates: Requirements 5.5, 5.6 (INV-001)
 * Tag: `Feature: sourceog-rsc-contract-remediation, Property 9: CanonicalRenderContext Shape`
 *
 * For any server render, the CanonicalRenderContext injected into the bootstrap script must:
 *   - Contain all required fields
 *   - NOT contain a bodyHtml field (INV-001: HTML always derived from Flight)
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { buildBootstrapScript } from "@sourceog/server";
import { computeCanonicalRouteId, computeRenderContextKey } from "@sourceog/renderer";

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

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

function arbitraryParams(): fc.Arbitrary<Record<string, string>> {
  return fc.dictionary(
    fc.stringMatching(/^[a-z][a-z0-9]{1,8}$/),
    fc.stringMatching(/^[a-z0-9][a-z0-9-]{0,15}$/),
    { minKeys: 0, maxKeys: 4 }
  );
}

function arbitrarySlotId(): fc.Arbitrary<string> {
  return fc.oneof(
    fc.constant(""),
    fc.stringMatching(/^[a-z][a-z0-9-]{1,15}$/)
  );
}

function arbitraryBuildId(): fc.Arbitrary<string> {
  return fc.stringMatching(/^[0-9a-f]{8,16}$/);
}

// ---------------------------------------------------------------------------
// Required fields per Req 5.5
// ---------------------------------------------------------------------------

const REQUIRED_FIELDS = [
  "renderMode",
  "canonicalRouteId",
  "resolvedRouteId",
  "renderContextKey",
  "parallelRouteMap",
  "intercepted",
  "clientReferenceManifestUrl",
  "buildId",
  "deployId"
] as const;

// ---------------------------------------------------------------------------
// Property 9: CanonicalRenderContext Shape
// ---------------------------------------------------------------------------

describe("Property 9: CanonicalRenderContext Shape", () => {
  it(
    "bootstrap script context contains all required fields and does NOT contain bodyHtml",
    () => {
      fc.assert(
        fc.property(
          arbitraryRoutePattern(),
          arbitraryParams(),
          arbitrarySlotId(),
          fc.boolean(),
          arbitraryBuildId(),
          (routePattern, params, slotId, intercepted, buildId) => {
            const canonicalRouteId = computeCanonicalRouteId(routePattern, params);
            const renderContextKey = computeRenderContextKey(canonicalRouteId, slotId, intercepted);

            const context = {
              renderMode: "server-components" as const,
              canonicalRouteId,
              resolvedRouteId: canonicalRouteId,
              renderContextKey,
              parallelRouteMap: slotId ? { [slotId]: renderContextKey } : {},
              intercepted,
              interceptedFrom: intercepted ? "/previous-path" : undefined,
              interceptedUrl: intercepted ? "/intercepted-url" : undefined,
              clientReferenceManifestUrl: "/__sourceog/client-refs.json",
              buildId,
              deployId: `deploy-${buildId}`
            };

            const script = buildBootstrapScript(context);

            // Extract the JSON from the script tag
            const match = script.match(/window\.__SOURCEOG_CLIENT_CONTEXT__=(\{.*?\});/s);
            expect(match).not.toBeNull();
            if (!match) {
              throw new Error("Expected script match for SOURCEOG_CLIENT_CONTEXT");
            }

            const parsed = JSON.parse(match[1]);

            // Req 5.5: all required fields must be present
            for (const field of REQUIRED_FIELDS) {
              expect(parsed, `Missing required field: ${field}`).toHaveProperty(field);
            }

            // Req 5.6, INV-001: bodyHtml must NOT be present
            expect(parsed).not.toHaveProperty("bodyHtml");

            // renderContextKey must be 16-char hex
            expect(parsed.renderContextKey).toMatch(/^[0-9a-f]{16}$/);

            // canonicalRouteId must be 12-char hex
            expect(parsed.canonicalRouteId).toMatch(/^[0-9a-f]{12}$/);

            // parallelRouteMap must be an object
            expect(typeof parsed.parallelRouteMap).toBe("object");

            // intercepted must be boolean
            expect(typeof parsed.intercepted).toBe("boolean");

            return true;
          }
        ),
        { numRuns: 100 }
      );
    }
  );

  it("hydrationMode deprecation proxy is installed in bootstrap script", () => {
    fc.assert(
      fc.property(
        arbitraryRoutePattern(),
        arbitraryParams(),
        arbitraryBuildId(),
        (routePattern, params, buildId) => {
          const canonicalRouteId = computeCanonicalRouteId(routePattern, params);
          const renderContextKey = computeRenderContextKey(canonicalRouteId, "", false);

          const context = {
            renderMode: "server-components" as const,
            canonicalRouteId,
            resolvedRouteId: canonicalRouteId,
            renderContextKey,
            parallelRouteMap: {},
            intercepted: false,
            clientReferenceManifestUrl: "/__sourceog/client-refs.json",
            buildId,
            deployId: `deploy-${buildId}`
          };

          const script = buildBootstrapScript(context);

          // Req 4.8, 12.7: hydrationMode deprecation proxy must be present
          expect(script).toContain("hydrationMode");
          expect(script).toContain("hydrationMode is deprecated");
          expect(script).toContain("renderMode");

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it("interceptedFrom is present when intercepted=true and absent when intercepted=false", () => {
    fc.assert(
      fc.property(
        arbitraryRoutePattern(),
        arbitraryParams(),
        arbitraryBuildId(),
        (routePattern, params, buildId) => {
          const canonicalRouteId = computeCanonicalRouteId(routePattern, params);
          const renderContextKey = computeRenderContextKey(canonicalRouteId, "", true);

          const contextIntercepted = {
            renderMode: "server-components" as const,
            canonicalRouteId,
            resolvedRouteId: canonicalRouteId,
            renderContextKey,
            parallelRouteMap: {},
            intercepted: true,
            interceptedFrom: "/originating-path",
            clientReferenceManifestUrl: "/__sourceog/client-refs.json",
            buildId,
            deployId: `deploy-${buildId}`
          };

          const scriptIntercepted = buildBootstrapScript(contextIntercepted);
          const matchIntercepted = scriptIntercepted.match(/window\.__SOURCEOG_CLIENT_CONTEXT__=(\{.*?\});/s);

          if (!matchIntercepted || !matchIntercepted[1]) {
            throw new Error("Expected __SOURCEOG_CLIENT_CONTEXT__ in scriptIntercepted");
          }

          const parsedIntercepted = JSON.parse(matchIntercepted[1]);

          // Req 5.2: interceptedFrom must be present when intercepted=true
          expect(parsedIntercepted.intercepted).toBe(true);
          expect(parsedIntercepted.interceptedFrom).toBe("/originating-path");

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});
