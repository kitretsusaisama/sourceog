import { createHash } from "node:crypto";

export interface DataCacheKey {
  url: string;           // normalized: lowercase scheme+host, sorted query params
  method: string;        // always uppercase: "GET", "POST", etc.
  bodyHash: string;      // sha256 hex of body; "" for GET/HEAD
  tags: string[];        // sorted lexicographically
  runtimeTarget: "node" | "edge";
}

export interface DataCacheEntry {
  key: DataCacheKey;
  value: unknown;
  ttl?: number;          // seconds; undefined = no expiry
  tags: string[];
  createdAt: number;     // Unix timestamp ms
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

export class DataCache {
  private l1: Map<string, DataCacheEntry>;
  private l2: DataCacheBackend | null;
  /** TagIndex: maps each tag string to the set of serialized cache keys that carry that tag */
  private tagIndex: Map<string, Set<string>>;
  /**
   * Tag generation counter: maps each tag to a monotonically increasing version number.
   * Invalidating a tag bumps its generation. Entries store the generation at write time;
   * a get() that finds a mismatched generation treats the entry as a miss — O(1) invalidation.
   */
  private tagGenerations: Map<string, number>;
  private maxL1Size: number | undefined;

  constructor(l2?: DataCacheBackend, options?: DataCacheOptions) {
    this.l1 = new Map();
    this.l2 = l2 ?? null;
    this.tagIndex = new Map();
    this.tagGenerations = new Map();
    this.maxL1Size = options?.maxL1Size;
  }

  /**
   * Normalize a raw fetch request into a DataCacheKey.
   */
  static normalizeKey(request: {
    url: string;
    method?: string;
    body?: string | null;
    tags?: string[];
    runtimeTarget?: "node" | "edge";
  }): DataCacheKey {
    // Parse and normalize URL: lowercase scheme+host, sort query params
    let normalizedUrl: string;
    try {
      const parsed = new URL(request.url);
      // Lowercase scheme and host
      parsed.protocol = parsed.protocol.toLowerCase();
      parsed.hostname = parsed.hostname.toLowerCase();
      // Sort query params alphabetically
      const sortedParams = new URLSearchParams(
        [...parsed.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b))
      );
      parsed.search = sortedParams.toString() ? `?${sortedParams.toString()}` : "";
      normalizedUrl = parsed.toString();
    } catch {
      // If URL parsing fails, use as-is lowercased
      normalizedUrl = request.url.toLowerCase();
    }

    // Uppercase the HTTP method, default to "GET"
    const method = (request.method ?? "GET").toUpperCase();

    // Compute body hash: empty string for GET/HEAD, sha256 hex otherwise
    let bodyHash = "";
    if (method !== "GET" && method !== "HEAD") {
      const body = request.body ?? "";
      bodyHash = createHash("sha256").update(body).digest("hex");
    }

    // Sort tags lexicographically
    const tags = [...(request.tags ?? [])].sort((a, b) => a.localeCompare(b));

    const runtimeTarget = request.runtimeTarget ?? "node";

    return { url: normalizedUrl, method, bodyHash, tags, runtimeTarget };
  }

  /**
   * Serialize a DataCacheKey to a stable string for use as map/file key.
   */
  static serializeKey(key: DataCacheKey): string {
    return JSON.stringify({
      bodyHash: key.bodyHash,
      method: key.method,
      runtimeTarget: key.runtimeTarget,
      tags: key.tags,
      url: key.url,
    });
  }

  /**
   * Check whether an L1 entry is still valid against the current tag generation counters.
   * Returns false if any of the entry's tags have been invalidated since the entry was written.
   * This is the O(1) invalidation check — no Map scan required.
   */
  private isEntryValid(entry: DataCacheEntry): boolean {
    if (!entry.tagGenerationSnapshot) return true;
    for (const [tag, gen] of entry.tagGenerationSnapshot) {
      const currentGen = this.tagGenerations.get(tag) ?? 0;
      if (currentGen !== gen) return false;
    }
    return true;
  }

  /**
   * Evict the least-recently-used entry from L1.
   * Map iteration order is insertion order; the first key is the LRU entry.
   */
  private evictLRU(): void {
    const lruKey = this.l1.keys().next().value;
    if (lruKey === undefined) return;
    const entry = this.l1.get(lruKey);
    if (entry) {
      for (const tag of entry.tags) {
        const keySet = this.tagIndex.get(tag);
        if (keySet) {
          keySet.delete(lruKey);
          if (keySet.size === 0) this.tagIndex.delete(tag);
        }
      }
    }
    this.l1.delete(lruKey);
  }

