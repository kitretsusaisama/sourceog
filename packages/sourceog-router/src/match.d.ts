import type { RouteManifest, RouteMatch } from "./types.js";
export declare function matchPageRoute(manifest: RouteManifest, pathname: string, options?: MatchRouteOptions): RouteMatch | null;
export declare function matchHandlerRoute(manifest: RouteManifest, pathname: string, options?: MatchRouteOptions): RouteMatch | null;
export interface MatchRouteOptions {
    intercept?: boolean;
    preferredSlotNames?: string[];
}
