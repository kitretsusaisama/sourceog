/**
 * sourceogFetch — request-memoized fetch wrapper for SourceOG server components.
 * Deduplicates identical GET requests within a single request context.
 * When routeScope is provided and a dataCacheStore is available, persists to the shared data cache.
 */

import { getRequestContext } from "./context.js";
import type { CacheStore } from "./cache.js";

export interface SourceOGFetchOptions extends RequestInit {
  /** Cache strategy */
  cache?: "force-cache" | "no-store" | "default";
  /** Cache tags for invalidation */
  tags?: string[];
  /** Revalidation interval in seconds */
  revalidate?: number;
  /** Route scope for shared data cache persistence */
  routeScope?: string;
}

// Per-request memoization map (keyed by URL + method)
const memoizationMap = new WeakMap<object, Map<string, Response | Promise<Response>>>();
// Per-request tag tracking: maps memo key -> set of tags
const memoTagMap = new WeakMap<object, Map<string, Set<string>>>();

function getMemoMap(): Map<string, Response | Promise<Response>> | null {
  const ctx = getRequestContext();
  if (!ctx) return null;
  if (!memoizationMap.has(ctx)) {
    memoizationMap.set(ctx, new Map());
  }
  return memoizationMap.get(ctx) ?? null;
}

function getMemoTagMap(): Map<string, Set<string>> | null {
  const ctx = getRequestContext();
  if (!ctx) return null;
  if (!memoTagMap.has(ctx)) {
    memoTagMap.set(ctx, new Map());
  }
  return memoTagMap.get(ctx) ?? new Map();
}

export function getRequestMemoizationEntryCount(): number {
  const map = getMemoMap();
  if (!map) return 0;
  // Count only resolved entries (Response, not Promise)
  let count = 0;
  for (const v of map.values()) {
    if (v instanceof Response) count++;
  }
  return count;
}

/**
 * Clear all memoized entries for the current request context.
 * Called by revalidatePath/revalidateTag to bust the per-request memo.
 */
export function clearRequestMemo(): void {
  const ctx = getRequestContext();
  if (!ctx) return;
  memoizationMap.get(ctx)?.clear();
  memoTagMap.get(ctx)?.clear();
}

/**
 * Clear memoized entries that are tagged with any of the given tags.
 */
export function clearRequestMemoByTags(tags: string[]): void {
  const memo = getMemoMap();
  const tagMap = getMemoTagMap();
  if (!memo || !tagMap) return;
  for (const [key, entryTags] of tagMap.entries()) {
    if (tags.some((t) => entryTags.has(t))) {
      memo.delete(key);
      tagMap.delete(key);
    }
  }
}

export async function sourceogFetch(
  url: string,
  init?: RequestInit,
  options?: SourceOGFetchOptions
): Promise<Response> {
  const method = (init?.method ?? options?.method ?? "GET").toUpperCase();
  const cacheStrategy = options?.cache ?? "default";

  // Only memoize GET requests that aren't explicitly no-store
  if (method === "GET" && cacheStrategy !== "no-store") {
    const memo = getMemoMap();
    if (memo) {
      const key = `${method}:${url}`;
      const existing = memo.get(key);
      if (existing !== undefined) {
        // May be a Promise (in-flight) or a Response (resolved)
        const resolved = existing instanceof Response ? existing : await existing;
        return resolved.clone();
      }
      // Store the promise immediately to prevent concurrent duplicate fetches
      const fetchPromise = fetch(url, init ?? options).then(async (response) => {
        const cloned = response.clone();
        // Persist to shared data cache store if routeScope is provided
        if (options?.routeScope) {
          await persistToDataCache(url, options, cloned.clone());
        }
        // Replace the promise with the resolved response
        memo.set(key, response.clone());
        return response;
      });
      memo.set(key, fetchPromise);
      // Track tags for this entry
      if (options?.tags && options.tags.length > 0) {
        const tagMap = getMemoTagMap();
        if (tagMap) {
          tagMap.set(key, new Set(options.tags));
        }
      }
      return (await fetchPromise).clone();
    }
  }

  return fetch(url, init ?? options);
}

async function persistToDataCache(url: string, options: SourceOGFetchOptions, response: Response): Promise<void> {
  const ctx = getRequestContext();
  const store: CacheStore | undefined = ctx?.runtimeState?.dataCacheStore;
  if (!store) return;

  try {
    const body = Buffer.from(await response.arrayBuffer());
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => { headers[key] = value; });
    const cacheKey = `data:${url}`;
    const now = Date.now();
    const ttl = (options.revalidate ?? 60) * 1000;
    await store.set(cacheKey, {
      kind: "data",
      scope: "shared",
      routeKey: options.routeScope ?? url,
      tags: options.tags ?? [],
      linkedRouteIds: options.routeScope ? [options.routeScope] : [],
      linkedTagIds: options.tags ?? [],
      body,
      headers,
      status: response.status,
      createdAt: now,
      expiresAt: now + ttl,
      etag: "",
      buildId: ctx?.runtimeState?.buildId ?? "runtime",
    }, {
      kind: "data",
      ttl,
      swr: 0,
      tags: options.tags ?? [],
      scope: "shared",
      linkedRouteIds: options.routeScope ? [options.routeScope] : [],
    });
  } catch {
    // Non-fatal: cache persistence failure should not break the request
  }
}
