import type { ClientRouteSnapshot, ClientBoundaryDescriptor, ClientReferenceRef, FlightManifestRefs, FlightRenderSegment, FlightRenderTreeNode, RouteRenderIdentity, RouteRenderMode } from "./contracts.js";
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
export declare function callServerActionById<T = unknown>(actionId: string, ...args: unknown[]): Promise<T>;
export declare function callServerAction<T = unknown>(exportName: string, ...args: unknown[]): Promise<T>;
export declare function refreshCurrentRoute(url?: string, replaceState?: boolean): Promise<void>;
