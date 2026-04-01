/**
 * CanonicalRenderContext — the typed shape of window.__SOURCEOG_CLIENT_CONTEXT__
 * injected into every HTML response bootstrap script.
 *
 * INV-001: bodyHtml is intentionally absent — HTML is always derived from Flight output.
 * Requirements: 5.5, 5.6
 */

import type { RouteRenderMode } from "./contracts.js";

export interface CanonicalRenderContext {
  /** Whether this route renders as server components or a client root. */
  renderMode: RouteRenderMode;

  /** sha256(routePattern + normalizedParams)[:12] — stable 12-char hex. */
  canonicalRouteId: string;

  /** The actual matched route ID (may differ from canonicalRouteId for dynamic routes). */
  resolvedRouteId: string;

  /**
   * sha256(canonicalRouteId + slotId + intercepted)[:16] — stable 16-char hex.
   * Used as the isolation key for slot and intercept refreshes (INV-008).
   */
  renderContextKey: string;

  /** Maps slotId → renderContextKey for parallel route slots. */
  parallelRouteMap: Record<string, string>;

  /** Whether this render is an intercepted route. */
  intercepted: boolean;

  /** The originating pathname when intercepted is true. */
  interceptedFrom?: string;

  /** The intercepted URL when intercepted is true. */
  interceptedUrl?: string;

  /** URL to the browser client reference manifest (/_sourceog/client-refs.json). */
  clientReferenceManifestUrl: string;

  /** Build identifier for cache-busting and diagnostics. */
  buildId: string;

  /** Deployment identifier for multi-deployment environments. */
  deployId: string;

  // NOTE: bodyHtml is intentionally absent (Req 5.6, INV-001).
  // HTML is always derived from Flight output via createFromReadableStream.
}
