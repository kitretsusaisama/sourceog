import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { DataCache, DataFilesystemCacheStore } from "@sourceog/runtime";
import type { DataCacheBackend, DataCacheEntry, DataCacheKey } from "@sourceog/runtime";

async function withTempDir<T>(prefix: string, run: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    return await run(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function makeKey(overrides: Partial<DataCacheKey> = {}): DataCacheKey {
  return {
    url: "https://example.com/api/data",
    method: "GET",
    bodyHash: "",
    tags: ["tag-a"],
    runtimeTarget: "node",
    ...overrides,
  };
}

describe("DataFilesystemCacheStore — L2 filesystem backend (Requirements 10.2)", () => {
  it("DataFilesystemCacheStore stores and retrieves a DataCacheEntry", async () => {
    await withTempDir("data-cache-fs-", async (dir) => {
      const store = new DataFilesystemCacheStore(dir);
      const key = JSON.stringify({ url: "https://example.com", method: "GET", bodyHash: "", tags: [], runtimeTarget: "node" });
      const entry: DataCacheEntry = {
        key: makeKey(),
        value: { hello: "world" },
        ttl: 3600,
        tags: ["tag-a"],
        createdAt: Date.now(),
      };

      await store.set(key, entry);
      const retrieved = await store.get(key);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.value).toEqual({ hello: "world" });
      expect(retrieved?.tags).toEqual(["tag-a"]);
    });
  });

  it("DataFilesystemCacheStore deleteByTag removes all entries with that tag", async () => {
    await withTempDir("data-cache-tag-", async (dir) => {
      const store = new DataFilesystemCacheStore(dir);
      const key1 = "key-1";
      const key2 = "key-2";
      const now = Date.now();

      await store.set(key1, { key: makeKey(), value: "v1", tags: ["my-tag"], createdAt: now });
      await store.set(key2, { key: makeKey(), value: "v2", tags: ["other-tag"], createdAt: now });

      await store.deleteByTag("my-tag");

      expect(await store.get(key1)).toBeNull();
      expect(await store.get(key2)).not.toBeNull();
    });
  });

  it("DataFilesystemCacheStore get returns null for a missing key", async () => {
    await withTempDir("data-cache-miss-", async (dir) => {
      const store = new DataFilesystemCacheStore(dir);
      const result = await store.get("nonexistent-key");
      expect(result).toBeNull();
    });
  });
});

describe("DataCache — L2 KV backend via DataCacheBackend interface (Requirements 10.3)", () => {
  it("DataCache uses a pluggable DataCacheBackend (KV-style mock for Edge runtime)", async () => {
    // Simulate an Edge KV backend via the DataCacheBackend interface
    const kvStore = new Map<string, DataCacheEntry>();
    const mockBackend: DataCacheBackend = {
      get: vi.fn(async (key) => kvStore.get(key) ?? null),
      set: vi.fn(async (key, entry) => { kvStore.set(key, entry); }),
      delete: vi.fn(async (key) => { kvStore.delete(key); }),
      deleteByTag: vi.fn(async (tag) => {
        for (const [k, v] of kvStore.entries()) {
          if (v.tags.includes(tag)) kvStore.delete(k);
        }
      }),
    };

    const cache = new DataCache(mockBackend);
    const key = makeKey({ runtimeTarget: "edge" });

    await cache.set(key, { data: 42 }, { tags: ["edge-tag"] });
    expect(mockBackend.set).toHaveBeenCalled();

    // Clear L1 by creating a new cache instance with same backend
    const cache2 = new DataCache(mockBackend);
    const result = await cache2.get(key);
    expect(result).not.toBeNull();
    expect(result?.value).toEqual({ data: 42 });
    expect(mockBackend.get).toHaveBeenCalled();
  });
});

describe("DataCache — L2 read failure treated as cache miss (Requirements 10.7)", () => {
  it("L2 read failure is treated as cache miss and logs a warning", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const failingBackend: DataCacheBackend = {
      get: vi.fn(async () => { throw new Error("L2 unavailable"); }),
      set: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
      deleteByTag: vi.fn(async () => {}),
    };

    const cache = new DataCache(failingBackend);
    const key = makeKey();

    const result = await cache.get(key);

    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("[DataCache] L2 read failed"));

    warnSpy.mockRestore();
  });
});

describe("DataCache — revalidate: false bypasses L2 (Requirements 10.7)", () => {
  it("revalidate: false bypasses L2 on write", async () => {
    const mockBackend: DataCacheBackend = {
      get: vi.fn(async () => null),
      set: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
      deleteByTag: vi.fn(async () => {}),
    };

    const cache = new DataCache(mockBackend);
    const key = makeKey();

    await cache.set(key, "value", { revalidate: false });

    expect(mockBackend.set).not.toHaveBeenCalled();
  });

  it("revalidate: false bypasses L2 on read", async () => {
    const mockBackend: DataCacheBackend = {
      get: vi.fn(async () => null),
      set: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
      deleteByTag: vi.fn(async () => {}),
    };

    const cache = new DataCache(mockBackend);
    const key = makeKey();

    // Nothing in L1, revalidate: false should skip L2
    const result = await cache.get(key, false);

    expect(result).toBeNull();
    expect(mockBackend.get).not.toHaveBeenCalled();
  });
});
