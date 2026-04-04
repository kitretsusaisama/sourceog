// sourceog-renderer/src/planning/cache-policy.ts
// Alibaba CTO 2027 Standard — Cache Policy Resolution

import type { RouteDefinition } from '@sourceog/router';
import type { SourceOGRequestContext } from '@sourceog/runtime';
import type { CachePolicyResult } from './planner-types.js';

/**
 * Determines caching headers and revalidation strategies for a route.
 *
 * Supports:
 * - Static caching:  cache = "public", immutable-style via long revalidate
 * - ISR:            cache = "public", revalidate = X
 * - Dynamic:        cache = "private", effectively no-store
 */
export function resolveCachePolicy(
  route: RouteDefinition,
  context: SourceOGRequestContext,
): CachePolicyResult {
  // -------------------------------------------------------------------------
  // 1. Security Check
  // -------------------------------------------------------------------------
  // Authenticated users should never receive shared/public cached content.
  // We treat the presence of an Authorization header or any cookies as a
  // signal for personalized responses.
  const hasAuth =
    context.request.headers.has('authorization') ||
    context.request.cookies.size > 0;

  if (hasAuth) {
    return {
      cache: 'private',
      revalidate: 0, // Do not cache personalized content
      tags: [`user:${context.request.requestId}`], // Scoped tag
    };
  }

  // -------------------------------------------------------------------------
  // 2. Route Configuration Check (ISR / Static)
  // -------------------------------------------------------------------------
  // Ideally, this reads from route.config or similar metadata:
  //   export const revalidate = 60;
  //
  // We conservatively check for a numeric `revalidate` field on the route.
  const revalidate = (route as { revalidate?: number }).revalidate;

  if (typeof revalidate === 'number') {
    return {
      cache: 'public',
      revalidate,
    };
  }

  // -------------------------------------------------------------------------
  // 3. Default Policy — Public with short revalidation window (optimistic)
  // -------------------------------------------------------------------------
  // This allows CDNs to cache while ensuring content is refreshed regularly.
  const DEFAULT_REVALIDATE = 60; // 1 minute
  const pathname = context.request.url.pathname ?? '/';

  return {
    cache: 'public',
    revalidate: DEFAULT_REVALIDATE,
    tags: [route.id, `path:${pathname}`],
  };
}