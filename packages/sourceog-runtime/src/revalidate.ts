import { getRequestContext } from "./context.js";
import {
  applyResolvedCacheInvalidation,
  type ResolvedCacheInvalidation,
  resolveCacheInvalidation
} from "./cache.js";
import { SourceOGError, SOURCEOG_ERROR_CODES } from "./errors.js";
import { clearRequestMemo, clearRequestMemoByTags } from "./fetch.js";

export type PrerenderPolicy = "auto" | "force-static" | "force-dynamic";

export interface RevalidationHandler {
  revalidatePath(pathname: string): Promise<void>;
  revalidateTag(tag: string): Promise<void>;
  applyResolvedInvalidation?(resolved: ResolvedCacheInvalidation): Promise<void>;
}

export interface RevalidationTrackingSummary {
  paths: string[];
  tags: string[];
  routeIds: string[];
  cacheKeys: string[];
  invalidated: boolean;
}

let revalidationHandler: RevalidationHandler | undefined;
const revalidationTrackingStack: Array<{
  paths: Set<string>;
  tags: Set<string>;
  routeIds: Set<string>;
  cacheKeys: Set<string>;
}> = [];

export function setRevalidationHandler(handler: RevalidationHandler): void {
  revalidationHandler = handler;
}

export async function applyRuntimeCacheInvalidation(resolved: ResolvedCacheInvalidation): Promise<void> {
  if (!revalidationHandler) {
    throw new SourceOGError(
      SOURCEOG_ERROR_CODES.RUNTIME_INCOMPATIBLE,
      "No SourceOG revalidation handler is registered in the current runtime."
    );
  }

  if (revalidationHandler.applyResolvedInvalidation) {
    await revalidationHandler.applyResolvedInvalidation(resolved);
  } else {
    for (const pathname of resolved.pathnames) {
      await revalidationHandler.revalidatePath(pathname);
    }
    for (const tag of resolved.tags) {
      await revalidationHandler.revalidateTag(tag);
    }
  }

  await applyResolvedCacheInvalidation(resolved);
}

export function mergeRevalidationTrackingSummary(
  summary: RevalidationTrackingSummary,
  addition: Pick<RevalidationTrackingSummary, "paths" | "tags" | "routeIds" | "cacheKeys" | "invalidated">
): RevalidationTrackingSummary {
  return {
    paths: [...new Set([...summary.paths, ...addition.paths])].sort(),
    tags: [...new Set([...summary.tags, ...addition.tags])].sort(),
    routeIds: [...new Set([...summary.routeIds, ...addition.routeIds])].sort(),
    cacheKeys: [...new Set([...summary.cacheKeys, ...addition.cacheKeys])].sort(),
    invalidated: summary.invalidated || addition.invalidated
  };
}

function trackResolvedCacheInvalidation(summary: Pick<RevalidationTrackingSummary, "paths" | "tags" | "routeIds" | "cacheKeys">): void {
  const tracking = revalidationTrackingStack.at(-1);
  for (const path of summary.paths) {
    tracking?.paths.add(path);
  }
  for (const tag of summary.tags) {
    tracking?.tags.add(tag);
  }
  for (const routeId of summary.routeIds) {
    tracking?.routeIds.add(routeId);
  }
  for (const cacheKey of summary.cacheKeys) {
    tracking?.cacheKeys.add(cacheKey);
  }
}

export async function revalidatePath(pathname: string): Promise<void> {
  if (!revalidationHandler) {
    throw new SourceOGError(
      SOURCEOG_ERROR_CODES.RUNTIME_INCOMPATIBLE,
      "No SourceOG revalidation handler is registered in the current runtime."
    );
  }

  const resolved = resolveCacheInvalidation({
    paths: [pathname],
    cacheManifest: getRequestContext()?.runtimeState?.cacheManifest
  });
  await applyRuntimeCacheInvalidation(resolved);
  // Bust the per-request memo so subsequent fetches go to the network
  clearRequestMemo();
  trackResolvedCacheInvalidation({
    paths: resolved.pathnames,
    tags: resolved.tags,
    routeIds: resolved.routeIds,
    cacheKeys: resolved.cacheKeys
  });
}

export async function revalidateTag(tag: string): Promise<void> {
  if (!revalidationHandler) {
    throw new SourceOGError(
      SOURCEOG_ERROR_CODES.RUNTIME_INCOMPATIBLE,
      "No SourceOG revalidation handler is registered in the current runtime."
    );
  }

  const resolved = resolveCacheInvalidation({
    tags: [tag],
    cacheManifest: getRequestContext()?.runtimeState?.cacheManifest
  });
  await applyRuntimeCacheInvalidation(resolved);
  // Bust memoized entries tagged with this tag
  clearRequestMemoByTags([tag, ...resolved.tags]);
  trackResolvedCacheInvalidation({
    paths: resolved.pathnames,
    tags: resolved.tags,
    routeIds: resolved.routeIds,
    cacheKeys: resolved.cacheKeys
  });
}

export async function withRevalidationTracking<T>(
  callback: () => Promise<T> | T
): Promise<{ result: T; summary: RevalidationTrackingSummary }> {
  const tracked = {
    paths: new Set<string>(),
    tags: new Set<string>(),
    routeIds: new Set<string>(),
    cacheKeys: new Set<string>()
  };

  revalidationTrackingStack.push(tracked);
  try {
    const result = await callback();
    const summary = {
      paths: [...tracked.paths].sort(),
      tags: [...tracked.tags].sort(),
      routeIds: [...tracked.routeIds].sort(),
      cacheKeys: [...tracked.cacheKeys].sort(),
      invalidated: tracked.paths.size > 0 || tracked.tags.size > 0 || tracked.routeIds.size > 0 || tracked.cacheKeys.size > 0
    };

    return {
      result,
      summary
    };
  } finally {
    revalidationTrackingStack.pop();
  }
}

export function cacheTag(...tags: string[]): string[] {
  return tags;
}

export function cacheTTL(seconds: number): number {
  return seconds;
}

export function prerenderPolicy(policy: PrerenderPolicy): PrerenderPolicy {
  return policy;
}
