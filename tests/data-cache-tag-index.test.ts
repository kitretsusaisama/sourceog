/**
 * Tests for TagIndex-based O(1) tag invalidation in DataCache
 * Validates: Requirement 7 (O(1) Tag Invalidation via Tag Index)
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

describe("TagIndex — set() maintains the index (Requirement 7.2)", () => {
  it("entries added with tags are removed by revalidateTag", async () => {
    const cache = new DataCache();
    const key = makeKey("https://example.com/a", ["products"]);

    await cache.set(key, "value-a", { tags: ["products"] });

    await cache.revalidateTag("products");

    const result = await cache.get(key);
    expect(result).toBeNull();
  });

  it("multiple entries with the same tag are all removed", async () => {
   
    const cache = new DataCache();
    const keys = [
      makeKey("https://example.com/1", ["products"]),
      makeKey("https://example.com/2", ["products"]),
      makeKey("https://example.com/3", ["products"]),
    ];

    for (const key of keys) {
      await cache.set(key, `value-${key.url}`, { tags: ["products"] });
    }

    await cache.revalidateTag("products");

    for (const key of keys) {
      expect(await cache.get(key)).toBeNull();
    }
  });

  it("entries without the invalidated tag are NOT removed (Requirement 7.3)", async () => {
    const cache = new DataCache();
    const taggedKey = makeKey("https://example.com/tagged", ["products"]);
    const untaggedKey = makeKey("https://example.com/untagged", ["users"]);

    await cache.set(taggedKey, "tagged-value", { tags: ["products"] });
    await cache.set(untaggedKey, "untagged-value", { tags: ["users"] });

    await cache.revalidateTag("products");

    expect(await cache.get(taggedKey)).toBeNull();
    const preserved = await cache.get(untaggedKey);
    expect(preserved).not.toBeNull();
    expect(preserved?.value).toBe("untagged-value");
  });

  it("entries with multiple tags: only entries with the invalidated tag are removed", async () => {
    const cache = new DataCache();
    const multiTagKey = makeKey("https://example.com/multi", ["products", "featured"]);
    const singleTagKey = makeKey("https://example.com/single", ["featured"]);

    await cache.set(multiTagKey, "multi-value", { tags: ["products", "featured"] });
    await cache.set(singleTagKey, "single-value", { tags: ["featured"] });

    await cache.revalidateTag("products");

    // multi-tag entry should be gone (it had "products")
    expect(await cache.get(multiTagKey)).toBeNull();
    // single-tag entry should remain (it only had "featured")
    const preserved = await cache.get(singleTagKey);
    expect(preserved).not.toBeNull();
    expect(preserved?.value).toBe("single-value");
  });
});

describe("TagIndex — delete() maintains the index (Requirement 7.5)", () => {
  it("deleting an entry removes it from the tag index", async () => {
    const cache = new DataCache();
    const key = makeKey("https://example.com/del", ["products"]);

    await cache.set(key, "value", { tags: ["products"] });
    cache.delete(key);

    // After delete, revalidateTag should not error and the entry is gone
    await expect(cache.revalidateTag("products")).resolves.not.toThrow();
    expect(await cache.get(key)).toBeNull();
  });

  it("deleting one entry does not affect other entries with the same tag", async () => {
    const cache = new DataCache();
    const key1 = makeKey("https://example.com/del1", ["products"]);
    const key2 = makeKey("https://example.com/del2", ["products"]);

    await cache.set(key1, "v1", { tags: ["products"] });
    await cache.set(key2, "v2", { tags: ["products"] });

    cache.delete(key1);

    // key2 should still be invalidated by revalidateTag
    await cache.revalidateTag("products");
    expect(await cache.get(key2)).toBeNull();
  });
});

describe("TagIndex — revalidateTag() uses index, not full scan (Requirement 7.3)", () => {
  it("revalidateTag on unknown tag does not throw", async () => {
    const cache = new DataCache();
    await expect(cache.revalidateTag("nonexistent-tag")).resolves.not.toThrow();
  });

  it("revalidateTag cleans up the tag index entry after invalidation", async () => {
    const cache = new DataCache();
    const key = makeKey("https://example.com/cleanup", ["cleanup-tag"]);

    await cache.set(key, "value", { tags: ["cleanup-tag"] });
    await cache.revalidateTag("cleanup-tag");

    // A second revalidateTag on the same tag should be a no-op (index entry was deleted)
    await expect(cache.revalidateTag("cleanup-tag")).resolves.not.toThrow();
  });

  it("revalidateTag calls l2.deleteByTag (Requirement 7.4)", async () => {
    const mockL2: DataCacheBackend = {
      get: vi.fn(async () => null),
      set: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
      deleteByTag: vi.fn(async () => {}),
    };

    const cache = new DataCache(mockL2);
    const key = makeKey("https://example.com/l2", ["my-tag"]);

    await cache.set(key, "value", { tags: ["my-tag"] });
    await cache.revalidateTag("my-tag");

    expect(mockL2.deleteByTag).toHaveBeenCalledWith("my-tag");
  });
});

describe("TagIndex — correctness with re-insertion after invalidation", () => {
  it("re-inserting an entry after invalidation makes it invalidatable again", async () => {
    const cache = new DataCache();
    const key = makeKey("https://example.com/reinsert", ["products"]);

    await cache.set(key, "v1", { tags: ["products"] });
    await cache.revalidateTag("products");
    expect(await cache.get(key)).toBeNull();

    // Re-insert
    await cache.set(key, "v2", { tags: ["products"] });
    expect((await cache.get(key))?.value).toBe("v2");

    // Should be invalidatable again
    await cache.revalidateTag("products");
    expect(await cache.get(key)).toBeNull();
  });

  it("entry with no tags is not affected by any revalidateTag call", async () => {
    const cache = new DataCache();
    const key = makeKey("https://example.com/notags", []);

    await cache.set(key, "no-tag-value", { tags: [] });
    await cache.revalidateTag("products");

    const result = await cache.get(key);
    expect(result).not.toBeNull();
    expect(result?.value).toBe("no-tag-value");
  });
});
