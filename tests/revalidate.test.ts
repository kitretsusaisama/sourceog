import { describe, expect, it } from "vitest";
import { cacheTTL, cacheTag, prerenderPolicy, revalidatePath, revalidateTag, runWithRequestContext, setRevalidationHandler, withRevalidationTracking } from "@sourceog/runtime";

describe("revalidation helpers", () => {
  it("exposes cache metadata helpers", () => {
    expect(cacheTag("blog", "content")).toEqual(["blog", "content"]);
    expect(cacheTTL(120)).toBe(120);
    expect(prerenderPolicy("force-static")).toBe("force-static");
  });

  it("dispatches path and tag revalidation through the runtime handler", async () => {
    const calls: string[] = [];
    setRevalidationHandler({
      async revalidatePath(pathname) {
        calls.push(`path:${pathname}`);
      },
      async revalidateTag(tag) {
        calls.push(`tag:${tag}`);
      }
    });

    await revalidatePath("/blog/hello-sourceog");
    await revalidateTag("blog");

    expect(calls).toEqual(["path:/blog/hello-sourceog", "tag:blog"]);
  });

  it("tracks revalidation activity for action-driven refresh orchestration", async () => {
    setRevalidationHandler({
      async revalidatePath() {
        return undefined;
      },
      async revalidateTag() {
        return undefined;
      }
    });

    const cacheManifest = {
      version: "2027.1",
      buildId: "test",
      generatedAt: new Date().toISOString(),
      entries: [
        {
          cacheKey: "route:page:/about",
          kind: "route" as const,
          scope: "route" as const,
          source: "prerender" as const,
          routeId: "page:/about",
          pathname: "/about",
          tags: ["about"],
          linkedRouteIds: ["/about", "page:/about"],
          linkedTagIds: ["about"],
          revalidate: 60,
          actionIds: []
        },
        {
          cacheKey: "data:page:/about",
          kind: "data" as const,
          scope: "shared" as const,
          source: "runtime-fetch" as const,
          routeId: "page:/about",
          pathname: "/about",
          tags: ["about"],
          linkedRouteIds: ["/about", "page:/about"],
          linkedTagIds: ["about"],
          revalidate: 60,
          actionIds: []
        }
      ],
      invalidationLinks: []
    };

    const { result, summary } = await runWithRequestContext({
      request: {
        url: new URL("http://sourceog.test/about"),
        method: "GET",
        headers: new Headers(),
        cookies: new Map<string, string>(),
        requestId: "revalidate-test",
        runtime: "node",
        async bodyText() {
          return "";
        },
        async bodyJson<T>() {
          return {} as T;
        }
      },
      params: {},
      query: new URLSearchParams(),
      runtimeState: {
        cacheManifest
      }
    }, () => withRevalidationTracking(async () => {
      await revalidatePath("/about");
      await revalidateTag("about");
      return "ok";
    }));

    expect(result).toBe("ok");
    expect(summary).toEqual({
      paths: ["/about"],
      tags: ["about"],
      routeIds: ["page:/about"],
      cacheKeys: ["data:page:/about", "route:page:/about"],
      invalidated: true
    });
  });

  it("prefers the resolved invalidation handler when available", async () => {
    const resolvedCalls: Array<{
      cacheKeys: string[];
      routeIds: string[];
      pathnames: string[];
      tags: string[];
    }> = [];

    setRevalidationHandler({
      async revalidatePath() {
        throw new Error("legacy path handler should not run");
      },
      async revalidateTag() {
        throw new Error("legacy tag handler should not run");
      },
      async applyResolvedInvalidation(resolved) {
        resolvedCalls.push({
          cacheKeys: resolved.cacheKeys,
          routeIds: resolved.routeIds,
          pathnames: resolved.pathnames,
          tags: resolved.tags
        });
      }
    });

    const cacheManifest = {
      version: "2027.1",
      buildId: "test",
      generatedAt: new Date().toISOString(),
      entries: [
        {
          cacheKey: "route:page:/about",
          kind: "route" as const,
          scope: "route" as const,
          source: "prerender" as const,
          routeId: "page:/about",
          pathname: "/about",
          tags: ["about"],
          linkedRouteIds: ["/about", "page:/about"],
          linkedTagIds: ["about"],
          revalidate: 60,
          actionIds: []
        },
        {
          cacheKey: "data:page:/about",
          kind: "data" as const,
          scope: "shared" as const,
          source: "runtime-fetch" as const,
          routeId: "page:/about",
          pathname: "/about",
          tags: ["about"],
          linkedRouteIds: ["/about", "page:/about"],
          linkedTagIds: ["about"],
          revalidate: 60,
          actionIds: []
        }
      ],
      invalidationLinks: []
    };

    await runWithRequestContext({
      request: {
        url: new URL("http://sourceog.test/about"),
        method: "GET",
        headers: new Headers(),
        cookies: new Map<string, string>(),
        requestId: "resolved-handler-test",
        runtime: "node",
        async bodyText() {
          return "";
        },
        async bodyJson<T>() {
          return {} as T;
        }
      },
      params: {},
      query: new URLSearchParams(),
      runtimeState: {
        cacheManifest
      }
    }, async () => {
      await revalidatePath("/about");
    });

    expect(resolvedCalls).toEqual([
      {
        cacheKeys: ["data:page:/about", "route:page:/about"],
        routeIds: ["page:/about"],
        pathnames: ["/about"],
        tags: ["about"]
      }
    ]);
  });
});
