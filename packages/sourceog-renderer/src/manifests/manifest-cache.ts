// sourceog-renderer/src/manifests/manifest-cache.ts
// Alibaba CTO 2027 Standard — Manifest Content Cache

import type { NormalizedClientManifest } from '@sourceog/genbook';
import { logger } from '../core/logger.js';
import { MANIFEST_CACHE_MAX } from '../core/constants.js';

/**
 * Entry for the manifest content cache.
 */
interface ManifestCacheEntry {
  manifest: NormalizedClientManifest;
  lastModified: number; // Used for future validation or staleness checks
}

/**
 * LRU Cache for loaded manifest content.
 *
 * Rationale:
 * Manifest files (JSON) can be large. Loading and parsing them from disk
 * on every render request is inefficient. We cache the parsed object in memory.
 *
 * This is separate from the Path Cache (in manifest-resolver) which only stores file paths.
 */
class ManifestContentCache {
  private cache = new Map<string, ManifestCacheEntry>();
  private readonly max: number;

  constructor(max: number) {
    this.max = max;
  }

  get(key: string): NormalizedClientManifest | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    // LRU refresh
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.manifest;
  }

  set(key: string, manifest: NormalizedClientManifest): void {
    if (this.cache.has(key)) this.cache.delete(key);

    this.cache.set(key, {
      manifest,
      lastModified: Date.now(),
    });

    if (this.cache.size > this.max) {
      const oldest = this.cache.keys().next().value!;
      this.cache.delete(oldest);
      logger.debug(`Evicted manifest from cache: ${oldest}`);
    }
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }
}

// Singleton instance
export const manifestContentCache = new ManifestContentCache(MANIFEST_CACHE_MAX);

/**
 * Helper to generate a cache key.
 * We use the absolute file path as the key.
 */
export function getManifestCacheKey(filePath: string): string {
  return filePath; // Path should already be resolved and normalized
}