  async get(key: DataCacheKey, revalidate?: number | false): Promise<DataCacheEntry | null> {
    const serialized = DataCache.serializeKey(key);

    // Check L1 first
    const l1Entry = this.l1.get(serialized);
    if (l1Entry) {
      // TTL eviction check
      if (l1Entry.ttl !== undefined && Date.now() > l1Entry.createdAt + l1Entry.ttl * 1000) {
        this.l1.delete(serialized);
        // Fall through to L2 (unless revalidate === false)
      } else if (!this.isEntryValid(l1Entry)) {
        // Tag generation mismatch — entry was invalidated via revalidateTag (O(1) check)
        this.l1.delete(serialized);
        // Fall through to L2
      } else {
        // Update LRU position: delete + re-insert moves entry to MRU end of Map
        this.l1.delete(serialized);
        this.l1.set(serialized, l1Entry);
        return l1Entry;
      }
    }

    // If revalidate === false, skip L2
    if (revalidate === false) {
      return null;
    }

    // Try L2
    if (this.l2) {
      let l2Entry: DataCacheEntry | null = null;
      try {
        l2Entry = await this.l2.get(serialized);
      } catch (err) {
        console.warn(`[DataCache] L2 read failed: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      }

      if (l2Entry) {
        // TTL eviction check on L2 entry
        if (l2Entry.ttl !== undefined && Date.now() > l2Entry.createdAt + l2Entry.ttl * 1000) {
          return null;
        }
        // Populate L1 from L2 (respecting maxL1Size)
        if (this.maxL1Size !== undefined && this.l1.size >= this.maxL1Size) {
          this.evictLRU();
        }
        this.l1.set(serialized, l2Entry);
        return l2Entry;
      }
    }

    return null;
  }

  async set(
    key: DataCacheKey,
    value: unknown,
    options?: { ttl?: number; tags?: string[]; revalidate?: number | false }
  ): Promise<void> {
    const serialized = DataCache.serializeKey(key);
    const entry: DataCacheEntry = {
      key,
      value,
      ttl: options?.ttl,
      tags: options?.tags ?? key.tags,
      createdAt: Date.now(),
      // Snapshot current tag generations so get() can detect invalidation in O(1)
      tagGenerationSnapshot: (() => {
        const entryTags = options?.tags ?? key.tags;
        if (entryTags.length === 0) return undefined;
        const snap = new Map<string, number>();
        for (const tag of entryTags) {
          snap.set(tag, this.tagGenerations.get(tag) ?? 0);
        }
        return snap;
      })(),
    };

    // Evict LRU entry if L1 is at capacity (entry may already exist — don't double-count)
    if (this.maxL1Size !== undefined && !this.l1.has(serialized) && this.l1.size >= this.maxL1Size) {
      this.evictLRU();
    }

    // Always write to L1 (re-inserting an existing key moves it to MRU position)
    this.l1.set(serialized, entry);

    // Update tag index: add serialized key to each tag's set
    for (const tag of entry.tags) {
      let keySet = this.tagIndex.get(tag);
      if (!keySet) {
        keySet = new Set();
        this.tagIndex.set(tag, keySet);
      }
      keySet.add(serialized);
    }

    // Skip L2 if revalidate === false
    if (options?.revalidate === false) {
      return;
    }

    if (this.l2) {
      try {
        await this.l2.set(serialized, entry);
      } catch (err) {
        console.warn(`[DataCache] L2 write failed: ${err instanceof Error ? err.message : String(err)}`);
        // Continue — L1 write succeeded
      }
    }
  }

  /**
   * Delete a single entry from L1 and update the tag index.
   */
  delete(key: DataCacheKey): void {
    const serialized = DataCache.serializeKey(key);
    const entry = this.l1.get(serialized);
    if (!entry) return;

    // Remove key from all relevant tag sets in the index
    for (const tag of entry.tags) {
      const keySet = this.tagIndex.get(tag);
      if (keySet) {
        keySet.delete(serialized);
        if (keySet.size === 0) {
          this.tagIndex.delete(tag);
        }
      }
    }

    this.l1.delete(serialized);
  }

  async revalidateTag(tag: string): Promise<void> {
    // O(1) invalidation: bump the tag's generation counter.
    // All L1 entries carrying this tag will fail the isEntryValid() check on next get().
    // No Map scan or bulk delete required.
    const currentGen = this.tagGenerations.get(tag) ?? 0;
    this.tagGenerations.set(tag, currentGen + 1);
    // Also clear the tagIndex entry so it doesn't accumulate stale keys indefinitely
    this.tagIndex.delete(tag);

    // Invalidate L2 by tag
    if (this.l2) {
      try {
        await this.l2.deleteByTag(tag);
      } catch (err) {
        console.warn(`[DataCache] L2 deleteByTag failed: ${err instanceof Error ? err.message : String(err)}`);
        // Continue
      }
    }
  }
}
