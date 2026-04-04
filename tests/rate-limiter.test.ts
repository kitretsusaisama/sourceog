import { describe, it } from "vitest";
import * as fc from "fast-check";
import { expect } from "vitest";
import { RateLimiter, rateLimit, type RateLimitRule } from "@sourceog/platform";
import type { SourceOGRequest } from "@sourceog/runtime";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(ip = "127.0.0.1", userId?: string): SourceOGRequest {
  const headers = new Headers({ "x-forwarded-for": ip });
  if (userId) headers.set("x-user-id", userId);
  const cookies = new Map<string, string>();
  return {
    url: new URL("http://localhost/"),
    method: "GET",
    headers,
    cookies,
    requestId: "test-id",
    runtime: "node",
    async bodyText() { return ""; },
    async bodyJson<T>() { return {} as T; },
  };
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Generates a RateLimitRule with small, tractable values */
const rateLimitRuleArb: fc.Arbitrary<RateLimitRule> = fc.record({
  windowMs: fc.integer({ min: 1000, max: 60_000 }),
  max: fc.integer({ min: 1, max: 20 }),
  keyBy: fc.constant("ip" as const),
  skipSuccessfulRequests: fc.constant(false),
});

// ---------------------------------------------------------------------------
// Property 26: Rate limiter allows requests under the limit
// Validates: Requirements 8.2
// ---------------------------------------------------------------------------

describe("RateLimiter — Property 26: Rate limiter allows requests under the limit", () => {
  /**
   * **Validates: Requirements 8.2**
   *
   * For any RateLimitRule and a request count strictly less than rule.max,
   * every call to check() must return { allowed: true }.
   */
  it("all results have allowed: true when count < rule.max", async () => {
    await fc.assert(
      fc.asyncProperty(
        // max >= 2 so we can always pick a count in [1, max-1]
        fc.integer({ min: 2, max: 20 }).chain((max) =>
          fc.record({
            rule: fc.record({
              windowMs: fc.integer({ min: 1000, max: 60_000 }),
              max: fc.constant(max),
              keyBy: fc.constant("ip" as const),
              skipSuccessfulRequests: fc.constant(false),
            }),
            count: fc.integer({ min: 1, max: max - 1 }),
          })
        ),
        async ({ rule, count }) => {
          const limiter = new RateLimiter();
          const req = makeRequest("10.0.0.1");
          const results = [];
          for (let i = 0; i < count; i++) {
            results.push(limiter.check(req, rule));
          }
          return results.every((r) => r.allowed === true);
        }
      )
    );
  });

  it("remaining decrements correctly as requests are made", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 10 }),
        async (max) => {
          const rule: RateLimitRule = { windowMs: 60_000, max, keyBy: "ip" };
          const limiter = new RateLimiter();
          const req = makeRequest("10.0.0.2");

          for (let i = 0; i < max - 1; i++) {
            const result = limiter.check(req, rule);
            if (!result.allowed) return false;
            if (result.remaining !== max - i - 1) return false;
          }
          return true;
        }
      )
    );
  });
});

// ---------------------------------------------------------------------------
// Property 27: Rate limiter blocks requests over the limit
// Validates: Requirements 8.3
// ---------------------------------------------------------------------------

