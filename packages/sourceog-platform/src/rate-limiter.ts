import { SourceOGResponse } from "@sourceog/runtime";
import type { SourceOGRequest } from "@sourceog/runtime";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RateLimitRule {
  windowMs: number;
  max: number;
  keyBy: "ip" | "userId" | ((req: SourceOGRequest) => string);
  skipSuccessfulRequests?: boolean;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

// ---------------------------------------------------------------------------
// Sliding-window entry stored per key
// ---------------------------------------------------------------------------

interface WindowEntry {
  /** Timestamps (ms) of each counted request within the current window */
  timestamps: number[];
  /** When the oldest timestamp expires (ms since epoch) */
  resetAt: number;
}

// ---------------------------------------------------------------------------
// RateLimiter
// ---------------------------------------------------------------------------

export class RateLimiter {
  private readonly store = new Map<string, WindowEntry>();

  /**
   * Checks whether the request identified by `rule.keyBy` is within the rate
   * limit defined by `rule`.  Uses a sliding-window algorithm: only timestamps
   * that fall within the last `rule.windowMs` milliseconds are counted.
   *
   * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6
   */
  check(req: SourceOGRequest, rule: RateLimitRule): RateLimitResult {
    const key = this.resolveKey(req, rule);
    const now = Date.now();
    const windowStart = now - rule.windowMs;

    // Requirement 10.1, 10.2 — evict fully-expired entries before checking the
    // current key so the store does not grow unboundedly.
    for (const [k, e] of this.store) {
      if (e.timestamps.every((t) => t <= windowStart)) {
        this.store.delete(k);
      }
    }

    let entry = this.store.get(key);
    if (!entry) {
      entry = { timestamps: [], resetAt: now + rule.windowMs };
      this.store.set(key, entry);
    }

    // Evict timestamps outside the current window
    entry.timestamps = entry.timestamps.filter((t) => t > windowStart);

    // Recalculate resetAt based on the oldest timestamp in the window, or now
    entry.resetAt =
      entry.timestamps.length > 0
        ? entry.timestamps[0] + rule.windowMs
        : now + rule.windowMs;

    const count = entry.timestamps.length;

    if (count >= rule.max) {
      return { allowed: false, remaining: 0, resetAt: entry.resetAt };
    }

    // Count this request
    entry.timestamps.push(now);
    const remaining = rule.max - entry.timestamps.length;

    return { allowed: true, remaining, resetAt: entry.resetAt };
  }

  /**
   * Records a successful response for a key when `skipSuccessfulRequests` is
   * enabled.  Removes the most-recently-added timestamp so it doesn't count.
   *
   * Requirements: 8.7
   */
  recordSuccess(req: SourceOGRequest, rule: RateLimitRule): void {
    if (!rule.skipSuccessfulRequests) return;
    const key = this.resolveKey(req, rule);
    const entry = this.store.get(key);
    if (entry && entry.timestamps.length > 0) {
      entry.timestamps.pop();
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private resolveKey(req: SourceOGRequest, rule: RateLimitRule): string {
    if (typeof rule.keyBy === "function") {
      // Requirement 8.6
      return rule.keyBy(req);
    }
    if (rule.keyBy === "ip") {
      // Requirement 8.4
      const ip =
        req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
        req.headers.get("x-real-ip") ??
        "unknown";
      return `ip:${ip}`;
    }
    // Requirement 8.5 — userId from session cookie or Authorization header
    const userId =
      req.cookies.get("userId") ??
      req.cookies.get("session") ??
      req.headers.get("x-user-id") ??
      "anonymous";
    return `userId:${userId}`;
  }
}

// ---------------------------------------------------------------------------
// rateLimit middleware factory
// ---------------------------------------------------------------------------

export type RateLimitMiddleware = (
  req: SourceOGRequest
) => Promise<SourceOGResponse | null>;

/**
 * Creates a middleware function that enforces the given `rule`.
 *
 * Returns `null` when the request is allowed (caller should continue).
 * Returns a 429 `SourceOGResponse` when the limit is exceeded.
 *
 * When `rule.skipSuccessfulRequests` is `true`, the caller is responsible for
 * calling `limiter.recordSuccess(req, rule)` after a 2xx response.
 *
 * Requirements: 8.8
 */
export function rateLimit(rule: RateLimitRule): {
  middleware: RateLimitMiddleware;
  limiter: RateLimiter;
} {
  const limiter = new RateLimiter();

  const middleware: RateLimitMiddleware = async (req: SourceOGRequest) => {
    const result = limiter.check(req, rule);

    if (!result.allowed) {
      const retryAfterSeconds = Math.ceil((result.resetAt - Date.now()) / 1000);
      const response = new SourceOGResponse("Too Many Requests", {
        status: 429,
        headers: {
          "retry-after": String(Math.max(1, retryAfterSeconds)),
          "x-ratelimit-limit": String(rule.max),
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": String(Math.ceil(result.resetAt / 1000)),
        },
      });
      return response;
    }

    return null;
  };

  return { middleware, limiter };
}
