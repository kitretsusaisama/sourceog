import { getRequestContext } from "@sourceog/runtime/context";
import {
  sourceogFetch as runtimeSourceogFetch,
  getRequestMemoizationEntryCount,
  clearRequestMemo,
  clearRequestMemoByTags,
  type SourceOGFetchOptions
} from "@sourceog/runtime/fetch";
import {
  unstable_cache,
  MemoryCacheStore,
  resolveCacheInvalidation,
  applyResolvedCacheInvalidation,
  type ResolvedCacheInvalidation,
  type CacheEntry,
  type CachePolicy,
  type CacheStore,
  type RouteCacheEntry,
  type RouteCachePolicy,
  type RouteCacheStore
} from "@sourceog/runtime/cache";
import { DataCache, type DataCacheKey, type DataCacheEntry, type DataCacheBackend, type DataCacheOptions } from "@sourceog/runtime/data-cache";
import { DataFilesystemCacheStore, FilesystemCacheStore } from "@sourceog/runtime/filesystem-cache-store";
import {
  revalidatePath,
  revalidateTag,
  invalidateResource,
  cacheTag as runtimeCacheTag,
  cacheTTL,
  prerenderPolicy
} from "@sourceog/runtime/revalidate";
import type { CacheManifestEntry } from "@sourceog/runtime/contracts";

export type SourceOGCacheMode = "auto" | "force-cache" | "no-store" | "stale-while-revalidate";

export interface RouteCacheInspection {
  selector: string;
  hit: boolean;
  age: number | null;
  tags: string[];
  hotness: number;
  entries: CacheManifestEntry[];
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

interface SourceOGCacheHints {
  tags: string[];
  revalidate?: number;
  mode?: SourceOGCacheMode;
  scope: Record<string, string>;
  updatedTags: Array<{ from: string; to: string }>;
}

function ensureCacheHints(): SourceOGCacheHints | undefined {
  const context = getRequestContext();
  if (!context) {
    return undefined;
  }

  context.runtimeState ??= {};
  const state = context.runtimeState as typeof context.runtimeState & { sourceogCacheHints?: SourceOGCacheHints };
  state.sourceogCacheHints ??= {
    tags: [],
    scope: {},
    updatedTags: []
  };
  return state.sourceogCacheHints;
}

function parseDurationToSeconds(value: number | string): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, value);
  }

  if (typeof value !== "string") {
    return 0;
  }

  const normalized = value.trim().toLowerCase();
  const match = /^(\d+)(ms|s|m|h|d)?$/.exec(normalized);
  if (!match) {
    return 0;
  }

  const amount = Number.parseInt(match[1]!, 10);
  const unit = match[2] ?? "s";
  switch (unit) {
    case "ms":
      return Math.ceil(amount / 1000);
    case "m":
      return amount * 60;
    case "h":
      return amount * 3600;
    case "d":
      return amount * 86400;
    default:
      return amount;
  }
}

function normalizeFetchCacheMode(mode?: SourceOGCacheMode): "default" | "force-cache" | "no-store" | undefined {
  if (!mode) {
    return undefined;
  }

  if (mode === "stale-while-revalidate") {
    return "force-cache";
  }

  if (mode === "auto") {
    return "default";
  }

  return mode;
}

function normalizeFetchTarget(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }

  if (input instanceof URL) {
    return input.toString();
  }

  return input.url;
}

function currentCacheEntries(selector: string): CacheManifestEntry[] {
  const manifest = getRequestContext()?.runtimeState?.cacheManifest;
  if (!manifest) {
    return [];
  }

  return manifest.entries.filter((entry) =>
    entry.pathname === selector
    || entry.routeId === selector
    || entry.tags.includes(selector)
    || entry.linkedTagIds.includes(selector)
  );
}

export async function sourceogFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  options: SourceOGFetchOptions = {}
): Promise<Response> {
  const hints = ensureCacheHints();
  const scopeValue = Object.values(hints?.scope ?? {}).join(":");
  const mergedOptions: SourceOGFetchOptions = {
    ...options,
    cache: (options.cache ?? normalizeFetchCacheMode(hints?.mode)) as SourceOGFetchOptions["cache"],
    revalidate: options.revalidate ?? hints?.revalidate,
    tags: [...new Set([...(hints?.tags ?? []), ...(options.tags ?? [])])],
    routeScope: options.routeScope ?? (scopeValue || undefined)
  };

  return runtimeSourceogFetch(normalizeFetchTarget(input), init, mergedOptions);
}

export function cacheTag(...tags: string[]): string[] {
  const hints = ensureCacheHints();
  if (hints) {
    hints.tags = [...new Set([...hints.tags, ...tags])];
  }
  return runtimeCacheTag(...tags);
}

export function cacheLife(value: number | string): number {
  const seconds = parseDurationToSeconds(value);
  const hints = ensureCacheHints();
  if (hints) {
    hints.revalidate = seconds;
  }
  return cacheTTL(seconds);
}

export function cacheMode(mode: SourceOGCacheMode): SourceOGCacheMode {
  const hints = ensureCacheHints();
  if (hints) {
    hints.mode = mode;
  }
  return mode;
}

export function cacheScope(scope: string, value: string): string {
  const hints = ensureCacheHints();
  if (hints) {
    hints.scope[scope] = value;
  }
  return `${scope}:${value}`;
}

export async function updateTag(previousTag: string, nextTag: string): Promise<void> {
  const hints = ensureCacheHints();
  if (hints) {
    hints.tags = hints.tags.map((tag) => tag === previousTag ? nextTag : tag);
    hints.updatedTags.push({ from: previousTag, to: nextTag });
  }
  clearRequestMemoByTags([previousTag]);
}

export async function warmRoute(pathname: string): Promise<{ target: string; warmed: boolean }> {
  await sourceogFetch(pathname, undefined, { cache: "force-cache" });
  return { target: pathname, warmed: true };
}

export async function warmTag(tag: string): Promise<{ tag: string; warmed: boolean }> {
  cacheTag(tag);
  return { tag, warmed: true };
}

export async function warmRouteSubtree(pathname: string): Promise<{ subtree: string; warmed: boolean }> {
  await warmRoute(pathname);
  return { subtree: pathname, warmed: true };
}

export async function inspectRouteCache(selector: string): Promise<RouteCacheInspection> {
  const entries = currentCacheEntries(selector);
  const hints = ensureCacheHints();
  const tags = [...new Set(entries.flatMap((entry) => entry.tags))].sort();

  return {
    selector,
    hit: entries.length > 0,
    age: null,
    tags,
    hotness: entries.length,
    entries,
    mode: hints?.mode,
    scope: hints?.scope
  };
}

export async function inspectGraphNode(nodeId: string): Promise<GraphNodeInspection> {
  if (typeof window !== "undefined") {
    const graphManifest = (window.__SOURCEOG_INITIAL_RENDER_SNAPSHOT__ as typeof window.__SOURCEOG_INITIAL_RENDER_SNAPSHOT__ & {
      consistencyGraphManifest?: { edges?: Array<{ from: string; to: string }> };
    } | undefined)?.consistencyGraphManifest;
    const edges = graphManifest?.edges
      ?.filter((edge) => edge.from === nodeId || edge.to === nodeId)
      .map((edge) => edge.from === nodeId ? edge.to : edge.from) ?? [];

    return {
      id: nodeId,
      version: 1,
      edges,
      invalidationHistory: [],
      available: Boolean(graphManifest)
    };
  }

  return {
    id: nodeId,
    version: 1,
    edges: [],
    invalidationHistory: [],
    available: false
  };
}

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
};

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
};
