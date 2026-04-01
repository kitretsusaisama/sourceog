import type { DesignRouteMatch, DesignRouteSegment } from "./types.js";
export type { DesignRouteMatch };

/**
 * Score a single segment according to the ranking algorithm:
 *   static = 1000, dynamic = 100, catch-all = 10, optional-catch-all = 1
 * Group and parallel segments contribute 0 (they are transparent).
 */
function scoreSegment(segment: DesignRouteSegment): number {
  switch (segment.type) {
    case "static":
      return 1000;
    case "dynamic":
      return 100;
    case "catch-all":
      return 10;
    case "optional-catch-all":
      return 1;
    default:
      return 0;
  }
}

/**
 * Compute the total score for a RouteMatch by summing segment scores.
 */
function scoreMatch(match: DesignRouteMatch): number {
  return match.segments.reduce((total, seg) => total + scoreSegment(seg), 0);
}

/**
 * rankRoutes — returns the highest-precedence candidate from a non-empty array.
 *
 * Scoring: static=1000, dynamic=100, catch-all=10, optional-catch-all=1 per segment.
 * Tie-breaking: lexicographic ascending on `routeKey` (deterministic regardless of input order).
 *
 * Requirements: 13.1, 13.2, 13.3, 13.4
 */
export function rankRoutes(candidates: DesignRouteMatch[]): DesignRouteMatch {
  if (candidates.length === 0) {
    throw new RangeError("rankRoutes: candidates array must be non-empty");
  }

  return candidates.reduce((best, current) => {
    const bestScore = scoreMatch(best);
    const currentScore = scoreMatch(current);

    if (currentScore > bestScore) return current;
    if (currentScore < bestScore) return best;

    // Tie-break: lexicographic on routeKey (ascending — lower key wins for determinism)
    return current.routeKey < best.routeKey ? current : best;
  });
}
