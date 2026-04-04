/**
 * sourceogFetch — request-memoized fetch wrapper for SourceOG server components.
 * Deduplicates identical GET requests within a single request context.
 * When routeScope is provided and a dataCacheStore is available, persists to the shared data cache.
 */
export interface SourceOGFetchOptions extends RequestInit {
    /** Cache strategy */
    cache?: "auto" | "force-cache" | "no-store";
    /** Cache tags for invalidation */
    tags?: string[];
    /** Revalidation interval in seconds */
    revalidate?: number;
    /** Route scope for shared data cache persistence */
    routeScope?: string;
}
export declare function getRequestMemoizationEntryCount(): number;
/**
 * Clear all memoized entries for the current request context.
 * Called by revalidatePath/revalidateTag to bust the per-request memo.
 */
export declare function clearRequestMemo(): void;
/**
 * Clear memoized entries that are tagged with any of the given tags.
 */
export declare function clearRequestMemoByTags(tags: string[]): void;
export declare function sourceogFetch(url: RequestInfo | URL, init?: RequestInit, options?: SourceOGFetchOptions): Promise<Response>;
