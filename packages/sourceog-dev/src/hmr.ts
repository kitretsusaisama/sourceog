import chokidar, { type FSWatcher } from "chokidar";
import type { Server as HttpServer } from "node:http";
import { WebSocketServer } from "ws";
import { DevDiagnosticsBus, type DevClientMessage } from "./diagnostics.js";

// ---------------------------------------------------------------------------
// Phase 9: Fast Refresh Kernel (Requirements 11.1–11.6)
// ---------------------------------------------------------------------------

/**
 * Represents a React component boundary that can be independently refreshed.
 * Captures fiber state before refresh so it can be restored after.
 */
export interface RefreshBoundary {
  /** Normalized module path of the changed file */
  moduleId: string;
  /** The React component type at this boundary */
  componentType: unknown;
  /** React fiber instance IDs within this boundary */
  instanceIds: string[];
  /** State keyed by instance ID, captured before refresh */
  preservedState: Map<string, unknown>;
}

/**
 * Module graph node used by detectMinimalBoundary().
 * Callers supply this to describe the import graph.
 */
export interface ModuleGraphNode {
  /** Normalized module path */
  moduleId: string;
  /** Whether this module is a React component boundary */
  isComponentBoundary: boolean;
  /** Whether this module is the root layout or React root */
  isRootLayout: boolean;
  /** Modules that import this module (reverse edges) */
  importedBy: string[];
}

/**
 * Result of detectMinimalBoundary().
 */
export interface MinimalBoundaryResult {
  /** The smallest affected React component boundary module ID */
  boundaryId: string;
  /** True when the change requires a full page reload */
  requiresFullReload: boolean;
}

/**
 * Walk the module graph from `changedFile` upward (via importedBy edges) to
 * find the smallest enclosing React component boundary.
 *
 * Returns `{ requiresFullReload: true }` when the changed file is the root
 * layout or the React root itself (Req 11.4).
 *
 * Requirements: 11.1, 11.3
 */
export function detectMinimalBoundary(
  changedFile: string,
  moduleGraph: Map<string, ModuleGraphNode>
): MinimalBoundaryResult {
  const startNode = moduleGraph.get(changedFile);

  // If the changed file is the root layout or React root → full page reload
  if (!startNode || startNode.isRootLayout) {
    return { boundaryId: changedFile, requiresFullReload: true };
  }

  // BFS upward through importedBy edges to find the smallest boundary
  const visited = new Set<string>();
  const queue: string[] = [changedFile];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    const node = moduleGraph.get(current);
    if (!node) continue;

    // If this node is a root layout, require full reload
    if (node.isRootLayout) {
      return { boundaryId: current, requiresFullReload: true };
    }

    // If this node is a component boundary (and not the start), it's our target
    if (node.isComponentBoundary && current !== changedFile) {
      return { boundaryId: current, requiresFullReload: false };
    }

    // If the changed file itself is a component boundary, use it
    if (node.isComponentBoundary && current === changedFile) {
      return { boundaryId: current, requiresFullReload: false };
    }

    for (const parent of node.importedBy) {
      if (!visited.has(parent)) {
        queue.push(parent);
      }
    }
  }

  // No boundary found — require full reload as safe fallback
  return { boundaryId: changedFile, requiresFullReload: true };
}

/**
 * Capture fiber state for a boundary before refresh.
 * Returns null when the boundary cannot be found in the fiber tree.
 *
 * Requirements: 11.5
 */
export function snapshotRefreshBoundary(
  boundaryId: string,
  fiberRegistry: Map<string, { instanceIds: string[]; componentType: unknown; stateMap: Map<string, unknown> }>
): RefreshBoundary | null {
  const entry = fiberRegistry.get(boundaryId);
  if (!entry) {
    return null;
  }

  return {
    moduleId: boundaryId,
    componentType: entry.componentType,
    instanceIds: [...entry.instanceIds],
    preservedState: new Map(entry.stateMap)
  };
}

/**
 * Restore fiber state to matching instances after a boundary refresh.
 * Only instances whose IDs appear in `boundary.instanceIds` are updated.
 * Components outside the boundary are never touched (Req 11.3).
 *
 * Requirements: 11.3, 11.5
 */
