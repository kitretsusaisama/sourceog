import type { DesignRouteMatch } from "./types.js";
export type { DesignRouteMatch };
/**
 * rankRoutes — returns the highest-precedence candidate from a non-empty array.
 *
 * Scoring: static=1000, dynamic=100, catch-all=10, optional-catch-all=1 per segment.
 * Tie-breaking: lexicographic ascending on `routeKey` (deterministic regardless of input order).
 *
 * Requirements: 13.1, 13.2, 13.3, 13.4
 */
export declare function rankRoutes(candidates: DesignRouteMatch[]): DesignRouteMatch;
