//build.test.ts
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { promises as fs } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { buildApplication } from "@sourceog/compiler";

let tempDir: string | undefined;

function shouldCopyFixture(sourcePath: string): boolean {
  const name = path.basename(sourcePath);
  return name !== "node_modules" && name !== ".sourceog" && name !== "out-test";
}

afterEach(async () => {
  if (tempDir) {
    await fs.rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe.sequential("build", () => {
  it("prerenders static routes", async () => {
    const fixtureRoot = path.resolve(process.cwd(), "examples/app-basic");
    const tempRoot = path.join(process.cwd(), ".tmp-tests");
    await fs.mkdir(tempRoot, { recursive: true });
    tempDir = await fs.mkdtemp(path.join(tempRoot, "sourceog-build-"));
    await fs.cp(fixtureRoot, tempDir, { recursive: true, filter: shouldCopyFixture });
    const cwd = tempDir;
    const result = await buildApplication(cwd);

    expect(result.prerendered.some((entry) => entry.pathname === "/")).toBe(true);
    expect(existsSync(path.join(cwd, ".sourceog", "static", "index.html"))).toBe(true);
    expect(existsSync(path.join(cwd, ".sourceog", "static", "about", "index.html"))).toBe(true);
    expect(existsSync(path.join(cwd, ".sourceog", "render-manifest.json"))).toBe(true);
    expect(existsSync(path.join(cwd, ".sourceog", "automation-manifest.json"))).toBe(true);
    expect(existsSync(path.join(cwd, ".sourceog", "deployment-manifest.json"))).toBe(true);
    expect(existsSync(path.join(cwd, ".sourceog", "client-manifest.json"))).toBe(true);
    expect(existsSync(path.join(cwd, ".sourceog", "client-reference-manifest.json"))).toBe(true);
    expect(existsSync(path.join(cwd, ".sourceog", "manifests", "client-reference-manifest.json"))).toBe(true);
    expect(existsSync(path.join(cwd, ".sourceog", "public", "_sourceog", "client-refs.json"))).toBe(true);
    expect(existsSync(path.join(cwd, ".sourceog", "client-boundary-manifest.json"))).toBe(true);
    expect(existsSync(path.join(cwd, ".sourceog", "rsc-reference-manifest.json"))).toBe(true);
    expect(existsSync(path.join(cwd, ".sourceog", "server-reference-manifest.json"))).toBe(true);
    expect(existsSync(path.join(cwd, ".sourceog", "action-manifest.json"))).toBe(true);
    expect(existsSync(path.join(cwd, ".sourceog", "cache-manifest.json"))).toBe(true);
    expect(existsSync(path.join(cwd, ".sourceog", "asset-manifest.json"))).toBe(true);
    expect(existsSync(path.join(cwd, ".sourceog", "route-ownership-manifest.json"))).toBe(true);
    expect(existsSync(path.join(cwd, ".sourceog", "route-graph-manifest.json"))).toBe(true);
    expect(existsSync(path.join(cwd, ".sourceog", "static", "__sourceog", "client.js"))).toBe(true);
    expect(existsSync(path.join(cwd, ".sourceog", "static", "__sourceog", "flight", "about", "index.json"))).toBe(true);
    const diagnostics = JSON.parse(readFileSync(path.join(cwd, ".sourceog", "diagnostics-manifest.json"), "utf8")) as { version: string; buildId: string };
    const prerenderManifest = JSON.parse(readFileSync(path.join(cwd, ".sourceog", "prerender-manifest.json"), "utf8")) as {
      version: string;
      buildId: string;
      prerendered: Array<{ routeId: string; tags: string[]; flightFilePath?: string }>;
    };
    const assetManifest = JSON.parse(readFileSync(path.join(cwd, ".sourceog", "asset-manifest.json"), "utf8")) as {
      version: string;
      buildId: string;
      runtimeAsset: string;
      assets: Array<{ kind: string; routeId?: string; filePath: string; chunkId?: string; routeIds?: string[] }>;
    };
    const routeOwnershipManifest = JSON.parse(readFileSync(path.join(cwd, ".sourceog", "route-ownership-manifest.json"), "utf8")) as {
      version: string;
      buildId: string;
      entries: Array<{
        routeId: string;
        chunkName: string;
        files: string[];
        metadataAsset?: string;
        ownershipHash?: string;
        routeChunkIds?: string[];
        sharedChunkIds?: string[];
      }>;
    };
    const clientManifest = JSON.parse(readFileSync(path.join(cwd, ".sourceog", "client-manifest.json"), "utf8")) as {
      version: string;
      buildId?: string;
      routeEntries: Array<{
        pathname: string;
        generatedEntryFile?: string;
        outputAsset: string;
        metadataAsset: string;
        browserEntryAsset?: string;
        ownershipHash: string;
        routeChunkIds: string[];
        sharedChunkIds: string[];
        preloadAssets: string[];
        hydrationMode: string;
        renderMode: "server-components" | "client-root";
        clientBoundaryFiles: string[];
        clientBoundaryModuleIds?: string[];
        clientReferenceRefs: Array<{ referenceId: string; moduleId: string; routeIds: string[]; runtimeTargets: Array<"node" | "edge"> }>;
        boundaryRefs?: Array<{ moduleId: string; selector: string; bootstrapStrategy: string; assetHref?: string; assetFilePath?: string }>;
        actionIds: string[];
      }>;
      sharedChunks: Array<{ chunkId: string; outputAsset: string; routeIds: string[] }>;
    };
    const bundleManifest = JSON.parse(readFileSync(path.join(cwd, ".sourceog", "bundle-manifest.json"), "utf8")) as {
      version: string;
      buildId: string;
      routes: Array<{
        routeId: string;
        routeChunkIds?: string[];
        sharedChunkIds?: string[];
        preloadAssets?: string[];
        browserEntryAsset?: string;
        hydrationMode?: string;
        renderMode?: "server-components" | "client-root";
        clientReferenceRefs?: Array<{ referenceId: string; moduleId: string; routeIds: string[]; runtimeTargets: Array<"node" | "edge"> }>;
      }>;
    };
    const routeGraphManifest = JSON.parse(readFileSync(path.join(cwd, ".sourceog", "route-graph-manifest.json"), "utf8")) as {
      version: string;
      buildId: string;
      nodes: Array<{ id: string; kind: string; routeId?: string; pathname: string; filePath?: string }>;
      routes: Array<{
        routeId: string;
        canonicalRouteId: string;
        resolvedRouteId: string;
        renderContextKey: string;
        materialized: boolean;
        slotName?: string;
        interceptTarget?: string;
        primaryRouteId?: string;
        segmentNodeIds: string[];
        fileNodeIds: string[];
      }>;
    };
    const clientReferenceManifest = JSON.parse(readFileSync(path.join(cwd, ".sourceog", "client-reference-manifest.json"), "utf8")) as {
      version: string;
      buildId: string;
      entries: Array<{
        filePath: string;
        routeIds: string[];
        directive: string;
        referenceId: string;
        moduleId: string;
        manifestKey: string;
        exportName: string;
        exports: string[];
        chunks: string[];
        runtimeTargets: Array<"node" | "edge">;
      }>;
      registry: Record<string, { id: string; chunks: string[]; name: string; filepath: string; exports: string[] }>;
    };
    const serverClientReferenceManifest = JSON.parse(readFileSync(path.join(cwd, ".sourceog", "manifests", "client-reference-manifest.json"), "utf8")) as typeof clientReferenceManifest;
    const browserClientReferenceManifest = JSON.parse(readFileSync(path.join(cwd, ".sourceog", "public", "_sourceog", "client-refs.json"), "utf8")) as typeof clientReferenceManifest;
    const clientBoundaryManifest = JSON.parse(readFileSync(path.join(cwd, ".sourceog", "client-boundary-manifest.json"), "utf8")) as {
      version: string;
      buildId: string;
      entries: Array<{ routeId: string; pathname: string; hydrationMode: string; boundaries: Array<{ moduleId: string; selector: string; bootstrapStrategy: string }> }>;
    };
    const rscReferenceManifest = JSON.parse(readFileSync(path.join(cwd, ".sourceog", "rsc-reference-manifest.json"), "utf8")) as {
      version: string;
      buildId: string;
      entries: Array<{
        routeId: string;
        pathname: string;
        renderMode: "server-components" | "client-root";
        runtimeTargets: Array<"node" | "edge">;
        supportedRuntimeTargets: Array<"node" | "edge">;
        unsupportedRuntimeReasons: Array<{ runtime: "node" | "edge"; code: string; message: string; filePath?: string }>;
        clientReferenceIds: string[];
        serverReferenceIds: string[];
        actionIds: string[];
      }>;
    };
    const serverReferenceManifest = JSON.parse(readFileSync(path.join(cwd, ".sourceog", "server-reference-manifest.json"), "utf8")) as {
      version: string;
      buildId: string;
      entries: Array<{ filePath: string; routeIds: string[]; directive: string; actionIds: string[]; referenceId: string; moduleId: string; runtimeTargets: Array<"node" | "edge"> }>;
    };
    const actionManifest = JSON.parse(readFileSync(path.join(cwd, ".sourceog", "action-manifest.json"), "utf8")) as {
      version: string;
      buildId: string;
      entries: Array<{ filePath: string; exportName: string; routeIds: string[] }>;
    };
    const cacheManifest = JSON.parse(readFileSync(path.join(cwd, ".sourceog", "cache-manifest.json"), "utf8")) as {
      version: string;
      buildId: string;
      entries: Array<{
        cacheKey: string;
        kind: "route" | "data";
        scope: "route" | "shared";
        routeId?: string;
        pathname?: string;
        tags: string[];
        linkedRouteIds: string[];
        linkedTagIds: string[];
        revalidate?: number;
        actionIds: string[];
      }>;
      invalidationLinks: Array<{
        actionId: string;
        routeIds: string[];
        pathnames: string[];
        targetCacheKeys: string[];
        tags: string[];
        refreshPolicy: string;
        revalidationPolicy: string;
      }>;
    };
    const deploymentManifest = JSON.parse(readFileSync(path.join(cwd, ".sourceog", "deployment-manifest.json"), "utf8")) as {
      buildId: string;
      routes: Array<{
        routeId: string;
        pathname: string;
        runtime: "node" | "edge" | "auto";
        edgeCompatible: boolean;
        supportedRuntimeTargets?: Array<"node" | "edge">;
        unsupportedRuntimeReasons?: Array<{ runtime: "node" | "edge"; code: string; message: string; filePath?: string }>;
      }>;
      manifests: { renderManifest: string; assetManifest: string; routeOwnershipManifest: string; routeGraphManifest: string; clientReferenceManifest: string; clientBoundaryManifest: string; rscReferenceManifest: string; serverReferenceManifest: string; actionManifest: string; cacheManifest: string };
    };
    const aboutHtml = readFileSync(path.join(cwd, ".sourceog", "static", "about", "index.html"), "utf8");
    expect(diagnostics.version).toBe("2027.1");
    expect(prerenderManifest.version).toBe("2027.1");
    expect(assetManifest.version).toBe("2027.1");
    expect(routeOwnershipManifest.version).toBe("2027.1");
    expect(diagnostics.buildId).toBe(result.buildId);
    expect(prerenderManifest.buildId).toBe(result.buildId);
    expect(assetManifest.buildId).toBe(result.buildId);
    expect(routeOwnershipManifest.buildId).toBe(result.buildId);
    expect(clientManifest.buildId).toBe(result.buildId);
    expect(deploymentManifest.buildId).toBe(result.buildId);
    expect(deploymentManifest.manifests.renderManifest.endsWith("render-manifest.json")).toBe(true);
    expect(deploymentManifest.manifests.assetManifest.endsWith("asset-manifest.json")).toBe(true);
    expect(deploymentManifest.manifests.routeOwnershipManifest.endsWith("route-ownership-manifest.json")).toBe(true);
    expect(deploymentManifest.manifests.routeGraphManifest.endsWith("route-graph-manifest.json")).toBe(true);
    expect(deploymentManifest.manifests.clientReferenceManifest.endsWith(`manifests${path.sep}client-reference-manifest.json`)).toBe(true);
    expect(deploymentManifest.manifests.clientBoundaryManifest.endsWith("client-boundary-manifest.json")).toBe(true);
    expect(deploymentManifest.manifests.rscReferenceManifest.endsWith("rsc-reference-manifest.json")).toBe(true);
    expect(deploymentManifest.manifests.serverReferenceManifest.endsWith("server-reference-manifest.json")).toBe(true);
    expect(deploymentManifest.manifests.actionManifest.endsWith("action-manifest.json")).toBe(true);
    expect(deploymentManifest.manifests.cacheManifest.endsWith("cache-manifest.json")).toBe(true);
    expect(prerenderManifest.prerendered.some((entry) => entry.routeId === "page:/blog/[slug]" && entry.tags.includes("blog"))).toBe(true);
    expect(clientManifest.version).toBe("2027.1");
    expect(clientManifest.routeEntries.some((entry) => entry.pathname === "/about")).toBe(true);
    expect(clientManifest.routeEntries.some((entry) => entry.pathname === "/playground")).toBe(true);
    expect(assetManifest.runtimeAsset).toBe("static/__sourceog/client.js");
    expect(assetManifest.assets.some((entry) => entry.kind === "prerendered" && entry.routeId === "page:/")).toBe(true);
    expect(assetManifest.assets.some((entry) => entry.kind === "client-entry" && entry.routeId === "page:/about" && entry.filePath.includes("static/__sourceog/routes/page__about.js"))).toBe(true);
    expect(assetManifest.assets.some((entry) => entry.kind === "client-browser-entry" && entry.routeId === "page:/playground" && entry.filePath.includes("static/__sourceog/entries/page__playground.js"))).toBe(true);
    expect(assetManifest.assets.some((entry) => entry.kind === "client-boundary-entry" && entry.routeId === "page:/about" && entry.filePath.includes("static/__sourceog/boundaries/page__about__boundary"))).toBe(true);
    expect(assetManifest.assets.some((entry) => entry.kind === "client-metadata" && entry.routeId === "page:/about" && entry.filePath.includes("static/__sourceog/metadata/page__about.json"))).toBe(true);
    expect(assetManifest.assets.some((entry) => entry.kind === "flight" && entry.routeId === "page:/about" && entry.filePath.includes("static/__sourceog/flight/about/index.json"))).toBe(true);
    expect(assetManifest.assets.some((entry) => entry.kind === "shared-chunk" && entry.chunkId && Array.isArray(entry.routeIds) && entry.routeIds.length >= 2)).toBe(true);
    expect(prerenderManifest.prerendered.some((entry) => entry.routeId === "page:/about" && entry.flightFilePath?.includes(path.join("static", "__sourceog", "flight", "about", "index.json")))).toBe(true);
    expect(routeOwnershipManifest.entries.some((entry) => entry.routeId === "page:/about" && entry.files.length > 0 && entry.ownershipHash && entry.metadataAsset && (entry.routeChunkIds?.length ?? 0) > 0)).toBe(true);
    expect(clientManifest.routeEntries.some((entry) => entry.pathname === "/about" && entry.hydrationMode === "mixed-route" && entry.renderMode === "server-components" && !entry.browserEntryAsset && entry.outputAsset.includes("static\\__sourceog\\routes\\page__about.js") && entry.metadataAsset.includes("static\\__sourceog\\metadata\\page__about.json") && entry.ownershipHash.length === 16 && entry.clientReferenceRefs.length > 0)).toBe(true);
    expect(clientManifest.routeEntries.some((entry) => entry.pathname === "/about" && entry.clientBoundaryModuleIds?.includes("./ClientCounter"))).toBe(true);
    expect(clientManifest.routeEntries.some((entry) => entry.pathname === "/about" && entry.boundaryRefs?.some((boundary) => boundary.moduleId === "./ClientCounter" && boundary.bootstrapStrategy === "hydrate-island" && boundary.assetHref?.includes("/__sourceog/boundaries/page__about__boundary")))).toBe(true);
    expect(clientManifest.routeEntries.some((entry) => entry.pathname === "/playground" && entry.hydrationMode === "full-route" && entry.renderMode === "client-root" && entry.browserEntryAsset?.includes("static\\__sourceog\\entries\\page__playground.js") && entry.ownershipHash.length === 16)).toBe(true);
    expect(clientBoundaryManifest.entries.some((entry) => entry.routeId === "page:/about" && entry.boundaries.some((boundary) => boundary.moduleId === "./ClientCounter" && boundary.selector.includes("data-sourceog-client-boundary")))).toBe(true);
    expect(clientBoundaryManifest.entries.some((entry) => entry.routeId === "page:/playground" && entry.boundaries.some((boundary) => boundary.bootstrapStrategy === "hydrate-root" && boundary.selector === "#sourceog-root"))).toBe(true);
    expect(clientManifest.sharedChunks.length).toBeGreaterThan(0);
    expect(bundleManifest.routes.some((entry) => entry.routeId === "page:/about" && entry.hydrationMode === "mixed-route" && entry.renderMode === "server-components" && !entry.browserEntryAsset && (entry.routeChunkIds?.length ?? 0) > 0 && Array.isArray(entry.sharedChunkIds) && (entry.preloadAssets?.length ?? 0) >= 4 && Array.isArray(entry.clientReferenceRefs))).toBe(true);
    expect(bundleManifest.routes.some((entry) => entry.routeId === "page:/playground" && entry.hydrationMode === "full-route" && entry.renderMode === "client-root" && entry.browserEntryAsset?.includes("page__playground.js"))).toBe(true);
    expect(routeGraphManifest.routes.some((entry) => entry.routeId === "page:/about" && entry.segmentNodeIds.length > 0 && entry.fileNodeIds.length > 0)).toBe(true);
    expect(routeGraphManifest.routes.some((entry) => entry.routeId === "page:/about" && entry.canonicalRouteId === "page:/about" && entry.resolvedRouteId === "page:/about" && entry.renderContextKey === "canonical:/about" && entry.materialized)).toBe(true);
    expect(routeGraphManifest.nodes.some((entry) => entry.kind === "page" && entry.routeId === "page:/about")).toBe(true);
    expect(serverClientReferenceManifest).toEqual(clientReferenceManifest);
    expect(browserClientReferenceManifest).toEqual(clientReferenceManifest);
    expect(Object.keys(clientReferenceManifest.registry).length).toBeGreaterThan(0);
    expect(clientReferenceManifest.entries.some((entry) => entry.filePath.includes("ClientCounter.tsx") && entry.routeIds.includes("page:/about") && entry.directive === "use-client" && entry.referenceId.length > 0 && entry.moduleId.length === 16 && entry.exportName === "default" && entry.exports.includes("default") && entry.chunks.some((chunk) => chunk.endsWith(".js")) && entry.runtimeTargets.includes("node"))).toBe(true);
    expect(clientReferenceManifest.entries.some((entry) => entry.filePath.includes(path.join("playground", "page.tsx")) && entry.routeIds.includes("page:/playground") && entry.directive === "use-client" && entry.referenceId.length > 0 && entry.chunks.some((chunk) => chunk.endsWith(".js")))).toBe(true);
    expect(Object.values(clientReferenceManifest.registry).every((entry) => entry.id.length === 16 && entry.chunks.length > 0)).toBe(true);
    expect(rscReferenceManifest.entries.some((entry) => entry.routeId === "page:/about" && entry.renderMode === "server-components" && entry.clientReferenceIds.length > 0 && entry.actionIds.length > 0 && entry.runtimeTargets.includes("edge") && !entry.supportedRuntimeTargets.includes("edge") && entry.unsupportedRuntimeReasons.some((reason) => reason.code === "SOURCEOG_EDGE_UNSUPPORTED_SERVER_ACTION_RUNTIME"))).toBe(true);
    expect(rscReferenceManifest.entries.some((entry) => entry.routeId === "page:/playground" && entry.renderMode === "client-root" && entry.clientReferenceIds.length > 0 && entry.supportedRuntimeTargets.includes("edge") && entry.unsupportedRuntimeReasons.length === 0)).toBe(true);
    expect(deploymentManifest.routes.some((entry) => entry.routeId === "page:/about" && entry.runtime === "node" && entry.edgeCompatible === false && entry.supportedRuntimeTargets?.includes("node") && !entry.supportedRuntimeTargets?.includes("edge") && entry.unsupportedRuntimeReasons?.some((reason) => reason.code === "SOURCEOG_EDGE_UNSUPPORTED_SERVER_ACTION_RUNTIME"))).toBe(true);
    expect(deploymentManifest.routes.some((entry) => entry.routeId === "page:/playground" && entry.runtime === "edge" && entry.edgeCompatible === true && entry.supportedRuntimeTargets?.includes("edge") && (entry.unsupportedRuntimeReasons?.length ?? 0) === 0)).toBe(true);
    expect(serverReferenceManifest.entries.some((entry) => entry.filePath.includes("actions.ts") && entry.routeIds.includes("page:/about") && entry.directive === "use-server" && entry.actionIds.length > 0 && entry.referenceId.length > 0 && entry.moduleId.length > 0)).toBe(true);
    expect(actionManifest.entries.some((entry) => entry.filePath.includes("actions.ts") && entry.exportName === "recordAboutVisit" && entry.routeIds.includes("page:/about"))).toBe(true);
    expect(cacheManifest.version).toBe("2027.1");
    expect(cacheManifest.buildId).toBe(result.buildId);
    expect(cacheManifest.entries.some((entry) => entry.cacheKey === "route:page:/about" && entry.kind === "route" && entry.scope === "route" && entry.pathname === "/about" && entry.linkedRouteIds.includes("/about"))).toBe(true);
    expect(cacheManifest.entries.some((entry) => entry.cacheKey === "data:page:/about" && entry.kind === "data" && entry.scope === "shared" && entry.routeId === "page:/about" && entry.actionIds.length > 0)).toBe(true);
    expect(cacheManifest.invalidationLinks.some((entry) => entry.actionId.length > 0 && entry.routeIds.includes("page:/about") && entry.pathnames.includes("/about") && entry.targetCacheKeys.includes("route:page:/about") && entry.targetCacheKeys.includes("data:page:/about") && entry.refreshPolicy === "refresh-current-route-on-revalidate")).toBe(true);
    expect(aboutHtml).toContain('/__sourceog/routes/page__about.js');
    expect(aboutHtml).toContain('/__sourceog/metadata/page__about.json');
    expect(aboutHtml).toContain('"hydrationMode":"mixed-route"');
    expect(aboutHtml).toContain('"renderMode":"server-components"');
    expect(aboutHtml).toContain('/__sourceog/flight/about/index.json');
    expect(aboutHtml).toContain('"boundaryRefs":[{"boundaryId":"./ClientCounter"');
    expect(aboutHtml).toContain('"clientReferenceRefs":[{"referenceId":');
    expect(aboutHtml).toContain('/__sourceog/boundaries/page__about__boundary_0_ClientCounter.js');
    expect(aboutHtml).toContain('data-sourceog-client-island');
    expect(aboutHtml).toContain('data-sourceog-client-boundary="./ClientCounter"');
    expect(aboutHtml).toContain('data-sourceog-client-module="./ClientCounter"');
    expect(aboutHtml).toContain('document.documentElement.dataset.sourceogRoute="page:/about"');
  }, 120_000);
});
