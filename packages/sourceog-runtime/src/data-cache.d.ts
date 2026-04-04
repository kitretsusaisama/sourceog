export interface DataCacheKey {
    url: string;
    method: string;
    bodyHash: string;
    tags: string[];
    runtimeTarget: "node" | "edge";
}
export interface DataCacheEntry {
    key: DataCacheKey;
    value: unknown;
    ttl?: number;
    tags: string[];
    createdAt: number;
    /** Snapshot of tagGenerations at write time; used for O(1) invalidation check on read */
    tagGenerationSnapshot?: Map<string, number>;
}
export interface DataCacheBackend {
    get(key: string): Promise<DataCacheEntry | null>;
    set(key: string, entry: DataCacheEntry): Promise<void>;
    delete(key: string): Promise<void>;
    deleteByTag(tag: string): Promise<void>;
}
export interface DataCacheOptions {
    /** Maximum number of entries in the L1 in-memory cache. When exceeded, the LRU entry is evicted. */
    maxL1Size?: number;
}
export declare class DataCache {
    private l1;
    private l2;
    /** TagIndex: maps each tag string to the set of serialized cache keys that carry that tag */
    private tagIndex;
    /**
     * Tag generation counter: maps each tag to a monotonically increasing version number.
     * Invalidating a tag bumps its generation. Entries store the generation at write time;
     * a get() that finds a mismatched generation treats the entry as a miss — O(1) invalidation.
     */
    private tagGenerations;
    private maxL1Size;
    constructor(l2?: DataCacheBackend, options?: DataCacheOptions);
    /**
     * Normalize a raw fetch request into a DataCacheKey.
     */
    static normalizeKey(request: {
        url: string;
        method?: string;
        body?: string | null;
        tags?: string[];
        runtimeTarget?: "node" | "edge";
    }): DataCacheKey;
    /**
     * Serialize a DataCacheKey to a stable string for use as map/file key.
     */
    static serializeKey(key: DataCacheKey): string;
    /**
     * Check whether an L1 entry is still valid against the current tag generation counters.
     * Returns false if any of the entry's tags have been invalidated since the entry was written.
     * This is the O(1) invalidation check — no Map scan required.
     */
    private isEntryValid;
    /**
     * Evict the least-recently-used entry from L1.
     * Map iteration order is insertion order; the first key is the LRU entry.
     */
    private evictLRU;
    get(key: DataCacheKey, revalidate?: number | false): Promise<DataCacheEntry | null>;
    set(key: DataCacheKey, value: unknown, options?: {
        ttl?: number;
        tags?: string[];
        revalidate?: number | false;
    }): Promise<void>;
    /**
     * Delete a single entry from L1 and update the tag index.
     */
    delete(key: DataCacheKey): void;
    revalidateTag(tag: string): Promise<void>;
}
