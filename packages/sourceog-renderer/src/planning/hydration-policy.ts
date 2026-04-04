// sourceog-renderer/src/planning/hydration-policy.ts
// Alibaba CTO 2027 Standard — Hydration Policy Resolution

import type { RouteDefinition } from '@sourceog/router';
import type { SourceOGRequestContext } from '@sourceog/runtime';
import type { HydrationPolicyResult } from './planner-types.js';
import type { HydrationMode } from '../types/planning.js';

/**
 * Determines the client-side hydration strategy.
 *
 * Strategies:
 * - eager       Immediately hydrate (default for critical routes).
 * - visible     Hydrate when element enters viewport.
 * - idle        Hydrate during browser idle time.
 * - interaction Hydrate on user interaction (hover/click).
 */
export function resolveHydrationPolicy(
  route: RouteDefinition,
  context: SourceOGRequestContext,
): HydrationPolicyResult {
  // -------------------------------------------------------------------------
  // 1. Explicit route configuration
  // -------------------------------------------------------------------------
  // Assume route exports might define a hydration preference, e.g.:
  //   export const config = { hydration: 'idle' };
  const routeConfig = (route as { config?: { hydration?: HydrationMode } }).config;

  if (routeConfig?.hydration) {
    return {
      mode: routeConfig.hydration,
    };
  }

  // -------------------------------------------------------------------------
  // 2. Heuristics based on context (e.g., mobile vs desktop)
  // -------------------------------------------------------------------------
  const userAgent = context.request.headers.get('user-agent') ?? '';
  const isMobileClient = isMobile(userAgent);

  // Mobile devices benefit from deferred hydration to preserve resources
  // and improve Time to Interactive (TTI) for non-critical UI.
  if (isMobileClient) {
    return {
      mode: 'idle',
    };
  }

  // -------------------------------------------------------------------------
  // 3. Default: Eager hydration
  // -------------------------------------------------------------------------
  // Ensures the app is interactive as soon as possible on desktop / fast
  // connections.
  return {
    mode: 'eager',
  };
}