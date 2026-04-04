import { SourceOGResponse } from "@sourceog/runtime";
import type { SourceOGRequest } from "@sourceog/runtime";
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
export declare class RateLimiter {
    private readonly store;
    /**
     * Checks whether the request identified by `rule.keyBy` is within the rate
     * limit defined by `rule`.  Uses a sliding-window algorithm: only timestamps
     * that fall within the last `rule.windowMs` milliseconds are counted.
     *
     * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6
     */
    check(req: SourceOGRequest, rule: RateLimitRule): RateLimitResult;
    /**
     * Records a successful response for a key when `skipSuccessfulRequests` is
     * enabled.  Removes the most-recently-added timestamp so it doesn't count.
     *
     * Requirements: 8.7
     */
    recordSuccess(req: SourceOGRequest, rule: RateLimitRule): void;
    private resolveKey;
}
export type RateLimitMiddleware = (req: SourceOGRequest) => Promise<SourceOGResponse | null>;
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
export declare function rateLimit(rule: RateLimitRule): {
    middleware: RateLimitMiddleware;
    limiter: RateLimiter;
};
