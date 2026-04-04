export type {
  SourceOGFetchOptions,
  ResolvedCacheInvalidation,
  CacheEntry,
  CachePolicy,
  CacheStore,
  RouteCacheEntry,
  RouteCachePolicy,
  RouteCacheStore,
  DataCacheKey,
  DataCacheEntry,
  DataCacheBackend,
  DataCacheOptions
} from "@sourceog/runtime";

export {
  getRequestMemoizationEntryCount,
  clearRequestMemo,
  clearRequestMemoByTags,
  unstable_cache,
  MemoryCacheStore,
  resolveCacheInvalidation,
  applyResolvedCacheInvalidation,
  DataCache,
  DataFilesystemCacheStore,
  FilesystemCacheStore,
  revalidatePath,
  revalidateTag,
  invalidateResource,
  cacheTTL,
  prerenderPolicy
} from "@sourceog/runtime";

export type SourceOGCacheMode = "auto" | "force-cache" | "no-store" | "stale-while-revalidate";

export interface RouteCacheInspection {
  selector: string;
  hit: boolean;
  age: number | null;
  tags: string[];
  hotness: number;
  entries: import("@sourceog/runtime").CacheManifestEntry[];
  mode?: SourceOGCacheMode;
  scope?: Record<string, string>;
}

export interface GraphNodeInspection {
  id: string;
  version: number;
  edges: string[];
  invalidationHistory: string[];
  available: boolean;
}

export declare function sourceogFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  options?: import("@sourceog/runtime").SourceOGFetchOptions
): Promise<Response>;

export declare function cacheTag(...tags: string[]): string[];
export declare function cacheLife(value: number | string): number;
export declare function cacheMode(mode: SourceOGCacheMode): SourceOGCacheMode;
export declare function cacheScope(scope: string, value: string): string;
export declare function updateTag(previousTag: string, nextTag: string): Promise<void>;
export declare function warmRoute(pathname: string): Promise<{ target: string; warmed: boolean }>;
export declare function warmTag(tag: string): Promise<{ tag: string; warmed: boolean }>;
export declare function warmRouteSubtree(pathname: string): Promise<{ subtree: string; warmed: boolean }>;
export declare function inspectRouteCache(selector: string): Promise<RouteCacheInspection>;
export declare function inspectGraphNode(nodeId: string): Promise<GraphNodeInspection>;
