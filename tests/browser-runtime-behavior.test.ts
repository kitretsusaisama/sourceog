/** //browser-runtime-behavior.test.ts
 * Unit tests for browser runtime behavior
 * Requirements: 4.5, 4.6, 4.8, 5.2
 *
 * Tests:
 * - Navigation fetch failure → location.href assignment, not hardFallbackHtmlReplace
 * - Intercepted route render sets intercepted: true and interceptedFrom
 * - hydrationMode access emits deprecation warning
 * - Slot refresh applies only to data-sourceog-slot container
 */

import { describe, it, expect } from "vitest";
import { getClientRuntimeScript } from "@sourceog/dev";
import { buildBootstrapScript } from "@sourceog/server";
import { computeCanonicalRouteId, computeRenderContextKey } from "@sourceog/renderer";

describe("browser runtime behavior", () => {
  // ---------------------------------------------------------------------------
  // Req 4.5: Navigation fetch failure → location.href, not hardFallbackHtmlReplace
  // ---------------------------------------------------------------------------

  describe("navigation fetch failure handling (Req 4.5)", () => {
    it("refreshRoute falls back to location.assign on fetch failure, not hardFallbackHtmlReplace", () => {
      const script = getClientRuntimeScript();

      // The refreshRoute / navigateTo function must use location.assign on error
      expect(script).toContain("window.location.assign(url)");

      // On fetch failure (snapshotResponse not ok), must use location.assign
      expect(script).toContain("if (!snapshotResponse.ok)");
      expect(script).toContain("window.location.assign(url)");

      // The catch block must also use location.assign, not hardFallbackHtmlReplace
      const catchIdx = script.indexOf("} catch (error) {\n      console.error(\"[SourceOG] Failed to refresh route from Flight payload.\", error);\n      window.location.assign(url);");
      expect(catchIdx).toBeGreaterThan(-1);
    });

    it("navigateTo and refreshCurrentRoute are exposed on window", () => {
      const script = getClientRuntimeScript();

      // Req 4.4, 4.5: navigateTo and refreshCurrentRoute must be exposed
      expect(script).toContain("window.__SOURCEOG_NAVIGATE_TO__ = navigateTo");
      expect(script).toContain("window.__SOURCEOG_REFRESH_CURRENT_ROUTE__ = refreshCurrentRoute");
    });

    it("navigateTo delegates to refreshRoute (same fetch + fallback logic)", () => {
      const script = getClientRuntimeScript();

      // navigateTo must call refreshRoute
      expect(script).toContain("async function navigateTo(url, replaceState = false)");
      expect(script).toContain("return refreshRoute(url, replaceState)");
    });

    it("refreshCurrentRoute delegates to refreshRoute with current URL", () => {
      const script = getClientRuntimeScript();

      expect(script).toContain("async function refreshCurrentRoute(replaceState = false)");
      expect(script).toContain("return refreshRoute(window.location.pathname + window.location.search, replaceState)");
    });
  });

  // ---------------------------------------------------------------------------
  // Req 5.2: Intercepted route render sets intercepted: true and interceptedFrom
  // ---------------------------------------------------------------------------

  describe("intercepted route context (Req 5.2)", () => {
    it("buildBootstrapScript includes intercepted: true and interceptedFrom for intercepted routes", () => {
      const canonicalRouteId = computeCanonicalRouteId("/blog/:slug", { slug: "hello" });
      const renderContextKey = computeRenderContextKey(canonicalRouteId, "", true);

      const context = {
        renderMode: "server-components" as const,
        canonicalRouteId,
        resolvedRouteId: canonicalRouteId,
        renderContextKey,
        parallelRouteMap: {},
        intercepted: true,
        interceptedFrom: "/blog",
        interceptedUrl: "/blog/hello",
        clientReferenceManifestUrl: "/__sourceog/client-refs.json",
        buildId: "test-build",
        deployId: "test-deploy"
      };

      const script = buildBootstrapScript(context);
      const match = script.match(/window\.__SOURCEOG_CLIENT_CONTEXT__=(\{.*?\});/s);
      expect(match).not.toBeNull();

      if (!match || !match[1]) {
        throw new Error('Expected client context JSON match');
      }
      const parsed = JSON.parse(match[1]);

      // Req 5.2: intercepted must be true
      expect(parsed.intercepted).toBe(true);

      // Req 5.2: interceptedFrom must be set to the originating pathname
      expect(parsed.interceptedFrom).toBe("/blog");

      // interceptedUrl must also be present
      expect(parsed.interceptedUrl).toBe("/blog/hello");
    });

    it("buildBootstrapScript sets intercepted: false for non-intercepted routes", () => {
      const canonicalRouteId = computeCanonicalRouteId("/about", {});
      const renderContextKey = computeRenderContextKey(canonicalRouteId, "", false);

      const context = {
        renderMode: "server-components" as const,
        canonicalRouteId,
        resolvedRouteId: canonicalRouteId,
        renderContextKey,
        parallelRouteMap: {},
        intercepted: false,
        clientReferenceManifestUrl: "/__sourceog/client-refs.json",
        buildId: "test-build",
        deployId: "test-deploy"
      };

      const script = buildBootstrapScript(context);
      const match = script.match(/window\.__SOURCEOG_CLIENT_CONTEXT__=(\{.*?\});/s);
      if (!match?.[1]) {
        throw new Error('Expected client context in bootstrap script');
      }
      const parsed = JSON.parse(match[1]);

      expect(parsed.intercepted).toBe(false);
      expect(parsed.interceptedFrom).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Req 4.8, 12.7: hydrationMode access emits deprecation warning
  // ---------------------------------------------------------------------------

  describe("hydrationMode deprecation proxy (Req 4.8, 12.7)", () => {
    it("buildBootstrapScript installs Object.defineProperty for hydrationMode", () => {
      const canonicalRouteId = computeCanonicalRouteId("/", {});
      const renderContextKey = computeRenderContextKey(canonicalRouteId, "", false);

      const context = {
        renderMode: "server-components" as const,
        canonicalRouteId,
        resolvedRouteId: canonicalRouteId,
        renderContextKey,
        parallelRouteMap: {},
        intercepted: false,
        clientReferenceManifestUrl: "/__sourceog/client-refs.json",
        buildId: "test-build",
        deployId: "test-deploy"
      };

      const script = buildBootstrapScript(context);

      // Must use Object.defineProperty for the deprecation proxy
      expect(script).toContain("Object.defineProperty");
      expect(script).toContain("hydrationMode");
      expect(script).toContain("hydrationMode is deprecated. Use renderMode instead.");
    });

    it("hydrationMode getter returns mapped value based on renderMode", () => {
      const canonicalRouteId = computeCanonicalRouteId("/", {});
      const renderContextKey = computeRenderContextKey(canonicalRouteId, "", false);

      const contextServerComponents = {
        renderMode: "server-components" as const,
        canonicalRouteId,
        resolvedRouteId: canonicalRouteId,
        renderContextKey,
        parallelRouteMap: {},
        intercepted: false,
        clientReferenceManifestUrl: "/__sourceog/client-refs.json",
        buildId: "test-build",
        deployId: "test-deploy"
      };

      const script = buildBootstrapScript(contextServerComponents);

      // The proxy must map server-components → "mixed-route"
      expect(script).toContain('"mixed-route"');

      // The proxy must map client-root → "full-route"
      expect(script).toContain('"full-route"');
    });

    it("client runtime script also has hydrationMode deprecation proxy", () => {
      const script = getClientRuntimeScript();

      // The installHydrationModeProxy function must emit the deprecation warning
      expect(script).toContain("function installHydrationModeProxy(context)");
      expect(script).toContain("hydrationMode is deprecated. Use renderMode instead.");
    });
  });

  // ---------------------------------------------------------------------------
  // Req 4.6, INV-008: Slot refresh applies only to data-sourceog-slot container
  // ---------------------------------------------------------------------------

  describe("slot refresh isolation (Req 4.6, INV-008)", () => {
    it("applyCanonicalFlight targets data-sourceog-slot container for slot refreshes", () => {
      const script = getClientRuntimeScript();

      // Must query for data-sourceog-slot attribute
      expect(script).toContain('data-sourceog-slot');
      expect(script).toContain('querySelector(`[data-sourceog-slot="');
    });

    it("slot refresh updates parallelRouteMap with new renderContextKey", () => {
      const script = getClientRuntimeScript();

      // After slot refresh, parallelRouteMap must be updated (Req 5.3)
      expect(script).toContain("parallelRouteMap");
      expect(script).toContain("payload.renderContextKey");
    });

    it("applyCanonicalFlight updates window.__SOURCEOG_CLIENT_CONTEXT__ after success", () => {
      const script = getClientRuntimeScript();

      // Req 4.7: after successful Flight apply, update renderContextKey and canonicalRouteId
      expect(script).toContain("ctx.renderContextKey = payload.renderContextKey");
      expect(script).toContain("ctx.canonicalRouteId = payload.canonicalRouteId");
    });
  });

  // ---------------------------------------------------------------------------
  // Req 4.4: Flight fetch includes Accept and X-Render-Context-Key headers
  // ---------------------------------------------------------------------------

  describe("Flight fetch headers (Req 4.4)", () => {
    it("fetchFlightUpdate sends Accept: text/x-component header", () => {
      const script = getClientRuntimeScript();

      expect(script).toContain('"Accept": "text/x-component"');
    });

    it("fetchFlightUpdate sends X-Render-Context-Key header", () => {
      const script = getClientRuntimeScript();

      expect(script).toContain('"X-Render-Context-Key"');
    });
  });

  // ---------------------------------------------------------------------------
  // Req 4.1, INV-009: root.render() used on success path, never innerHTML
  // ---------------------------------------------------------------------------

  describe("RSC-first apply (Req 4.1, INV-009)", () => {
    it("applyCanonicalFlight uses reactRoot.render() not innerHTML on success path", () => {
      const script = getClientRuntimeScript();

      // Must use reactRoot.render() on success path
      expect(script).toContain("reactRoot.render(");

      // Must NOT call hydrateRoot (INV-009)
      expect(script).not.toContain("hydrateRoot(");
    });

    it("hardFallbackHtmlReplace is the only place innerHTML is set on success-path containers", () => {
      const script = getClientRuntimeScript();

      // The hardFallbackHtmlReplace function must exist
      const fallbackFnStart = script.indexOf("async function hardFallbackHtmlReplace(payload, reason)");
      expect(fallbackFnStart).toBeGreaterThan(-1);

      // The function must contain innerHTML assignments (for the fallback DOM replacement)
      const fallbackSection = script.slice(fallbackFnStart, fallbackFnStart + 1000);
      expect(fallbackSection).toContain("innerHTML");

      // applyCanonicalFlight must NOT contain innerHTML assignment (success path)
      const applyFnStart = script.indexOf("async function applyCanonicalFlight(payload, streamedFlightBody = null)");
      const applyFnEnd = script.indexOf("\n  async function hardFallbackHtmlReplace", applyFnStart);
      const applySection = script.slice(applyFnStart, applyFnEnd);
      expect(applySection).not.toContain(".innerHTML =");
    });
  });
});
