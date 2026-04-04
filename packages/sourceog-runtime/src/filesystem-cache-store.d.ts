import type { CacheEntry, CachePolicy, CacheStore } from "./cache.js";
import type { DataCacheBackend, DataCacheEntry } from "./data-cache.js";
export declare class FilesystemCacheStore implements CacheStore {
    private readonly cacheDir;
    private readonly tagIndexPath;
    constructor(cacheDir?: string);
    get(key: string): Promise<CacheEntry | null>;
    set(key: string, entry: CacheEntry, _policy: CachePolicy): Promise<void>;
    purge(tags: string[]): Promise<void>;
    revalidate(routeKey: string): Promise<void>;
    purgeKeys(keys: string[]): Promise<void>;
    purgeLinkedRoutes(routeKeys: string[]): Promise<void>;
    /** Read tags.json; rebuild from cache entries if missing or corrupt. */
    private getTagIndex;
    /** Rebuild tags.json by scanning all existing cache entry files. */
    private rebuildTagIndex;
    /** Atomically read-modify-write tags.json. Deletes the file when the index becomes empty. */
    private updateTagIndex;
    /** Remove a single safe key from all tag arrays in the index. */
    private removeKeyFromTagIndex;
    private safeKey;
    private entryPath;
}
export declare class DataFilesystemCacheStore implements DataCacheBackend {
    private readonly cacheDir;
    private readonly tagsFile;
    constructor(cacheDir?: string);
    get(key: string): Promise<DataCacheEntry | null>;
    set(key: string, entry: DataCacheEntry): Promise<void>;
    delete(key: string): Promise<void>;
    deleteByTag(tag: string): Promise<void>;
    private safeKey;
}
