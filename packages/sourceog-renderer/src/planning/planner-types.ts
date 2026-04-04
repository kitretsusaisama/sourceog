// sourceog-renderer/src/planning/planner-types.ts
// Alibaba CTO 2027 Standard — Planning Types

import type {
  ExecutionPlanSegment,
  RenderStrategy,
  CachePolicy,
  HydrationMode,
} from '../types/planning.js';
import type { RouteDefinition } from '@sourceog/router';
import type { SourceOGRequestContext } from '@sourceog/runtime';

/**
 * Input context for policy resolution.
 */
export interface PolicyContext {
  route: RouteDefinition;
  requestContext: SourceOGRequestContext;
  isStaticHint?: boolean;
}

/**
 * Result of the render policy resolution.
 */
export interface RenderPolicyResult {
  /**
   * The chosen rendering strategy.
   */
  strategy: RenderStrategy;

  /**
   * Shell generation mode.
   * - 'static': pre-rendered HTML shell.
   * - 'dynamic': generated per request.
   */
  shellMode: 'static' | 'dynamic';
}

/**
 * Result of the cache policy resolution.
 */
export interface CachePolicyResult {
  /**
   * Cache visibility.
   */
  cache: CachePolicy;

  /**
   * Revalidation period in seconds for ISR.
   */
  revalidate?: number;

  /**
   * Cache tags for granular invalidation.
   */
  tags?: string[];
}

/**
 * Result of the hydration policy resolution.
 */
export interface HydrationPolicyResult {
  /**
   * The chosen hydration mode.
   */
  mode: HydrationMode;

  /**
   * Specific boundaries (component ids, slots) to hydrate as islands.
   */
  boundaries?: string[];
}

/**
 * Static analysis result for a route module.
 * Used by the planner to make smarter decisions (e.g., pure SSR vs dynamic).
 */
export interface StaticAnalysisResult {
  /**
   * True if the component has no dynamic server-side dependencies.
   */
  isPure: boolean;

  /**
   * True if the component uses server actions.
   */
  hasActions: boolean;

  /**
   * List of client boundaries imported (e.g., client components).
   */
  clientBoundaries: string[];
}