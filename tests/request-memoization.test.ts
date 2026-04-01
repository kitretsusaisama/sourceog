import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FilesystemCacheStore,
  getRequestMemoizationEntryCount,
  revalidatePath,
  revalidateTag,
  runWithRequestContext,
  setRevalidationHandler,
  sourceogFetch,
  type SourceOGRequestContext
} from "@sourceog/runtime";

const originalFetch = globalThis.fetch;

function createRequestContext(pathname = "/about"): SourceOGRequestContext {
  return {
    request: {
      url: new URL(`http://sourceog.local${pathname}`),
      method: "GET",
      headers: new Headers(),
      cookies: new Map(),
      requestId: "test-request",
      runtime: "node",
      async bodyText() {
        return "";
      },
      async bodyJson<T>() {
        return {} as T;
      }
    },
    params: {},
    query: new URLSearchParams()
  };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("request memoization", () => {
  it("dedupes matching GET fetches inside one request context", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        "content-type": "application/json"
      }
    }));
    globalThis.fetch = fetchMock as typeof globalThis.fetch;

    const { first, second, memoizedEntryCount } = await runWithRequestContext(createRequestContext(), async () => {
      const [firstResponse, secondResponse] = await Promise.all([
        sourceogFetch("https://example.com/api/posts", undefined, {
          cache: "force-cache",
          tags: ["posts"],
          revalidate: 60
        }),
        sourceogFetch("https://example.com/api/posts", undefined, {
          cache: "force-cache",
          tags: ["posts"],
          revalidate: 60
        })
      ]);

      return {
        first: firstResponse,
        second: secondResponse,
        memoizedEntryCount: getRequestMemoizationEntryCount()
      };
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await first.json()).toEqual({ ok: true });
    expect(await second.json()).toEqual({ ok: true });
    expect(memoizedEntryCount).toBe(1);
  });

  it("skips memoization for no-store requests", async () => {
    const fetchMock = vi.fn(async () => new Response("fresh", { status: 200 }));
    globalThis.fetch = fetchMock as typeof globalThis.fetch;

    await runWithRequestContext(createRequestContext("/cache-bypass"), async () => {
      await sourceogFetch("https://example.com/api/fresh", undefined, {
        cache: "no-store"
      });
      await sourceogFetch("https://example.com/api/fresh", undefined, {
        cache: "no-store"
      });
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("invalidates shared data cache entries by path and tag", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ call: fetchMock.mock.calls.length + 1 }), {
      status: 200,
      headers: {
        "content-type": "application/json"
      }
    }));
    globalThis.fetch = fetchMock as typeof globalThis.fetch;
    setRevalidationHandler({
      async revalidatePath() {
        return undefined;
      },
      async revalidateTag() {
        return undefined;
      }
    });

    await runWithRequestContext(createRequestContext("/posts"), async () => {
      await sourceogFetch("https://example.com/api/posts", undefined, {
        cache: "force-cache",
        revalidate: 60,
        tags: ["posts"]
      });
      await sourceogFetch("https://example.com/api/posts", undefined, {
        cache: "force-cache",
        revalidate: 60,
        tags: ["posts"]
      });
      await revalidateTag("posts");
      await sourceogFetch("https://example.com/api/posts", undefined, {
        cache: "force-cache",
        revalidate: 60,
        tags: ["posts"]
      });
      await revalidatePath("/posts");
      await sourceogFetch("https://example.com/api/posts", undefined, {
        cache: "force-cache",
        revalidate: 60,
        tags: ["posts"]
      });
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("persists shared data cache entries in the configured cache store and invalidates them by route", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "sourceog-data-cache-"));
    const store = new FilesystemCacheStore(tmpDir);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ persisted: true }), {
      status: 200,
      headers: {
        "content-type": "application/json"
      }
    }));
    globalThis.fetch = fetchMock as typeof globalThis.fetch;
    setRevalidationHandler({
      async revalidatePath() {
        return undefined;
      },
      async revalidateTag() {
        return undefined;
      }
    });

    try {
      await runWithRequestContext({
        ...createRequestContext("/persisted"),
        runtimeState: {
          buildId: "build-test",
          dataCacheStore: store
        }
      }, async () => {
        await sourceogFetch("https://example.com/api/persisted", undefined, {
          cache: "force-cache",
          revalidate: 60,
          tags: ["persisted"],
          routeScope: "/persisted"
        });
      });

      const persistedFilesBeforeInvalidation = await fs.readdir(tmpDir);
      expect(persistedFilesBeforeInvalidation.length).toBeGreaterThan(0);

      await runWithRequestContext({
        ...createRequestContext("/persisted"),
        runtimeState: {
          buildId: "build-test",
          dataCacheStore: store
        }
      }, async () => {
        await revalidatePath("/persisted");
      });

      const persistedFilesAfterInvalidation = await fs.readdir(tmpDir);
      expect(persistedFilesAfterInvalidation).toHaveLength(0);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
