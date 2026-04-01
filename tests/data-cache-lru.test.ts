/**
 * Tests for bounded L1 cache with LRU eviction in DataCache (RF-10)
 * Validates: Requirement 8 (Bounded L1 Cache with LRU Eviction)
 */
import { describe, it, expect } from "vitest";
import { DataCache } from "@sourceog/runtime";
import type { DataCacheKey } from "@sourceog/runtime";

function makeKey(url: string, tags: string[] = []): DataCacheKey {
  return {
    url,
    method: "GET",
    bodyHash: "",
    tags: [...tags].sort(),
    runtimeTarget: "node",
  };
}

describe("DataCache — maxL1Size constructor option (Requirement 8.1)", () => {
  it("accepts maxL1Size option without error", () => {
    expect(() => new DataCache(undefined, { maxL1Size: 10 })).not.toThrow();
  });

  it("works normally when maxL1Size is not set (unbounded)", async () => {
    const cache = new DataCache();
    for (let i = 0; i < 20; i++) {
      await cache.set(makeKey(`https://example.com/${i}`), `v${i}`);
    }
    // All entries should be retrievable
    for (let i = 0; i < 20; i++) {
      const result = await cache.get(makeKey(`https://example.com/${i}`));
      expect(result).not.toBeNull();
    }
  });
});

describe("DataCache — LRU eviction on insert (Requirement 8.2)", () => {
  it("evicts the LRU entry when l1.size reaches maxL1Size", async () => {
    const cache = new DataCache(undefined, { maxL1Size: 3 });

    const k1 = makeKey("https://example.com/1");
    const k2 = makeKey("https://example.com/2");
    const k3 = makeKey("https://example.com/3");
    const k4 = makeKey("https://example.com/4");

    await cache.set(k1, "v1");
    await cache.set(k2, "v2");
    await cache.set(k3, "v3");
    // Cache is now full (size = 3). Inserting k4 should evict k1 (LRU).
    await cache.set(k4, "v4");

    expect(await cache.get(k1, false)).toBeNull();   // evicted
    expect(await cache.get(k2, false)).not.toBeNull();
    expect(await cache.get(k3, false)).not.toBeNull();
    expect(await cache.get(k4, false)).not.toBeNull();
  });

  it("does not evict when inserting an already-existing key (update in place)", async () => {
    const cache = new DataCache(undefined, { maxL1Size: 2 });

    const k1 = makeKey("https://example.com/1");
    const k2 = makeKey("https://example.com/2");

    await cache.set(k1, "v1");
    await cache.set(k2, "v2");
    // Re-setting k1 should NOT evict k2 (size stays at 2)
    await cache.set(k1, "v1-updated");

    expect((await cache.get(k1, false))?.value).toBe("v1-updated");
    expect(await cache.get(k2, false)).not.toBeNull();
  });
});

describe("DataCache — L1 size invariant (Requirement 8.3)", () => {
  it("l1.size never exceeds maxL1Size after many inserts", async () => {
    const maxL1Size = 5;
    const cache = new DataCache(undefined, { maxL1Size });

    for (let i = 0; i < 20; i++) {
      await cache.set(makeKey(`https://example.com/${i}`), `v${i}`);
    }

    // We can't inspect l1 directly, but we can verify that only the last
    // maxL1Size entries are present (since each insert evicts the LRU).
    // Entries 0..14 should be evicted; entries 15..19 should remain.
    for (let i = 0; i < 15; i++) {
      expect(await cache.get(makeKey(`https://example.com/${i}`), false)).toBeNull();
    }
    for (let i = 15; i < 20; i++) {
      expect(await cache.get(makeKey(`https://example.com/${i}`), false)).not.toBeNull();
    }
  });
});

describe("DataCache — LRU position update on get() (Requirement 8.4)", () => {
  it("accessing an entry via get() promotes it to MRU, protecting it from eviction", async () => {
    const cache = new DataCache(undefined, { maxL1Size: 3 });

    const k1 = makeKey("https://example.com/1");
    const k2 = makeKey("https://example.com/2");
    const k3 = makeKey("https://example.com/3");
    const k4 = makeKey("https://example.com/4");

    await cache.set(k1, "v1");
    await cache.set(k2, "v2");
    await cache.set(k3, "v3");

    // Access k1 — it becomes MRU; k2 is now LRU
    await cache.get(k1, false);

    // Insert k4 — should evict k2 (LRU), not k1
    await cache.set(k4, "v4");

    expect(await cache.get(k1, false)).not.toBeNull(); // protected by recent access
    expect(await cache.get(k2, false)).toBeNull();     // evicted
    expect(await cache.get(k3, false)).not.toBeNull();
    expect(await cache.get(k4, false)).not.toBeNull();
  });

  it("LRU order reflects access pattern across multiple gets", async () => {
    const cache = new DataCache(undefined, { maxL1Size: 2 });

    const k1 = makeKey("https://example.com/1");
    const k2 = makeKey("https://example.com/2");
    const k3 = makeKey("https://example.com/3");

    await cache.set(k1, "v1");
    await cache.set(k2, "v2");

    // Access k1 — k2 becomes LRU
    await cache.get(k1, false);

    // Insert k3 — should evict k2
    await cache.set(k3, "v3");

    expect(await cache.get(k1, false)).not.toBeNull();
    expect(await cache.get(k2, false)).toBeNull();
    expect(await cache.get(k3, false)).not.toBeNull();
  });
});

describe("DataCache — LRU eviction cleans up tag index", () => {
  it("evicted entry's tags are removed from the tag index", async () => {
    const cache = new DataCache(undefined, { maxL1Size: 2 });

    const k1 = makeKey("https://example.com/1", ["products"]);
    const k2 = makeKey("https://example.com/2", ["products"]);
    const k3 = makeKey("https://example.com/3", ["products"]);

    await cache.set(k1, "v1", { tags: ["products"] });
    await cache.set(k2, "v2", { tags: ["products"] });
    // k1 is evicted here
    await cache.set(k3, "v3", { tags: ["products"] });

    // revalidateTag should only remove k2 and k3 (k1 was already evicted)
    await cache.revalidateTag("products");

    expect(await cache.get(k1, false)).toBeNull(); // was evicted before revalidate
    expect(await cache.get(k2, false)).toBeNull(); // invalidated
    expect(await cache.get(k3, false)).toBeNull(); // invalidated
  });
});

describe("DataCache — maxL1Size = 1 edge case", () => {
  it("cache of size 1 always holds only the most recently set entry", async () => {
    const cache = new DataCache(undefined, { maxL1Size: 1 });

    const k1 = makeKey("https://example.com/1");
    const k2 = makeKey("https://example.com/2");

    await cache.set(k1, "v1");
    await cache.set(k2, "v2");

    expect(await cache.get(k1, false)).toBeNull();
    expect((await cache.get(k2, false))?.value).toBe("v2");
  });
});
