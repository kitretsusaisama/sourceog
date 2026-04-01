import { getRequestContext } from "./context.js";
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

export class MemoryCacheStore implements CacheStore {
  private readonly entries = new Map<string, CacheEntry>();

  public async get(key: string): Promise<CacheEntry | null> {
    const entry = this.entries.get(key);
    if (!entry) {
      return null;
    }

    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return null;
    }

    return entry;
  }

  public async set(_key: string, entry: CacheEntry, _policy: CachePolicy): Promise<void> {
    this.entries.set(entry.routeKey, entry);
  }

  public async purge(tags: string[]): Promise<void> {
    if (tags.length === 0) {
      return;
    }

    const lookup = new Set(tags);
    for (const [key, entry] of this.entries.entries()) {
      if (entry.tags.some((tag) => lookup.has(tag))) {
        this.entries.delete(key);
      }
    }
  }

  public async revalidate(routeKey: string): Promise<void> {
    this.entries.delete(routeKey);
  }

  public async purgeKeys(keys: string[]): Promise<void> {
    if (keys.length === 0) {
      return;
    }

    for (const key of keys) {
      this.entries.delete(key);
    }
  }

  public async purgeLinkedRoutes(routeKeys: string[]): Promise<void> {
    if (routeKeys.length === 0) {
      return;
    }

    const lookup = new Set(routeKeys);
    for (const [key, entry] of this.entries.entries()) {
      if (entry.linkedRouteIds.some((routeKey) => lookup.has(routeKey))) {
        this.entries.delete(key);
      }
    }
  }
}

interface FunctionCacheValue<T> {
  value: T;
  expiresAt: number;
  tags: string[];
  linkedRouteIds: string[];
  linkedTagIds: string[];
}

interface MemoizedFetchSnapshot {
  body: Uint8Array;
  headers: Array<[string, string]>;
  status: number;
  statusText: string;
}

interface DataCacheSnapshot extends MemoizedFetchSnapshot {
  expiresAt: number;
  linkedRouteIds: string[];
  linkedTagIds: string[];
}

export interface ResolvedCacheInvalidation {
  cacheKeys: string[];
  routeIds: string[];
  pathnames: string[];
  tags: string[];
  invalidated: boolean;
}