describe("RateLimiter — Property 27: Rate limiter blocks requests over the limit", () => {
  /**
   * **Validates: Requirements 8.3**
   *
   * After sending rule.max requests, the next N requests (N > 0) must all
   * return { allowed: false }.
   */
  it("last N results have allowed: false when count >= rule.max", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 10 }).chain((max) =>
          fc.record({
            max: fc.constant(max),
            extra: fc.integer({ min: 1, max: 5 }),
          })
        ),
        async ({ max, extra }) => {
          const rule: RateLimitRule = { windowMs: 60_000, max, keyBy: "ip" };
          const limiter = new RateLimiter();
          const req = makeRequest("10.0.0.3");

          // Exhaust the limit
          for (let i = 0; i < max; i++) {
            limiter.check(req, rule);
          }

          // All subsequent requests must be blocked
          for (let i = 0; i < extra; i++) {
            const result = limiter.check(req, rule);
            if (result.allowed !== false) return false;
            if (result.remaining !== 0) return false;
          }
          return true;
        }
      )
    );
  });

  it("remaining is 0 when blocked", async () => {
    const rule: RateLimitRule = { windowMs: 60_000, max: 3, keyBy: "ip" };
    const limiter = new RateLimiter();
    const req = makeRequest("10.0.0.4");

    for (let i = 0; i < 3; i++) limiter.check(req, rule);

    const blocked = limiter.check(req, rule);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Unit tests for keyBy variants
// ---------------------------------------------------------------------------

describe("RateLimiter — keyBy variants", () => {
  it("keyBy: 'ip' uses x-forwarded-for header", () => {
    const rule: RateLimitRule = { windowMs: 60_000, max: 2, keyBy: "ip" };
    const limiter = new RateLimiter();

    const req1 = makeRequest("1.2.3.4");
    const req2 = makeRequest("5.6.7.8");

    limiter.check(req1, rule);
    limiter.check(req1, rule);

    // req1 is now at limit
    expect(limiter.check(req1, rule).allowed).toBe(false);
    // req2 is a different key — still allowed
    expect(limiter.check(req2, rule).allowed).toBe(true);
  });

  it("keyBy: 'userId' uses x-user-id header", () => {
    const rule: RateLimitRule = { windowMs: 60_000, max: 2, keyBy: "userId" };
    const limiter = new RateLimiter();

    const req = makeRequest("1.2.3.4", "user-abc");
    limiter.check(req, rule);
    limiter.check(req, rule);
    expect(limiter.check(req, rule).allowed).toBe(false);
  });

  it("keyBy: function uses returned string as key", () => {
    const rule: RateLimitRule = {
      windowMs: 60_000,
      max: 2,
      keyBy: (req) => req.headers.get("x-custom-key") ?? "default",
    };
    const limiter = new RateLimiter();

    const headers = new Headers({ "x-custom-key": "tenant-1" });
    const req: SourceOGRequest = {
      url: new URL("http://localhost/"),
      method: "GET",
      headers,
      cookies: new Map(),
      requestId: "r1",
      runtime: "node",
      async bodyText() { return ""; },
      async bodyJson<T>() { return {} as T; },
    };

    limiter.check(req, rule);
    limiter.check(req, rule);
    expect(limiter.check(req, rule).allowed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Unit tests for rateLimit factory
// ---------------------------------------------------------------------------

describe("rateLimit factory", () => {
  it("returns null when request is allowed", async () => {
    const { middleware } = rateLimit({ windowMs: 60_000, max: 5, keyBy: "ip" });
    const req = makeRequest("2.2.2.2");
    const result = await middleware(req);
    expect(result).toBeNull();
  });

  it("returns 429 SourceOGResponse when limit exceeded", async () => {
    const { middleware } = rateLimit({ windowMs: 60_000, max: 1, keyBy: "ip" });
    const req = makeRequest("3.3.3.3");

    // First request — allowed
    await middleware(req);
    // Second request — blocked
    const response = await middleware(req);
    expect(response).not.toBeNull();
    expect(response?.status).toBe(429);
  });

  it("sets retry-after header on 429 response", async () => {
    const { middleware } = rateLimit({ windowMs: 60_000, max: 1, keyBy: "ip" });
    const req = makeRequest("4.4.4.4");
    await middleware(req);
    const response = await middleware(req);
    expect(response?.headers.get("retry-after")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Unit tests for skipSuccessfulRequests
// ---------------------------------------------------------------------------

describe("RateLimiter — skipSuccessfulRequests", () => {
  it("does not count requests when recordSuccess is called", () => {
    const rule: RateLimitRule = {
      windowMs: 60_000,
      max: 2,
      keyBy: "ip",
      skipSuccessfulRequests: true,
    };
    const limiter = new RateLimiter();
    const req = makeRequest("5.5.5.5");

    // Make 2 requests and mark both as successful
    limiter.check(req, rule);
    limiter.recordSuccess(req, rule);
    limiter.check(req, rule);
    limiter.recordSuccess(req, rule);

    // Should still be allowed since successes were not counted
    const result = limiter.check(req, rule);
    expect(result.allowed).toBe(true);
  });
});
