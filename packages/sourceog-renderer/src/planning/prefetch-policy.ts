// sourceog-renderer/src/planning/prefetch-policy.ts
// Alibaba CTO 2027 Standard — Prefetch Policy Resolution

import type { RouteDefinition } from '@sourceog/router';
import type { SourceOGRequestContext } from '@sourceog/runtime';

/**
 * The strategy to use for prefetching linked resources.
 *
 * - intent   Prefetch on hover/focus (balanced).
 * - viewport Prefetch when links enter viewport (aggressive).
 * - render   Prefetch immediately after page load (very aggressive).
 * - none     Disable prefetching.
 */
export type PrefetchStrategy = 'intent' | 'viewport' | 'render' | 'none';

export interface PrefetchPolicyResult {
  strategy: PrefetchStrategy;
  /**
   * Specific relative paths to prefetch.
   * If empty, the client runtime will heuristically scan the DOM for <a> tags.
   */
  targets?: string[];
}

/**
 * Determines the prefetching strategy based on network conditions and route priority.
 *
 * Optimizations:
 * - Respects the Save-Data Client Hint header.
 * - Reduces aggression on constrained mobile networks (ECT 2g/slow-2g).
 * - Falls back to intent-based prefetching as the default.
 */
export function resolvePrefetchPolicy(
  route: RouteDefinition,
  context: SourceOGRequestContext,
): PrefetchPolicyResult {
  const headers = context.request.headers;

  // 1. Check for Data Saver Mode (Save-Data: on)
  const saveData = headers.get('save-data');
  if (saveData === 'on') {
    return { strategy: 'none' };
  }

  // 2. Effective Connection Type (ECT) heuristic
  // Common values: '4g', '3g', '2g', 'slow-2g'
  const ect = headers.get('ect');
  if (ect === '2g' || ect === 'slow-2g') {
    return { strategy: 'none' };
  }

  // 3. Default Strategy — Intent-based Prefetching
  // This provides the best balance between perceived performance and bandwidth
  // usage by only prefetching links the user shows interest in.
  return {
    strategy: 'intent',
    // In a richer implementation, "targets" could be derived from a static
    // route graph (e.g., likely next routes); for now we rely on client heuristics.
    targets: undefined,
  };
}