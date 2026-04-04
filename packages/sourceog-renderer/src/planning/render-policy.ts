// sourceog-renderer/src/planning/render-policy.ts
// Alibaba CTO 2027 Standard — Render Policy Resolution

import type { RouteDefinition } from '@sourceog/router';
import type { SourceOGRequestContext } from '@sourceog/runtime';
import type { RenderPolicyResult } from './planner-types.js';
import type { RenderStrategy } from '../types/planning.js';

/**
 * Determines the optimal rendering strategy (SSG, ISR, SSR, Stream)
 * for a given route and request context.
 *
 * Priority:
 * 1. Force-dynamic headers.
 * 2. Static generation hints (build-time).
 * 3. Revalidation configuration (ISR).
 * 4. Default to Streaming RSC.
 */
export function resolveRenderPolicy(
  route: RouteDefinition,
  context: SourceOGRequestContext,
  isStaticHint?: boolean,
): RenderPolicyResult {
  // 1. Check for Force-Dynamic — skip any static generation
  if (isForceDynamic(context)) {
    return {
      strategy: 'stream',
      // Dynamic shell: generated per request.
      shellMode: 'dynamic',
    };
  }

  // 2. Static Generation (SSG) / ISR from route metadata
  // Convention: route.revalidate:
  // - undefined: full SSG
  // - 0: fully dynamic
  // - >0: ISR
  const revalidate = (route as any).revalidate as number | undefined;

  if (typeof revalidate === 'number') {
    if (revalidate > 0) {
      return {
        strategy: 'isr',
        shellMode: 'static',
      };
    }

    // revalidate === 0 → explicitly dynamic
    return {
      strategy: 'stream',
      shellMode: 'dynamic',
    };
  }

  if (isStaticHint) {
    return {
      strategy: 'ssg',
      shellMode: 'static',
    };
  }

  // 3. Default for RSC — Streaming SSR
  // This allows progressive delivery of the shell and chunks.
  return {
    strategy: 'stream',
    shellMode: 'dynamic',
  };
}

/**
 * Checks if the request forces a dynamic render.
 *
 * Heuristics:
 * - Cache-Control: no-store / no-cache.
 * - X-Preview-Mode: true (CMS preview).
 */
function isForceDynamic(context: SourceOGRequestContext): boolean {
  const headers = context.request.headers;

  const cacheControl = headers.get('cache-control');
  if (
    cacheControl &&
    (cacheControl.includes('no-store') || cacheControl.includes('no-cache'))
  ) {
    return true;
  }

  if (headers.get('x-preview-mode') === 'true') {
    return true;
  }

  return false;
}