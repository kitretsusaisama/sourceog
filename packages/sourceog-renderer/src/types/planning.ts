// sourceog-renderer/src/types/planning.ts
// Alibaba CTO 2027 Standard — Execution Planning Contracts

/**
 * The rendering strategy to use for a specific segment.
 * Determines how the segment is generated and delivered to the client.
 * 
 * - 'ssg': Static Site Generation. Rendered at build time.
 * - 'isr': Incremental Static Regeneration. Rendered at build time, revalidated periodically.
 * - 'ssr': Server-Side Rendering. Rendered on demand per request (blocking).
 * - 'stream': Streaming SSR. Rendered on demand, delivered progressively.
 * - 'client': Client-side only. No server output for this segment.
 */
export type RenderStrategy = 'ssg' | 'isr' | 'ssr' | 'stream' | 'client';

/**
 * The hydration strategy for client-side activation.
 * Controls when the client-side JavaScript takes over the server-rendered HTML.
 * 
 * - 'eager': Hydrate immediately after the shell is parsed.
 * - 'visible': Hydrate when the element enters the viewport (IntersectionObserver).
 * - 'idle': Hydrate when the main thread is idle (requestIdleCallback).
 * - 'interaction': Hydrate on user interaction (click/focus/hover).
 */
export type HydrationMode = 'eager' | 'visible' | 'idle' | 'interaction';

/**
 * Cache policy for the rendered output.
 * Directives for CDN and browser cache controls.
 * 
 * - 'public': Cacheable by shared caches (CDNs).
 * - 'private': Cacheable only by the browser.
 * - 'none': No caching allowed.
 */
export type CachePolicy = 'public' | 'private' | 'none';

/**
 * The execution plan for a specific route render.
 * 
 * This contract acts as the stable interface between the Planner, Orchestrator, and Render Engine.
 * It is immutable once created to ensure safe handoff between async boundaries.
 */
export interface ExecutionPlan {
  /** The unique identifier for the route (e.g., "app/pages/index"). */
  readonly routeId: string;

  /** The pathname being rendered (normalized). */
  readonly pathname: string;

  /** Configuration for the outer shell (HTML document wrapper). */
  readonly shell: {
    /** 'static' for pre-rendered shells, 'dynamic' for runtime shells. */
    readonly mode: 'static' | 'dynamic';
    /** Cache visibility and scope. */
    readonly cache: CachePolicy;
    /** Revalidation time in seconds (for ISR). Undefined implies no revalidation. */
    readonly revalidate?: number;
  };

  /** Ordered list of individual segments (layout, page, etc.) to render. */
  readonly segments: ReadonlyArray<ExecutionPlanSegment>;

  /** Client-side hydration configuration. */
  readonly hydration: {
    /** The chosen hydration strategy. */
    readonly mode: HydrationMode;
  };
}

/**
 * Represents a discrete unit of rendering work within a route.
 * A route typically consists of a root layout, nested layouts, and a page.
 */
export interface ExecutionPlanSegment {
  /** Unique identifier for this segment instance. */
  readonly id: string;

  /** The type of segment determining its role in the tree. */
  readonly kind: 'layout' | 'page' | 'deferred' | 'client-island' | 'engine-slot';

  /** The rendering strategy decided by the planner. */
  readonly strategy: RenderStrategy;

  /** Execution priority (higher number = higher priority). Used for scheduling. */
  readonly priority: number;

  /** Caching rules for this specific segment. */
  readonly cache: CachePolicy;

  /** Optional timeout override for this segment (milliseconds). */
  readonly timeoutMs?: number;
}