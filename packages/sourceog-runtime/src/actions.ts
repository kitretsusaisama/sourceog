import type {
  ClientRouteSnapshot,
  ClientBoundaryDescriptor,
  ClientReferenceRef,
  FlightManifestRefs,
  FlightRenderSegment,
  FlightRenderTreeNode,
  RouteRenderIdentity,
  RouteRenderMode
} from "./contracts.js";
import { SourceOGError, SOURCEOG_ERROR_CODES } from "./errors.js";

export interface ClientActionReference {
  actionId: string;
  exportName: string;
  runtime: "node" | "edge";
  refreshPolicy?: "none" | "refresh-current-route-on-revalidate";
  revalidationPolicy?: "none" | "track-runtime-revalidation";
}

declare global {
  interface Window {
    __SOURCEOG_INITIAL_RENDER_SNAPSHOT__?: ClientRouteSnapshot;
    __SOURCEOG_LAST_RENDER_SNAPSHOT__?: ClientRouteSnapshot;
    __SOURCEOG_CLIENT_CONTEXT__?: {
      routeId?: string;
      pathname?: string;
      canonicalRouteId?: RouteRenderIdentity["canonicalRouteId"];
      resolvedRouteId?: RouteRenderIdentity["resolvedRouteId"];
      renderContextKey?: RouteRenderIdentity["renderContextKey"];
      renderContext?: RouteRenderIdentity["renderContext"];
      intercepted?: RouteRenderIdentity["intercepted"];
      parallelRouteMap?: RouteRenderIdentity["parallelRouteMap"];
      hydrationMode?: "none" | "full-route" | "mixed-route";
      renderMode?: RouteRenderMode;
      shellMode?: "document" | "fragment";
      rscPayloadFormat?: "none" | "react-flight-text";
      rscPayloadChunks?: string[];
      runtimeHref?: string;
      routeAssetHref?: string;
      metadataHref?: string;
      entryAssetHref?: string;
      clientReferenceManifestUrl?: string;
      flightHref?: string;
      boundaryRefs?: ClientBoundaryDescriptor[];
      clientReferenceRefs?: ClientReferenceRef[];
      renderedSegments?: FlightRenderSegment[];
      serverTree?: FlightRenderTreeNode;
      flightManifestRefs?: FlightManifestRefs;
      sharedChunkHrefs?: string[];
      preloadHrefs?: string[];
      actionEntries?: ClientActionReference[];
    };
    __SOURCEOG_REFRESH_ROUTE__?: (url?: string, replaceState?: boolean) => Promise<void>;
  }
}

export async function callServerActionById<T = unknown>(
  actionId: string,
  ...args: unknown[]
): Promise<T> {
  const response = await fetch(`/__sourceog/actions/${encodeURIComponent(actionId)}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-sourceog-action": "1"
    },
    body: JSON.stringify({ args })
  });

  if (!response.ok) {
    const message = await response.text();
    throw new SourceOGError(
      SOURCEOG_ERROR_CODES.ACTION_EXECUTION_FAILED,
      message || `Server action "${actionId}" failed with status ${response.status}.`,
      {
        actionId,
        status: response.status
      }
    );
  }

  const payload = await response.json() as {
    result: T;
    revalidated?: {
      paths: string[];
      tags: string[];
      routeIds?: string[];
      cacheKeys?: string[];
      invalidated: boolean;
    };
  };
  const shouldRefreshCurrentRoute = response.headers.get("x-sourceog-action-refresh") === "current-route"
    || payload.revalidated?.invalidated === true;
  if (shouldRefreshCurrentRoute && typeof window !== "undefined" && typeof window.__SOURCEOG_REFRESH_ROUTE__ === "function") {
    await window.__SOURCEOG_REFRESH_ROUTE__();
  }
  return payload.result;
}

export async function callServerAction<T = unknown>(
  exportName: string,
  ...args: unknown[]
): Promise<T> {
  if (typeof window === "undefined") {
    throw new SourceOGError(
      SOURCEOG_ERROR_CODES.RUNTIME_INCOMPATIBLE,
      "callServerAction can only run in a browser environment."
    );
  }

  const action = window.__SOURCEOG_CLIENT_CONTEXT__?.actionEntries?.find((entry) => entry.exportName === exportName);
  if (!action) {
    throw new SourceOGError(
      SOURCEOG_ERROR_CODES.ACTION_NOT_FOUND,
      `No Server Action named "${exportName}" is available in the current route context.`,
      { exportName }
    );
  }

  return callServerActionById<T>(action.actionId, ...args);
}

export async function refreshCurrentRoute(
  url?: string,
  replaceState = false
): Promise<void> {
  if (typeof window === "undefined") {
    throw new SourceOGError(
      SOURCEOG_ERROR_CODES.RUNTIME_INCOMPATIBLE,
      "refreshCurrentRoute can only run in a browser environment."
    );
  }

  if (typeof window.__SOURCEOG_REFRESH_ROUTE__ !== "function") {
    throw new SourceOGError(
      SOURCEOG_ERROR_CODES.RUNTIME_INCOMPATIBLE,
      "SourceOG client route refresh runtime is not available."
    );
  }

  await window.__SOURCEOG_REFRESH_ROUTE__(
    url ?? `${window.location.pathname}${window.location.search}`,
    replaceState
  );
}
