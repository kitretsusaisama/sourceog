import type { CacheManifest } from "./contracts.js";
export interface CachePolicy {
    kind?: "route" | "data";
    ttl: number;
    swr: number;
    tags: string[];
    scope: "route" | "shared";
    linkedRouteIds?: string[];
    linkedTagIds?: string[];
}
export type SourceOGFetchCacheMode = "auto" | "force-cache" | "no-store";
export interface SourceOGFetchOptions {
    cache?: SourceOGFetchCacheMode;
    revalidate?: number;
    tags?: string[];
    routeScope?: string;
}
export interface CacheEntry {
    kind: "route" | "data";
    scope: "request" | "shared" | "route";
    routeKey: string;
    tags: string[];
    linkedRouteIds: string[];
    linkedTagIds: string[];
    body: Buffer;
    headers: Record<string, string>;
    status: number;
    createdAt: number;
    expiresAt: number;
    etag: string;
    buildId: string;
}
export interface CacheStore {
    get(key: string): Promise<CacheEntry | null>;
    set(key: string, entry: CacheEntry, policy: CachePolicy): Promise<void>;
    purge(tags: string[]): Promise<void>;
    revalidate(routeKey: string): Promise<void>;
    purgeKeys(keys: string[]): Promise<void>;
    purgeLinkedRoutes(routeKeys: string[]): Promise<void>;
}
export type RouteCachePolicy = CachePolicy;
export type RouteCacheEntry = CacheEntry;
export type RouteCacheStore = CacheStore;
export declare class MemoryCacheStore implements CacheStore {
    private readonly entries;
    get(key: string): Promise<CacheEntry | null>;
    set(_key: string, entry: CacheEntry, _policy: CachePolicy): Promise<void>;
    purge(tags: string[]): Promise<void>;
    revalidate(routeKey: string): Promise<void>;
    purgeKeys(keys: string[]): Promise<void>;
    purgeLinkedRoutes(routeKeys: string[]): Promise<void>;
}
export interface ResolvedCacheInvalidation {
    cacheKeys: string[];
    routeIds: string[];
    pathnames: string[];
    tags: string[];
    invalidated: boolean;
}
export declare function unstable_cache<TArgs extends unknown[], TResult>(handler: (...args: TArgs) => Promise<TResult> | TResult, keyParts?: string[], options?: {
    tags?: string[];
    revalidate?: number;
    routeIds?: string[];
}): (...args: TArgs) => Promise<TResult>;
export declare function invalidateCachedFunctionsByTag(tag: string): Promise<void>;
export declare function invalidateCachedFunctionsByRoute(routeIdOrPathname: string): Promise<void>;
export declare function invalidateDataCacheByTag(tag: string): Promise<void>;
export declare function invalidateDataCacheByRoute(routeIdOrPathname: string): Promise<void>;
export declare function invalidateDataCacheByKey(cacheKey: string): Promise<void>;
export declare function applyResolvedCacheInvalidation(resolved: ResolvedCacheInvalidation): Promise<void>;
export declare function getRequestMemoizationEntryCount(): number;
export declare function clearRequestMemoization(): void;
export declare function resolveCacheInvalidation(input: {
    paths?: string[];
    tags?: string[];
    actionId?: string;
    cacheManifest?: CacheManifest;
}): ResolvedCacheInvalidation;
export declare function sourceogFetch(input: RequestInfo | URL, init?: RequestInit, options?: SourceOGFetchOptions): Promise<Response>;
