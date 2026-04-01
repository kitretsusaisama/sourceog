import { describe, it, expect, vi, afterEach } from "vitest";
import { RateLimiter, type RateLimitRule } from "@sourceog/platform";
import type { SourceOGRequest } from "@sourceog/runtime";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(ip = "127.0.0.1"): SourceOGRequest {
  return {
    url: new URL("http://localhost/"),
    method: "GET",
    headers: new Headers({ "x-forwarded-for": ip }),
    cookies: new Map(),
    requestId: "test-id",
    runtime: "node",
    async bodyText() { return ""; },
    async bodyJson<T>() { return {} as T; },
  };
}

/** Access the private store via casting for assertion purposes only. */
function storeSize(limiter: RateLimiter): number {
  return (limiter as unknown as { store: Map<unknown, unknown> }).store.size;
}

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// 1. Expired entries are removed from the store after a request
// ---------------------------------------------------------------------------

describe("RateLimiter TTL eviction — expired entries are removed", () => {
  it("removes a key whose entire window has expired when a new request arrives", () => {
    vi.useFakeTimers();

    const rule: RateLimitRule = { windowMs: 1_000, max: 10, keyBy: "ip" };
    const limiter = new RateLimiter();

    // Populate the store with key A at t=0
    limiter.check(makeRequest("1.1.1.1"), rule);
    expect(storeSize(limiter)).toBe(1);

    // Advance past the window so key A is fully expired
    vi.advanceTimersByTime(1_001);

    // A request from a different key triggers the sweep
    limiter.check(makeRequest("2.2.2.2"), rule);

    // Key A must have been evicted; only key B remains
    expect(storeSize(limiter)).toBe(1);
  });

  it("eviction happens before the current key is checked", () => {
    vi.useFakeTimers();

    const rule: RateLimitRule = { windowMs: 500, max: 10, keyBy: "ip" };
    const limiter = new RateLimiter();

    limiter.check(makeRequest("10.0.0.1"), rule);
    limiter.check(makeRequest("10.0.0.2"), rule);
    expect(storeSize(limiter)).toBe(2);

    vi.advanceTimersByTime(501);

    // Trigger via a third key — both old keys should be swept first
    limiter.check(makeRequest("10.0.0.3"), rule);
    expect(storeSize(limiter)).toBe(1); // only the new key survives
  });
});

// ---------------------------------------------------------------------------
// 2. Store does not grow unboundedly with many unique keys
// ---------------------------------------------------------------------------

describe("RateLimiter TTL eviction — store stays bounded", () => {
  it("store size stays at 1 after many unique expired keys", () => {
    vi.useFakeTimers();

    const rule: RateLimitRule = { windowMs: 100, max: 10, keyBy: "ip" };
    const limiter = new RateLimiter();

    // Send 50 requests from unique IPs, each separated by > windowMs
    for (let i = 0; i < 50; i++) {
      vi.advanceTimersByTime(101); // expire previous entries
      limiter.check(makeRequest(`192.168.1.${i}`), rule);
    }

    // After the last request only the most-recent key should remain
    expect(storeSize(limiter)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 3. Active entries (within the window) are NOT evicted
// ---------------------------------------------------------------------------

describe("RateLimiter TTL eviction — active entries are retained", () => {
  it("does not evict a key that still has timestamps within the window", () => {
    vi.useFakeTimers();

    const rule: RateLimitRule = { windowMs: 5_000, max: 10, keyBy: "ip" };
    const limiter = new RateLimiter();

    limiter.check(makeRequest("3.3.3.3"), rule);

    // Advance only halfway through the window
    vi.advanceTimersByTime(2_500);

    // Trigger a sweep via a different key
    limiter.check(makeRequest("4.4.4.4"), rule);

    // Both keys must still be present
    expect(storeSize(limiter)).toBe(2);
  });

  it("partially-expired key (some timestamps still active) is retained", () => {
    vi.useFakeTimers();

    const rule: RateLimitRule = { windowMs: 2_000, max: 10, keyBy: "ip" };
    const limiter = new RateLimiter();

    const req = makeRequest("5.5.5.5");

    // Two requests at t=0
    limiter.check(req, rule);
    limiter.check(req, rule);

    // Advance 1 500 ms — first timestamp is expired but second is still active
    vi.advanceTimersByTime(1_500);

    // Trigger sweep via another key
    limiter.check(makeRequest("6.6.6.6"), rule);

    // Key 5.5.5.5 still has one active timestamp — must NOT be evicted
    expect(storeSize(limiter)).toBe(2);
  });
});
