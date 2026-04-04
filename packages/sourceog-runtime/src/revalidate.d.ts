import { type ResolvedCacheInvalidation } from "./cache.js";
export type PrerenderPolicy = "auto" | "force-static" | "force-dynamic";
export interface RevalidationHandler {
    revalidatePath(pathname: string): Promise<void>;
    revalidateTag(tag: string): Promise<void>;
    invalidateResource?(resourceId: string, scope?: "server" | "client" | "both"): Promise<void>;
    applyResolvedInvalidation?(resolved: ResolvedCacheInvalidation): Promise<void>;
}
export interface RevalidationTrackingSummary {
    paths: string[];
    tags: string[];
    routeIds: string[];
    cacheKeys: string[];
    invalidated: boolean;
}
export declare function setRevalidationHandler(handler: RevalidationHandler): void;
export declare function applyRuntimeCacheInvalidation(resolved: ResolvedCacheInvalidation): Promise<void>;
export declare function mergeRevalidationTrackingSummary(summary: RevalidationTrackingSummary, addition: Pick<RevalidationTrackingSummary, "paths" | "tags" | "routeIds" | "cacheKeys" | "invalidated">): RevalidationTrackingSummary;
export declare function revalidatePath(pathname: string): Promise<void>;
export declare function revalidateTag(tag: string): Promise<void>;
export declare function invalidateResource(resourceId: string, scope?: "server" | "client" | "both"): Promise<void>;
export declare function withRevalidationTracking<T>(callback: () => Promise<T> | T): Promise<{
    result: T;
    summary: RevalidationTrackingSummary;
}>;
export declare function cacheTag(...tags: string[]): string[];
export declare function cacheTTL(seconds: number): number;
export declare function prerenderPolicy(policy: PrerenderPolicy): PrerenderPolicy;