export function restoreRefreshBoundaryState(
  boundary: RefreshBoundary,
  newComponentType: unknown,
  fiberRegistry: Map<string, { instanceIds: string[]; componentType: unknown; stateMap: Map<string, unknown> }>
): void {
  const entry = fiberRegistry.get(boundary.moduleId);
  if (!entry) {
    return;
  }

  // Update the component type to the new version
  entry.componentType = newComponentType;

  // Restore preserved state only for instances that existed before the refresh
  for (const instanceId of boundary.instanceIds) {
    const preserved = boundary.preservedState.get(instanceId);
    if (preserved !== undefined) {
      entry.stateMap.set(instanceId, preserved);
    }
  }
}

export interface DevRuntime {
  watcher: FSWatcher;
  wsServer: WebSocketServer;
  diagnosticsBus: DevDiagnosticsBus;
  close(): Promise<void>;
}

/**
 * Options for applyBoundaryRefresh — the server-side fast refresh orchestrator.
 * Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6
 */
export interface BoundaryRefreshOptions {
  changedFile: string;
  moduleGraph: Map<string, ModuleGraphNode>;
  fiberRegistry: Map<string, { instanceIds: string[]; componentType: unknown; stateMap: Map<string, unknown> }>;
  /** Render the boundary via RSC_Worker_Pool and return a Flight stream */
  renderBoundary: (boundaryId: string) => Promise<ReadableStream<Uint8Array>>;
  /** Apply the Flight stream to the React subtree (calls applyCanonicalFlight internally) */
  applyFlight: (boundaryId: string, stream: ReadableStream<Uint8Array>) => Promise<void>;
  /** Trigger a full page reload */
  triggerFullReload: () => void;
  /** Log a [SOURCEOG-FALLBACK] structured error */
  logFallback: (reason: unknown) => void;
}

/**
 * Fast refresh flow (Req 11.1–11.6):
 *
 * 1. detectMinimalBoundary() — find smallest affected React component boundary
 * 2. If root layout or React root → full page reload (Req 11.4)
 * 3. Otherwise: snapshotRefreshBoundary() → renderBoundary() → applyFlight() → restoreRefreshBoundaryState()
 * 4. On any failure: full page reload + [SOURCEOG-FALLBACK] log (Req 11.6)
 * 5. Components outside the changed boundary are never re-rendered (Req 11.3)
 */
export async function applyBoundaryRefresh(opts: BoundaryRefreshOptions): Promise<void> {
  const { changedFile, moduleGraph, fiberRegistry, renderBoundary, applyFlight, triggerFullReload, logFallback } = opts;

  // Step 1: find the minimal boundary
  const result = detectMinimalBoundary(changedFile, moduleGraph);

  // Step 2: root layout / React root → full page reload (Req 11.4)
  if (result.requiresFullReload) {
    triggerFullReload();
    return;
  }

  // Step 3: snapshot → render → apply → restore
  const snapshot = snapshotRefreshBoundary(result.boundaryId, fiberRegistry);

  try {
    const stream = await renderBoundary(result.boundaryId);
    await applyFlight(result.boundaryId, stream);

    // Restore state to matching instances after refresh (Req 11.5)
    if (snapshot) {
      // newComponentType is resolved from the updated fiberRegistry after render
      const updatedEntry = fiberRegistry.get(result.boundaryId);
      if (updatedEntry) {
        restoreRefreshBoundaryState(snapshot, updatedEntry.componentType, fiberRegistry);
      }
    }
  } catch (reason) {
    // Step 4: on any failure → full page reload + [SOURCEOG-FALLBACK] log (Req 11.6)
    logFallback(reason);
    triggerFullReload();
  }
}

