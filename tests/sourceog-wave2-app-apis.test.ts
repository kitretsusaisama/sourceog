import { afterEach, describe, expect, it, vi } from "vitest";
import { runWithRequestContext } from "@sourceog/runtime";
import { createRequestContext } from "sourceog/request";
import {
  cacheLife,
  cacheMode,
  cacheScope,
  cacheTag,
  inspectRouteCache,
  prefetchRoute,
} from "sourceog";
import {
  confirmActionReceipt,
  createActionReceipt,
  createServerAction,
} from "sourceog/actions";
import { permanentRedirect, redirect } from "sourceog/navigation";

function createMockRequest(url: string) {
  return {
    url: new URL(url),
    method: "GET",
    headers: new Headers(),
    cookies: new Map<string, string>(),
    requestId: "req_wave2",
    runtime: "node" as const,
    raw: undefined,
    async bodyText() {
      return "";
    },
    async bodyJson<T>() {
      return {} as T;
    }
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as { window?: unknown }).window;
  delete (globalThis as { document?: unknown }).document;
});

describe("Wave 2 app-facing APIs", () => {
  it("creates typed server actions and action receipts", async () => {
    const action = createServerAction(async (payload: FormData) => ({
      ok: payload instanceof FormData
    }), { exportName: "updateProfile" });

    expect(action.exportName).toBe("updateProfile");
    expect(action.actionId).toBe("action::updateProfile");

    const receipt = await createActionReceipt({ actionId: action.actionId, userId: "user-1" });
    const confirmed = await confirmActionReceipt(receipt.token);

    expect(confirmed.consumed).toBe(true);
    await expect(confirmActionReceipt(receipt.token)).rejects.toThrow(/already been consumed/i);
  });

  it("tracks cache hints in the request context and can inspect route cache entries", async () => {
    const context = createRequestContext({
      request: createMockRequest("http://localhost/products/42"),
      runtimeState: {
        cacheManifest: {
          version: "2027.1",
          buildId: "wave2",
          generatedAt: new Date().toISOString(),
          entries: [{
            cacheKey: "route:/products/42",
            kind: "route",
            scope: "route",
            source: "prerender",
            routeId: "page:/products/[id]",
            pathname: "/products/42",
            tags: ["catalog", "product-42"],
            linkedRouteIds: ["page:/products/[id]"],
            linkedTagIds: ["catalog", "product-42"],
            revalidate: 3600,
            actionIds: []
          }],
          invalidationLinks: []
        }
      }
    });

    await runWithRequestContext(context, async () => {
      cacheTag("catalog", "product-42");
      expect(cacheLife("1h")).toBe(3600);
      expect(cacheMode("stale-while-revalidate")).toBe("stale-while-revalidate");
      expect(cacheScope("tenant", "acme")).toBe("tenant:acme");

      const inspection = await inspectRouteCache("/products/42");
      expect(inspection.hit).toBe(true);
      expect(inspection.tags).toEqual(["catalog", "product-42"]);
      expect(inspection.mode).toBe("stale-while-revalidate");
      expect(inspection.scope).toEqual({ tenant: "acme" });
    });
  });

  it("uses navigation helpers for prefetch and redirect semantics", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 204 }));
    const history = {
      pushState: vi.fn(),
      replaceState: vi.fn(),
      back: vi.fn()
    };

    (globalThis as { fetch?: typeof fetch }).fetch = fetchMock as typeof fetch;
    (globalThis as { window?: unknown }).window = {
      location: {
        origin: "http://localhost",
        pathname: "/current",
        search: ""
      },
      history,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      scrollTo: vi.fn()
    };
    (globalThis as { document?: unknown }).document = {};

    await prefetchRoute("/dashboard");
    await prefetchRoute("/dashboard");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    expect(() => redirect("/login")).toThrow(/Redirect to \/login/);
    expect(() => permanentRedirect("/canonical")).toThrow(/Redirect to \/canonical/);
  });
});