const functionCache = new Map<string, FunctionCacheValue<unknown>>();
const dataCache = new Map<string, DataCacheSnapshot>();

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableSerialize(entryValue)}`);

  return `{${entries.join(",")}}`;
}

export function unstable_cache<TArgs extends unknown[], TResult>(
  handler: (...args: TArgs) => Promise<TResult> | TResult,
  keyParts: string[] = [],
  options?: { tags?: string[]; revalidate?: number; routeIds?: string[] }
): (...args: TArgs) => Promise<TResult> {
  const ttlSeconds = options?.revalidate ?? 0;
  const tags = options?.tags ?? [];
  const linkedRouteIds = [...(options?.routeIds ?? [])].sort();

  return async (...args: TArgs): Promise<TResult> => {
    const key = `${keyParts.join(":")}::${stableSerialize(args)}`;
    const cached = functionCache.get(key) as FunctionCacheValue<TResult> | undefined;
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    const value = await handler(...args);
    functionCache.set(key, {
      value,
      expiresAt: ttlSeconds > 0 ? Date.now() + ttlSeconds * 1_000 : Number.MAX_SAFE_INTEGER,
      tags,
      linkedRouteIds,
      linkedTagIds: [...tags].sort()
    });
    return value;
  };
}

export async function invalidateCachedFunctionsByTag(tag: string): Promise<void> {
  for (const [key, value] of functionCache.entries()) {
    if (value.tags.includes(tag) || value.linkedTagIds.includes(tag)) {
      functionCache.delete(key);
    }
  }
}

export async function invalidateCachedFunctionsByRoute(routeIdOrPathname: string): Promise<void> {
  for (const [key, value] of functionCache.entries()) {
    if (value.linkedRouteIds.includes(routeIdOrPathname)) {
      functionCache.delete(key);
    }
  }
}

export async function invalidateDataCacheByTag(tag: string): Promise<void> {
  for (const [key, value] of dataCache.entries()) {
    if (value.linkedTagIds.includes(tag)) {
      dataCache.delete(key);
    }
  }

  const store = getRequestContext()?.runtimeState?.dataCacheStore;
  if (store) {
    await store.purge([tag]);
  }
}

export async function invalidateDataCacheByRoute(routeIdOrPathname: string): Promise<void> {
  for (const [key, value] of dataCache.entries()) {
    if (value.linkedRouteIds.includes(routeIdOrPathname)) {
      dataCache.delete(key);
    }
  }

  const store = getRequestContext()?.runtimeState?.dataCacheStore;
  if (store) {
    await store.purgeLinkedRoutes([routeIdOrPathname]);
  }
}

export async function invalidateDataCacheByKey(cacheKey: string): Promise<void> {
  dataCache.delete(cacheKey);

  const store = getRequestContext()?.runtimeState?.dataCacheStore;
  if (store) {
    await store.purgeKeys([cacheKey]);
  }
}

export async function applyResolvedCacheInvalidation(resolved: ResolvedCacheInvalidation): Promise<void> {
  if (!resolved.invalidated) {
    return;
  }

  clearRequestMemoization();
  for (const cacheKey of resolved.cacheKeys) {
    await invalidateDataCacheByKey(cacheKey);
  }
  for (const routeOrPath of [...resolved.pathnames, ...resolved.routeIds]) {
    await invalidateCachedFunctionsByRoute(routeOrPath);
    await invalidateDataCacheByRoute(routeOrPath);
  }
  for (const tag of resolved.tags) {
    await invalidateCachedFunctionsByTag(tag);
    await invalidateDataCacheByTag(tag);
  }
}

export function getRequestMemoizationEntryCount(): number {
  return getRequestContext()?.runtimeState?.requestMemoization?.entries.size ?? 0;
}

export function clearRequestMemoization(): void {
  getRequestContext()?.runtimeState?.requestMemoization?.entries.clear();
}

export function resolveCacheInvalidation(input: {
  paths?: string[];
  tags?: string[];
  actionId?: string;
  cacheManifest?: CacheManifest;
}): ResolvedCacheInvalidation {
  const cacheKeys = new Set<string>();
  const routeIds = new Set<string>();
  const pathnames = new Set<string>(input.paths ?? []);
  const tags = new Set<string>(input.tags ?? []);
  const manifest = input.cacheManifest;

  if (!manifest) {
    return {
      cacheKeys: [],
      routeIds: [],
      pathnames: [...pathnames].sort(),
      tags: [...tags].sort(),
      invalidated: pathnames.size > 0 || tags.size > 0
    };
  }

  for (const entry of manifest.entries) {
    const matchesPath = entry.pathname ? pathnames.has(entry.pathname) : false;
    const matchesTag = entry.linkedTagIds.some((tag) => tags.has(tag));
    if (!matchesPath && !matchesTag) {
      continue;
    }

    cacheKeys.add(entry.cacheKey);
    if (entry.routeId) {
      routeIds.add(entry.routeId);
    }
    if (entry.pathname) {
      pathnames.add(entry.pathname);
    }
    for (const tag of entry.linkedTagIds) {
      tags.add(tag);
    }
  }

  if (input.actionId) {
    for (const link of manifest.invalidationLinks.filter((entry) => entry.actionId === input.actionId)) {
      for (const cacheKey of link.targetCacheKeys) {
        cacheKeys.add(cacheKey);
      }
      for (const routeId of link.routeIds) {
        routeIds.add(routeId);
      }
      for (const pathname of link.pathnames) {
        pathnames.add(pathname);
      }
      for (const tag of link.tags) {
        tags.add(tag);
      }
    }
  }

  return {
    cacheKeys: [...cacheKeys].sort(),
    routeIds: [...routeIds].sort(),
    pathnames: [...pathnames].sort(),
    tags: [...tags].sort(),
    invalidated: cacheKeys.size > 0 || routeIds.size > 0 || pathnames.size > 0 || tags.size > 0
  };
}

export async function sourceogFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  options: SourceOGFetchOptions = {}
): Promise<Response> {
  const method = (init?.method ?? "GET").toUpperCase();
  if (!shouldMemoizeRequest(method, options.cache)) {
    return fetch(input, init);
  }

  const memoizationState = getOrCreateRequestMemoizationState();
  if (!memoizationState) {
    return fetch(input, init);
  }

  const requestContext = getRequestContext();
  const memoizationKey = createFetchMemoizationKey(
    requestContext?.request.url.pathname,
    input,
    init,
    options
  );
  const sharedCached = readSharedDataCache(memoizationKey);
  if (sharedCached) {
    memoizationState.entries.set(memoizationKey, Promise.resolve(sharedCached));
    return createMemoizedResponse(sharedCached);
  }
  const persistentCached = await readPersistentDataCache(memoizationKey);
  if (persistentCached) {
    dataCache.set(memoizationKey, persistentCached);
    memoizationState.entries.set(memoizationKey, Promise.resolve(persistentCached));
    return createMemoizedResponse(persistentCached);
  }
  const existing = memoizationState.entries.get(memoizationKey) as Promise<MemoizedFetchSnapshot> | undefined;
  if (existing) {
    return createMemoizedResponse(await existing);
  }

  const snapshotPromise = fetch(input, init).then(async (response) => {
    const snapshot = await captureFetchSnapshot(response);
    await writeSharedDataCache(memoizationKey, snapshot, requestContext?.request.url.pathname, options);
    return snapshot;
  });
  memoizationState.entries.set(memoizationKey, snapshotPromise);

  try {
    return createMemoizedResponse(await snapshotPromise);
  } catch (error) {
    memoizationState.entries.delete(memoizationKey);
    throw error;
  }
}

function shouldMemoizeRequest(method: string, cacheMode?: SourceOGFetchCacheMode): boolean {
  if (cacheMode === "no-store") {
    return false;
  }

  return method === "GET" || method === "HEAD";
}

function getOrCreateRequestMemoizationState():
  | NonNullable<NonNullable<ReturnType<typeof getRequestContext>>["runtimeState"]>["requestMemoization"]
  | undefined {
  const context = getRequestContext();
  if (!context) {
    return undefined;
  }

  context.runtimeState ??= {};
  context.runtimeState.requestMemoization ??= {
    entries: new Map<string, Promise<unknown>>()
  };
  return context.runtimeState.requestMemoization;
}

async function captureFetchSnapshot(response: Response): Promise<MemoizedFetchSnapshot> {
  return {
    body: new Uint8Array(await response.arrayBuffer()),
    headers: [...response.headers.entries()],
    status: response.status,
    statusText: response.statusText
  };
}

function createMemoizedResponse(snapshot: MemoizedFetchSnapshot): Response {
  return new Response(snapshot.body.slice(0), {
    status: snapshot.status,
    statusText: snapshot.statusText,
    headers: snapshot.headers
  });
}

function createFetchMemoizationKey(
  requestPathname: string | undefined,
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  options: SourceOGFetchOptions
): string {
  const headers =
    init?.headers instanceof Headers
      ? [...init.headers.entries()].sort(([left], [right]) => left.localeCompare(right))
      : Array.isArray(init?.headers)
        ? [...init.headers].sort(([left], [right]) => left.localeCompare(right))
        : Object.entries(init?.headers ?? {}).sort(([left], [right]) => left.localeCompare(right));
  const target = typeof input === "string"
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;

  return stableSerialize({
    requestPathname: options.routeScope ?? requestPathname ?? "",
    target,
    method: (init?.method ?? "GET").toUpperCase(),
    headers,
    cache: options.cache ?? "auto",
    revalidate: options.revalidate ?? null,
    tags: [...(options.tags ?? [])].sort()
  });
}

function readSharedDataCache(key: string): MemoizedFetchSnapshot | null {
  const cached = dataCache.get(key);
  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= Date.now()) {
    dataCache.delete(key);
    return null;
  }

  return cached;
}

async function writeSharedDataCache(
  key: string,
  snapshot: MemoizedFetchSnapshot,
  requestPathname: string | undefined,
  options: SourceOGFetchOptions
): Promise<void> {
  if (!shouldPersistInDataCache(options)) {
    return;
  }

  const ttlSeconds = options.revalidate ?? 0;
  const entry = {
    ...snapshot,
    expiresAt: ttlSeconds > 0 ? Date.now() + ttlSeconds * 1_000 : Number.MAX_SAFE_INTEGER,
    linkedRouteIds: [...new Set([options.routeScope ?? requestPathname ?? ""])].filter(Boolean).sort(),
    linkedTagIds: [...new Set(options.tags ?? [])].sort()
  };
  dataCache.set(key, entry);

  const store = getRequestContext()?.runtimeState?.dataCacheStore;
  if (store) {
    await store.set(key, {
      kind: "data",
      scope: "shared",
      routeKey: key,
      tags: [...entry.linkedTagIds],
      linkedRouteIds: [...entry.linkedRouteIds],
      linkedTagIds: [...entry.linkedTagIds],
      body: Buffer.from(entry.body),
      headers: Object.fromEntries(entry.headers),
      status: entry.status,
      createdAt: Date.now(),
      expiresAt: entry.expiresAt,
      etag: "",
      buildId: getRequestContext()?.runtimeState?.buildId ?? "runtime"
    }, {
      kind: "data",
      ttl: ttlSeconds,
      swr: 0,
      tags: [...entry.linkedTagIds],
      scope: "shared",
      linkedRouteIds: [...entry.linkedRouteIds],
      linkedTagIds: [...entry.linkedTagIds]
    });
  }
}

function shouldPersistInDataCache(options: SourceOGFetchOptions): boolean {
  if (options.cache === "no-store") {
    return false;
  }

  return options.cache === "force-cache" || typeof options.revalidate === "number";
}

async function readPersistentDataCache(key: string): Promise<DataCacheSnapshot | null> {
  const store = getRequestContext()?.runtimeState?.dataCacheStore;
  if (!store) {
    return null;
  }

  const entry = await store.get(key);
  if (!entry || entry.kind !== "data") {
    return null;
  }

  return {
    body: new Uint8Array(entry.body),
    headers: Object.entries(entry.headers),
    status: entry.status,
    statusText: "",
    expiresAt: entry.expiresAt,
    linkedRouteIds: [...entry.linkedRouteIds],
    linkedTagIds: [...entry.linkedTagIds]
  };
}
