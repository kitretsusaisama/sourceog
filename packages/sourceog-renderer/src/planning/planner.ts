// sourceog-renderer/src/planning/planner.ts
// Alibaba CTO 2027 Standard — Execution Planner

import type { RouteDefinition } from '@sourceog/router';
import type { SourceOGRequestContext } from '@sourceog/runtime';
import type {
  ExecutionPlan,
  ExecutionPlanSegment,
  RenderStrategy,
  CachePolicy,
} from '../types/planning.js';
import { deriveCanonicalRouteId } from '../core/hashing.js';
import { resolveRenderPolicy } from './render-policy.js';
import { resolveCachePolicy } from './cache-policy.js';
import { resolveHydrationPolicy } from './hydration-policy.js';
import type {
  PolicyContext,
  RenderPolicyResult,
  CachePolicyResult,
  HydrationPolicyResult,
} from './planner-types.js';

/**
 * Context passed into the planner.
 */
export interface PlannerContext extends PolicyContext {
  /**
   * Hint from build-time analysis (e.g., static analyzer).
   */
  isStaticRoute?: boolean;
}

/**
 * The Execution Planner is responsible for determining the optimal rendering
 * strategy for a given route and request context.
 *
 * It bridges the gap between routing and rendering by producing a concrete
 * ExecutionPlan that downstream orchestrators can execute.
 */
export class ExecutionPlanner {
  /**
   * Creates an execution plan for the provided context.
   */
  public plan(ctx: PlannerContext): ExecutionPlan {
    const { route, requestContext, isStaticRoute } = ctx;
    const pathname = requestContext.request.url.pathname;

    // 1. Determine the base render policy (SSR, SSG, ISR, Stream, etc.)
    const renderPolicy: RenderPolicyResult = resolveRenderPolicy(
      route,
      requestContext,
      isStaticRoute,
    );

    // 2. Determine caching rules
    const cachePolicy: CachePolicyResult = resolveCachePolicy(
      route,
      requestContext,
    );

    // 3. Determine client-side hydration strategy
    const hydrationPolicy: HydrationPolicyResult = resolveHydrationPolicy(
      route,
      requestContext,
    );

    // 4. Build the segment list
    const segments = this.buildSegments(
      route,
      renderPolicy.strategy,
      cachePolicy.cache,
    );

    // 5. Construct the final plan
    return {
      routeId: deriveCanonicalRouteId(route.pathname, {}),
      pathname,
      shell: {
        mode: renderPolicy.shellMode,
        cache: cachePolicy.cache,
        revalidate: cachePolicy.revalidate,
      },
      segments,
      hydration: {
        mode: hydrationPolicy.mode,
      },
    };
  }

  /**
   * Constructs the list of render segments for the execution plan.
   *
   * In a full implementation, this would analyze the component tree and
   * parallel routes. Here we follow a simplified convention:
   * - Layouts (outer to inner) stream by default.
   * - Template (if present) streams.
   * - Page uses the chosen primary strategy.
   */
  private buildSegments(
    route: RouteDefinition,
    strategy: RenderStrategy,
    cache: CachePolicy,
  ): ExecutionPlanSegment[] {
    const segments: ExecutionPlanSegment[] = [];
    let priority = 100;

    // Layouts — higher priority (render first)
    for (const layoutFile of route.layouts) {
      segments.push({
        id: `layout:${layoutFile}`,
        kind: 'layout',
        strategy: 'stream',
        priority,
        cache,
      });
      priority -= 10;
    }

    // Template, if present
    if (route.templateFile) {
      segments.push({
        id: `template:${route.templateFile}`,
        kind: 'layout',
        strategy: 'stream',
        priority,
        cache,
      });
      priority -= 10;
    }

    // Page — core content
    segments.push({
      id: `page:${route.file}`,
      kind: 'page',
      strategy,
      priority,
      cache,
      timeoutMs: 5000,
    });

    return segments;
  }
}
