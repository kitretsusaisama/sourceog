import path from "node:path";
import { describe, expect, it } from "vitest";
import { createDevManifest, createDevDiagnostics, planIncrementalInvalidation } from "@sourceog/compiler";
import { DevDiagnosticsBus, getClientRuntimeScript } from "@sourceog/dev";
import { resolveConfig } from "@sourceog/platform";
import { scanRoutes } from "@sourceog/router";

describe("developer platform", () => {
  it("builds a dev manifest with route ownership", async () => {
    process.env.SOURCEOG_SESSION_SECRET = "test-secret";
    const cwd = path.resolve(process.cwd(), "examples/app-basic");
    const config = await resolveConfig(cwd);
    const manifest = await scanRoutes(config);

    const devManifest = createDevManifest(manifest, [
      path.join(cwd, "app", "about", "page.tsx")
    ]);

    const aboutRoute = devManifest.routes.find((route) => route.pathname === "/about");
    expect(aboutRoute).toBeDefined();
    expect(aboutRoute?.changedFiles.some((file) => file.endsWith(path.join("about", "page.tsx")))).toBe(true);
    expect(aboutRoute?.chunkName).toContain("page_");
    expect(aboutRoute?.routeChunkIds[0]).toContain("route:");
    expect(aboutRoute?.affected).toBe(true);
  });

  it("plans incremental invalidation from route ownership", async () => {
    process.env.SOURCEOG_SESSION_SECRET = "test-secret";
    const cwd = path.resolve(process.cwd(), "examples/app-basic");
    const config = await resolveConfig(cwd);
    const manifest = await scanRoutes(config);

    const plan = planIncrementalInvalidation(manifest, [
      path.join(cwd, "app", "about", "page.tsx")
    ], "change");

    expect(plan.fullReload).toBe(false);
    expect(plan.affectedRouteIds).toContain("page:/about");
    expect(plan.affectedChunkIds.some((chunkId) => chunkId.includes("page__about"))).toBe(true);
  });

  it("emits diagnostics through the dev bus", () => {
    const bus = new DevDiagnosticsBus();
    const messages: string[] = [];

    bus.subscribe((message) => {
      messages.push(message.type);
    });

    bus.setIssues(createDevDiagnostics({
      version: "2027.1",
      appRoot: "app",
      pages: [],
      handlers: [],
      layoutFiles: [],
      routeGraph: {
        nodes: [
          {
            id: "root",
            kind: "root",
            pathname: "/",
            visible: true
          }
        ],
        routes: []
      },
      generatedAt: new Date().toISOString(),
      diagnostics: {
        version: "2027.1",
        buildId: "dev",
        generatedAt: new Date().toISOString(),
        issues: []
      }
    }, "app/page.tsx"));

    bus.emitSync({
      changedFile: "app/page.tsx",
      changedAt: new Date().toISOString(),
      fullReload: true,
      affectedRouteIds: ["page:/"],
      affectedChunkIds: ["route:page__"],
      routeCount: 1
    });

    expect(messages).toEqual(["diagnostics", "sync"]);
  });

  it("uses Flight payload refresh for client navigation", () => {
    const runtimeScript = getClientRuntimeScript();

    expect(runtimeScript).toContain('import { createFromReadableStream } from "react-server-dom-webpack/client.browser";');
    expect(runtimeScript).toContain('import { createRoot } from "react-dom/client";');
    expect(runtimeScript).toContain("function createFlightHref(url, routeContext)");
    expect(runtimeScript).toContain("function getActiveRouteSnapshot()");
    expect(runtimeScript).toContain("function createHistorySnapshotState(snapshot)");
    expect(runtimeScript).toContain("function getOrCreateReactRoot(container)");
    expect(runtimeScript).toContain("async function loadModuleMap()");
    expect(runtimeScript).toContain("function installHydrationModeProxy(context)");
    expect(runtimeScript).toContain("async function applyCanonicalFlight(payload, streamedFlightBody = null)");
    expect(runtimeScript).toContain("async function hardFallbackHtmlReplace(payload, reason)");
    expect(runtimeScript).toContain("async function fetchFlightUpdate(url, routeSnapshot)");
    expect(runtimeScript).toContain('"Accept": "text/x-component"');
    expect(runtimeScript).toContain("async function applyStreamedFlightPayload(payload, streamResponse, url, replaceState)");
    expect(runtimeScript).toContain("const { streamResponse, snapshotResponse } = await fetchFlightUpdate(url, routeSnapshot);");
    expect(runtimeScript).toContain("await applyStreamedFlightPayload(payload, streamResponse, url, replaceState);");
    expect(runtimeScript).toContain("await hardFallbackHtmlReplace(payload, error);");
    expect(runtimeScript).toContain("[SOURCEOG-FALLBACK]");
    expect(runtimeScript).toContain('history[historyMethod](createHistorySnapshotState(payload), "", url);');
    expect(runtimeScript).toContain("sourceogBootstrapRoute");
    expect(runtimeScript).toContain("window.__SOURCEOG_REFRESH_ROUTE__ = refreshRoute;");
    expect(runtimeScript).toContain('window.addEventListener("popstate"');
    expect(runtimeScript).toContain('event.state?.__sourceog ?? getActiveRouteSnapshot()');
    expect(runtimeScript).toContain('history.replaceState(');
    expect(runtimeScript).toContain('console.warn("[sourceog] hydrationMode is deprecated. Use renderMode instead.");');
    expect(runtimeScript).not.toContain('hydrateRoot(');
    expect(runtimeScript).not.toContain('const html = await response.text();');
    expect(runtimeScript).not.toContain("applyOfficialFlightPayload");
    expect(runtimeScript).not.toContain("applyCanonicalRenderResult(payload)");
    expect(runtimeScript).not.toContain("replaceRouteBody(payload);");
  });
});