export function createDevRuntime(
  server: HttpServer,
  watchPath: string,
  onChange: (eventName: string, changedPath: string) => Promise<{ fullReload: boolean; routeCount: number; diagnostics: DevClientMessage["diagnostics"]; affectedRouteIds?: string[]; affectedChunkIds?: string[] } | void> | { fullReload: boolean; routeCount: number; diagnostics: DevClientMessage["diagnostics"]; affectedRouteIds?: string[]; affectedChunkIds?: string[] } | void
): DevRuntime {
  const wsServer = new WebSocketServer({ server, path: "/__sourceog/ws" });
  const diagnosticsBus = new DevDiagnosticsBus();
  const watcher = chokidar.watch(watchPath, {
    ignoreInitial: true
  });

  const broadcast = (payload: DevClientMessage): void => {
    for (const client of wsServer.clients) {
      client.send(JSON.stringify(payload));
    }
  };

  diagnosticsBus.subscribe((message) => {
    broadcast(message);
  });

  watcher.on("all", async (eventName, changedPath) => {
    const result = await onChange(eventName, changedPath);
    if (result?.diagnostics) {
      diagnosticsBus.setIssues(result.diagnostics.issues);
    }

    diagnosticsBus.emitSync({
      changedFile: changedPath,
      changedAt: new Date().toISOString(),
      fullReload: result?.fullReload ?? true,
      affectedRouteIds: result?.affectedRouteIds ?? [],
      affectedChunkIds: result?.affectedChunkIds ?? [],
      routeCount: result?.routeCount ?? 0
    });
  });

  return {
    watcher,
    wsServer,
    diagnosticsBus,
    async close() {
      await watcher.close();
      wsServer.close();
    }
  };
}

export function getClientRuntimeScript(): string {
  return `
import React from "react";
import { createRoot } from "react-dom/client";
import { createFromReadableStream } from "react-server-dom-webpack/client.browser";

(() => {
  const overlayId = "__sourceog-dev-overlay";
  let overlay = null;
  const entryModuleCache = new Map();
  const flightRoots = new WeakMap();
  let moduleMapPromise = null;

  function ensureOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement("div");
    overlay.id = overlayId;
    overlay.style.position = "fixed";
    overlay.style.right = "16px";
    overlay.style.bottom = "16px";
    overlay.style.maxWidth = "420px";
    overlay.style.maxHeight = "50vh";
    overlay.style.overflow = "auto";
    overlay.style.padding = "12px 14px";
    overlay.style.borderRadius = "14px";
    overlay.style.background = "rgba(15,23,42,0.96)";
    overlay.style.color = "#e5eefb";
    overlay.style.fontFamily = "ui-monospace, SFMono-Regular, Consolas, monospace";
    overlay.style.fontSize = "12px";
    overlay.style.lineHeight = "1.5";
    overlay.style.boxShadow = "0 20px 40px rgba(0,0,0,0.35)";
    overlay.style.zIndex = "2147483647";
    overlay.style.display = "none";
    document.body.appendChild(overlay);
    return overlay;
  }

  function renderDiagnostics(diagnostics) {
    const host = ensureOverlay();
    const issues = diagnostics?.issues ?? [];
    if (!issues.length) {
      host.style.display = "none";
      host.innerHTML = "";
      return;
    }

    host.style.display = "block";
    host.innerHTML = [
      "<div style=\\"font-weight:700;margin-bottom:8px\\">SourceOG Diagnostics</div>",
      ...issues.map((issue) => {
        return "<div style=\\"margin-bottom:10px;padding:10px;border-radius:10px;background:rgba(255,255,255,0.06)\\">" +
          "<div style=\\"font-weight:600;color:" + (issue.level === "error" ? "#fca5a5" : issue.level === "warn" ? "#fde68a" : "#93c5fd") + "\\">" + issue.code + "</div>" +
          "<div>" + issue.message + "</div>" +
          (issue.recoveryHint ? "<div style=\\"margin-top:6px;color:#cbd5e1\\">Hint: " + issue.recoveryHint + "</div>" : "") +
          "</div>";
      })
    ].join("");
  }

  async function loadRouteBootstrap(entryAssetHref) {
    if (!entryAssetHref) {
      return null;
    }

    if (!entryModuleCache.has(entryAssetHref)) {
      entryModuleCache.set(entryAssetHref, import(entryAssetHref));
    }

    return entryModuleCache.get(entryAssetHref);
  }

  async function bootstrapClientRoute() {
    const context = window.__SOURCEOG_CLIENT_CONTEXT__;
    const renderMode = context?.renderMode ?? (context?.hydrationMode === "full-route" ? "client-root" : "server-components");
    if (!context || (renderMode !== "client-root" && renderMode !== "server-components")) {
      return;
    }

    if (renderMode === "server-components") {
      try {
        if (context?.rscPayloadFormat === "react-flight-text" && Array.isArray(context?.rscPayloadChunks)) {
          await applyCanonicalFlight(context, createFlightReadableStream(context.rscPayloadChunks));
        }
      } catch (error) {
        console.error("[SourceOG] Failed to bootstrap client boundaries.", error);
      }
      return;
    }

    if (!context.entryAssetHref) {
      return;
    }

    try {
      const routeModule = await loadRouteBootstrap(context.entryAssetHref);
      const bootstrap = routeModule?.sourceogBootstrapRoute ?? routeModule?.default;
      if (typeof bootstrap !== "function") {
        console.warn("[SourceOG] Route entry does not expose a bootstrap function.", {
          entryAssetHref: context.entryAssetHref
        });
        return;
      }
      await bootstrap();
    } catch (error) {
      console.error("[SourceOG] Failed to bootstrap client route.", error);
    }
  }

  function getActiveRouteSnapshot() {
    return window.__SOURCEOG_LAST_RENDER_SNAPSHOT__
      ?? window.__SOURCEOG_INITIAL_RENDER_SNAPSHOT__
      ?? window.__SOURCEOG_CLIENT_CONTEXT__
      ?? null;
  }

  function createHistorySnapshotState(snapshot) {
    return {
      ...(history.state ?? {}),
      __sourceog: {
        pathname: snapshot.pathname,
        canonicalRouteId: snapshot.canonicalRouteId,
        resolvedRouteId: snapshot.resolvedRouteId,
        renderContextKey: snapshot.renderContextKey,
        renderContext: snapshot.renderContext,
        intercepted: snapshot.intercepted,
        parallelRouteMap: snapshot.parallelRouteMap,
        flightHref: snapshot.flightHref
      }
    };
  }

  function createFlightHref(url, routeContext) {
    const nextUrl = new URL(url, window.location.href);
    const query = new URLSearchParams({
      pathname: nextUrl.pathname + nextUrl.search
    });
    const intercept = nextUrl.searchParams.get("__sourceog_intercept");
    if (intercept === "1" || intercept === "true" || routeContext?.intercepted === true) {
      query.set("intercept", "1");
    }
    return \`/__sourceog/flight?\${query.toString()}\`;
  }

  function updateDocumentTitle(headHtml) {
    if (!headHtml) {
      return;
    }

    const nextDocument = new DOMParser().parseFromString(
      \`<!DOCTYPE html><html><head>\${headHtml}</head><body></body></html>\`,
      "text/html"
    );
    if (nextDocument.title) {
      document.title = nextDocument.title;
    }
  }

  function createFlightReadableStream(chunks) {
    const encoder = new TextEncoder();
    return new ReadableStream({
      start(controller) {
        for (const chunk of chunks ?? []) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      }
    });
  }

  function getOrCreateReactRoot(container) {
    const existing = flightRoots.get(container);
    if (existing) {
      return existing;
    }

    const root = createRoot(container);
    flightRoots.set(container, root);
    return root;
  }

  async function loadModuleMap() {
    if (moduleMapPromise) {
      return moduleMapPromise;
    }

    const manifestUrl = window.__SOURCEOG_CLIENT_CONTEXT__?.clientReferenceManifestUrl;
    if (!manifestUrl) {
      moduleMapPromise = Promise.resolve({});
      return moduleMapPromise;
    }

    moduleMapPromise = fetch(manifestUrl)
      .then((response) => response.ok ? response.json() : {})
      .then((manifest) => {
        const registry = manifest?.registry ?? {};
        const moduleMap = {};

        for (const entry of Object.values(registry)) {
          if (!entry?.id || !entry?.name) {
            continue;
          }

          const moduleRecord = {
            id: entry.id,
            chunks: (entry.chunks ?? []).flatMap((chunk) => [chunk, chunk]),
            name: entry.name,
            async: entry.async ?? false
          };

          moduleMap[entry.id] = {
            ...(moduleMap[entry.id] ?? {}),
            [entry.name]: moduleRecord,
            "*": moduleRecord
          };
        }

        return moduleMap;
      })
      .catch(() => ({}));
    return moduleMapPromise;
  }

  function installHydrationModeProxy(context) {
    if (!context || Object.getOwnPropertyDescriptor(context, "hydrationMode")) {
      return context;
    }

    Object.defineProperty(context, "hydrationMode", {
      configurable: true,
      enumerable: false,
      get() {
        console.warn("[sourceog] hydrationMode is deprecated. Use renderMode instead.");
        return context.renderMode === "client-root" ? "full-route" : "mixed-route";
      }
    });

    return context;
  }

  function resolveDocumentFlightBody(model) {
    if (!React.isValidElement(model) || model.type !== "html") {
      return model;
    }

    const htmlChildren = React.Children.toArray(model.props?.children ?? []);
    const bodyChild = htmlChildren.find((child) => React.isValidElement(child) && child.type === "body");
    if (React.isValidElement(bodyChild)) {
      return React.createElement(React.Fragment, null, bodyChild.props?.children ?? null);
    }

    return React.createElement(React.Fragment, null, htmlChildren);
  }

  async function applyCanonicalFlight(payload, streamedFlightBody = null) {
    if ((payload?.renderMode ?? "client-root") !== "server-components") {
      return false;
    }

    const flightBody = streamedFlightBody
      ?? (
        payload?.rscPayloadFormat === "react-flight-text"
        && Array.isArray(payload?.rscPayloadChunks)
        && payload.rscPayloadChunks.length > 0
          ? createFlightReadableStream(payload.rscPayloadChunks)
          : null
      );

    if (!flightBody) {
      return false;
    }

    updateDocumentTitle(payload.headHtml);
    const moduleMap = await loadModuleMap();
    const model = await createFromReadableStream(flightBody, { moduleMap });

    // Slot-scoped refresh: apply only to the data-sourceog-slot container (INV-008, Req 4.6)
    const slotId = payload?.slotId;
    if (slotId) {
      const slotContainer = document.querySelector(\`[data-sourceog-slot="\${slotId}"]\`);
      if (slotContainer) {
        const slotRoot = getOrCreateReactRoot(slotContainer);
        slotRoot.render(model);
        // Update renderContextKey for this slot from parallelRouteMap (Req 5.3)
        const ctx = window.__SOURCEOG_CLIENT_CONTEXT__;
        if (ctx && payload.renderContextKey) {
          ctx.parallelRouteMap = {
            ...(ctx.parallelRouteMap ?? {}),
            [slotId]: payload.renderContextKey
          };
        }
        return true;
      }
    }

    const root = document.getElementById("sourceog-root");
    if (!root) {
      throw new Error("Canonical Flight render requires a sourceog-root container.");
    }

    const reactRoot = getOrCreateReactRoot(root);

    if ((payload.shellMode ?? "fragment") === "document") {
      const documentBodyModel = resolveDocumentFlightBody(model);
      reactRoot.render(documentBodyModel);
    } else {
      reactRoot.render(model);
    }

    // After successful Flight apply: update renderContextKey and canonicalRouteId (Req 4.7)
    const ctx = window.__SOURCEOG_CLIENT_CONTEXT__;
    if (ctx) {
      if (payload.renderContextKey) {
        ctx.renderContextKey = payload.renderContextKey;
      }
      if (payload.canonicalRouteId) {
        ctx.canonicalRouteId = payload.canonicalRouteId;
      }
    }

    return true;
  }

  async function hardFallbackHtmlReplace(payload, reason) {
    // INV-005: MUST log [SOURCEOG-FALLBACK] BEFORE any DOM modification (Req 4.3)
    console.error({
      severity: "ERROR",
      type: "[SOURCEOG-FALLBACK]",
      route: payload?.pathname ?? window.location.pathname,
      renderContextKey: payload?.renderContextKey ?? window.__SOURCEOG_CLIENT_CONTEXT__?.renderContextKey ?? "unknown",
      reason: reason?.message ?? String(reason),
      stack: reason?.stack,
      timestamp: new Date().toISOString()
    });

    // DOM modification happens AFTER the log above
    if ((payload.shellMode ?? "fragment") === "document") {
      const nextDocument = new DOMParser().parseFromString(
        '<!DOCTYPE html>' + (payload.shellHtmlStart ?? "<html><body>") + payload.bodyHtml + (payload.shellHtmlEnd ?? "</body></html>"),
        "text/html"
      );
      document.body.innerHTML = nextDocument.body.innerHTML;
      if (nextDocument.title) {
        document.title = nextDocument.title;
      }
      return;
    }

    const root = document.getElementById("sourceog-root");
    if (root) {
      root.innerHTML = payload.bodyHtml;
      return;
    }

    document.body.innerHTML = payload.bodyHtml;
  }

  function projectClientContextFromSnapshot(snapshot) {
    const previousContext = window.__SOURCEOG_CLIENT_CONTEXT__ ?? {};
    return installHydrationModeProxy({
      ...previousContext,
      routeId: snapshot.routeId,
      pathname: snapshot.pathname ?? previousContext.pathname ?? window.location.pathname + window.location.search,
      canonicalRouteId: snapshot.canonicalRouteId ?? previousContext.canonicalRouteId ?? snapshot.routeId,
      resolvedRouteId: snapshot.resolvedRouteId ?? previousContext.resolvedRouteId ?? snapshot.routeId,
      renderContextKey: snapshot.renderContextKey ?? previousContext.renderContextKey,
      renderContext: snapshot.renderContext ?? previousContext.renderContext ?? (snapshot.intercepted ? "intercepted" : "canonical"),
      intercepted: snapshot.intercepted ?? previousContext.intercepted ?? false,
      parallelRouteMap: snapshot.parallelRouteMap ?? previousContext.parallelRouteMap ?? {},
      hydrationMode: snapshot.hydrationMode ?? "none",
      renderMode: snapshot.renderMode ?? previousContext.renderMode ?? (snapshot.hydrationMode === "full-route" ? "client-root" : "server-components"),
      shellMode: snapshot.shellMode ?? previousContext.shellMode,
      rscPayloadFormat: snapshot.rscPayloadFormat ?? previousContext.rscPayloadFormat ?? "none",
      rscPayloadChunks: snapshot.rscPayloadChunks ?? previousContext.rscPayloadChunks ?? [],
      runtimeHref: snapshot.runtimeHref ?? previousContext.runtimeHref,
      routeAssetHref: snapshot.routeAssetHref,
      metadataHref: snapshot.metadataHref,
      entryAssetHref: snapshot.entryAssetHref,
      clientReferenceManifestUrl: snapshot.clientReferenceManifestUrl ?? previousContext.clientReferenceManifestUrl ?? "/__sourceog/client-refs.json",
      flightHref: snapshot.flightHref ?? createFlightHref(snapshot.pathname ?? window.location.pathname + window.location.search, snapshot),
      boundaryRefs: snapshot.boundaryRefs ?? [],
      clientReferenceRefs: snapshot.clientReferenceRefs ?? [],
      renderedSegments: snapshot.renderedSegments ?? [],
      serverTree: snapshot.serverTree ?? previousContext.serverTree,
      flightManifestRefs: snapshot.flightManifestRefs ?? previousContext.flightManifestRefs,
      sharedChunkHrefs: snapshot.sharedChunkHrefs ?? [],
      preloadHrefs: snapshot.preloadHrefs ?? [],
      actionEntries: snapshot.actionEntries ?? []
    });
  }

  function setRouteSnapshot(snapshot, preserveInitial = false) {
    if (preserveInitial && !window.__SOURCEOG_INITIAL_RENDER_SNAPSHOT__) {
      window.__SOURCEOG_INITIAL_RENDER_SNAPSHOT__ = snapshot;
    }

    window.__SOURCEOG_LAST_RENDER_SNAPSHOT__ = snapshot;
    window.__SOURCEOG_CLIENT_CONTEXT__ = projectClientContextFromSnapshot(snapshot);

    if (snapshot.routeId) {
      document.documentElement.dataset.sourceogRoute = snapshot.routeId;
    } else {
      delete document.documentElement.dataset.sourceogRoute;
    }
  }

  async function applyFlightPayload(payload, url, replaceState) {
    setRouteSnapshot(payload);
    try {
      const applied = await applyCanonicalFlight(payload);
      if (!applied) {
        throw new Error("Flight payload is unavailable for canonical apply.");
      }
    } catch (error) {
      await hardFallbackHtmlReplace(payload, error);
    }

    const historyMethod = replaceState ? "replaceState" : "pushState";
    history[historyMethod](createHistorySnapshotState(payload), "", url);
    await bootstrapClientRoute();
  }

  async function fetchFlightUpdate(url, routeSnapshot) {
    const href = createFlightHref(url, routeSnapshot ?? getActiveRouteSnapshot());
    const renderContextKey = window.__SOURCEOG_CLIENT_CONTEXT__?.renderContextKey ?? "";
    const requestHeaders = {
      "x-sourceog-navigate": "1"
    };
    const [streamResponse, snapshotResponse] = await Promise.all([
      fetch(href, {
        headers: {
          ...requestHeaders,
          "Accept": "text/x-component",
          ...(renderContextKey ? { "X-Render-Context-Key": renderContextKey } : {})
        }
      }),
      fetch(href, {
        headers: requestHeaders
      })
    ]);

    return {
      href,
      streamResponse,
      snapshotResponse
    };
  }

  async function applyStreamedFlightPayload(payload, streamResponse, url, replaceState) {
    setRouteSnapshot(payload);
    try {
      const responseContentType = streamResponse.headers.get("content-type") ?? "";
      const streamedFlightBody = responseContentType.includes("text/x-component")
        ? streamResponse.body
        : null;
      const applied = await applyCanonicalFlight(payload, streamedFlightBody);
      if (!applied) {
        throw new Error("Streamed Flight response did not expose a readable canonical payload.");
      }
    } catch (error) {
      await hardFallbackHtmlReplace(payload, error);
    }

    const historyMethod = replaceState ? "replaceState" : "pushState";
    history[historyMethod](createHistorySnapshotState(payload), "", url);
    await bootstrapClientRoute();
  }

  async function refreshRoute(url = window.location.pathname + window.location.search, replaceState = false, routeSnapshot = null) {
    try {
      const { streamResponse, snapshotResponse } = await fetchFlightUpdate(url, routeSnapshot);

      if (!snapshotResponse.ok) {
        window.location.assign(url);
        return;
      }

      const payload = await snapshotResponse.json();
      if (streamResponse.ok) {
        await applyStreamedFlightPayload(payload, streamResponse, url, replaceState);
        return;
      }

      await applyFlightPayload(payload, url, replaceState);
    } catch (error) {
      console.error("[SourceOG] Failed to refresh route from Flight payload.", error);
      window.location.assign(url);
    }
  }

  // Req 4.4, 4.5: navigateTo fetches with Accept: text/x-component and X-Render-Context-Key headers.
  // On fetch failure, falls back to location.href assignment — never hardFallbackHtmlReplace.
  async function navigateTo(url, replaceState = false) {
    return refreshRoute(url, replaceState);
  }

  // Req 4.4, 4.5: refreshCurrentRoute refreshes the current URL via Flight.
  // On fetch failure, falls back to location.href assignment — never hardFallbackHtmlReplace.
  async function refreshCurrentRoute(replaceState = false) {
    return refreshRoute(window.location.pathname + window.location.search, replaceState);
  }

  window.__SOURCEOG_REFRESH_ROUTE__ = refreshRoute;
  window.__SOURCEOG_NAVIGATE_TO__ = navigateTo;
  window.__SOURCEOG_REFRESH_CURRENT_ROUTE__ = refreshCurrentRoute;

  const wsProtocol = location.protocol === "https:" ? "wss" : "ws";
  let ws = null;
  try {
    ws = new WebSocket(\`\${wsProtocol}://\${location.host}/__sourceog/ws\`);
  } catch {
    ws = null;
  }

  ws?.addEventListener("message", (event) => {
    const payload = JSON.parse(event.data);
    if (payload.type === "diagnostics") {
      renderDiagnostics(payload.diagnostics);
      return;
    }

    if (payload.type === "sync") {
      renderDiagnostics(payload.diagnostics);
      if (payload.fullReload) {
        console.info("[SourceOG] Reloading after change:", payload.changedFile);
        location.reload();
        return;
      }

      // Fast refresh: boundary-aware RSC refresh (Req 11.1, 11.2)
      // If the server identified a specific boundary to refresh, apply it via Flight.
      // Components outside the changed boundary are not re-rendered (Req 11.3).
      if (payload.boundaryId && payload.flightHref) {
        void (async () => {
          try {
            const renderContextKey = window.__SOURCEOG_CLIENT_CONTEXT__?.renderContextKey ?? "";
            const streamResponse = await fetch(payload.flightHref, {
              headers: {
                "Accept": "text/x-component",
                ...(renderContextKey ? { "X-Render-Context-Key": renderContextKey } : {})
              }
            });

            if (!streamResponse.ok) {
              // Fetch failed → full page reload (Req 11.6)
              console.info("[SourceOG] Boundary refresh fetch failed, reloading:", payload.boundaryId);
              location.reload();
              return;
            }

            const ctx = window.__SOURCEOG_CLIENT_CONTEXT__ ?? {};
            const boundaryPayload = {
              ...ctx,
              slotId: payload.boundaryId,
              renderContextKey: streamResponse.headers.get("x-render-context-key") ?? ctx.renderContextKey,
              canonicalRouteId: streamResponse.headers.get("x-canonical-route-id") ?? ctx.canonicalRouteId,
              renderMode: "server-components"
            };

            const applied = await applyCanonicalFlight(boundaryPayload, streamResponse.body);
            if (!applied) {
              throw new Error("Boundary Flight apply returned false.");
            }

            console.info("[SourceOG] Fast refresh applied for boundary:", payload.boundaryId);
          } catch (error) {
            // On any failure: [SOURCEOG-FALLBACK] log + full page reload (Req 11.6)
            console.error({
              severity: "ERROR",
              type: "[SOURCEOG-FALLBACK]",
              route: window.location.pathname,
              renderContextKey: window.__SOURCEOG_CLIENT_CONTEXT__?.renderContextKey ?? "unknown",
              reason: error?.message ?? String(error),
              stack: error?.stack,
              timestamp: new Date().toISOString()
            });
            location.reload();
          }
        })();
        return;
      }

      const currentRoute = document.documentElement.dataset.sourceogRoute;
      if (currentRoute && payload.affectedRouteIds?.includes(currentRoute)) {
        console.info("[SourceOG] Reloading affected route:", currentRoute);
        location.reload();
        return;
      }

      console.info("[SourceOG] Change detected without full reload.", payload.affectedRouteIds ?? []);
      return;
    }

    if (payload.type === "reload") {
      location.reload();
    }
  });

  ws?.addEventListener("error", () => {
    // Production builds do not expose the dev websocket endpoint.
  });

  document.addEventListener("click", (event) => {
    const anchor = event.target instanceof Element ? event.target.closest("a") : null;
    if (!anchor) return;
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (anchor.target === "_blank" || anchor.hasAttribute("download")) return;
    const nextUrl = new URL(anchor.href, window.location.href);
    if (nextUrl.origin !== window.location.origin) return;
    if (nextUrl.pathname === window.location.pathname && nextUrl.search === window.location.search && nextUrl.hash) return;
    event.preventDefault();
    void refreshRoute(nextUrl.pathname + nextUrl.search);
  });

  window.addEventListener("popstate", (event) => {
    void refreshRoute(
      window.location.pathname + window.location.search,
      true,
      event.state?.__sourceog ?? getActiveRouteSnapshot()
    );
  });

  if (window.__SOURCEOG_INITIAL_RENDER_SNAPSHOT__) {
    setRouteSnapshot(window.__SOURCEOG_INITIAL_RENDER_SNAPSHOT__, true);
    history.replaceState(
      createHistorySnapshotState(window.__SOURCEOG_INITIAL_RENDER_SNAPSHOT__),
      "",
      window.location.pathname + window.location.search + window.location.hash
    );
  }

  void bootstrapClientRoute();
})();
  `.trim();
}
