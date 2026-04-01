import path from "node:path";
import { promises as fs } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { buildApplication } from "@sourceog/compiler";
import { createTestInstance } from "@sourceog/testing";

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

describe.sequential("flight endpoint", () => {
  it("serves a route flight payload for live requests", async () => {
    const fixtureRoot = path.resolve(process.cwd(), "examples/app-basic");
    const tempRoot = path.join(process.cwd(), ".tmp-tests");
    await fs.mkdir(tempRoot, { recursive: true });
    tempDir = await fs.mkdtemp(path.join(tempRoot, "sourceog-flight-endpoint-"));
    await fs.cp(fixtureRoot, tempDir, { recursive: true, filter: shouldCopyFixture });
    const cwd = tempDir;
    await buildApplication(cwd);

    const instance = await createTestInstance({
      cwd,
      mode: "production"
    });

    try {
      const response = await instance.fetch("/__sourceog/flight?pathname=%2Fabout");
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("application/json");

      const payload = await response.json() as {
        version: string;
        routeId: string;
        pathname: string;
        canonicalRouteId: string;
        resolvedRouteId: string;
        renderContextKey: string;
        renderContext: "canonical" | "intercepted";
        intercepted: boolean;
        parallelRouteMap: Record<string, string>;
        headHtml: string;
        bodyHtml: string;
        shellHtmlStart: string;
        shellHtmlEnd: string;
        shellMode: "document" | "fragment";
        rscPayloadFormat: "none" | "react-flight-text";
        rscPayloadChunks: string[];
        renderedSegments: Array<{ kind: string; routeId: string; pathname: string; slotName?: string }>;
        serverTree: {
          id: string;
          kind: string;
          routeId: string;
          children: Array<{
            kind: string;
            routeId: string;
            boundaryIds?: string[];
            children?: Array<{ kind: string; routeId: string }>;
          }>;
        };
        renderMode: "server-components" | "client-root";
        hydrationMode: string;
        flightHref?: string;
        entryAssetHref?: string;
        clientReferenceRefs: Array<{ referenceId: string; moduleId: string; filePath?: string; routeIds: string[]; runtimeTargets: Array<"node" | "edge"> }>;
        flightManifestRefs: {
          sharedChunkHrefs: string[];
          boundaryAssetHrefs: string[];
          actionIds: string[];
        };
        boundaryRefs: Array<{ moduleId: string; bootstrapStrategy: string; assetHref?: string }>;
      };

      expect(payload.version).toBe("2027.1");
      expect(payload.routeId).toBe("page:/about");
      expect(payload.pathname).toBe("/about");
      expect(payload.canonicalRouteId).toBe("page:/about");
      expect(payload.resolvedRouteId).toBe("page:/about");
      expect(payload.renderContextKey).toBe("canonical:/about");
      expect(payload.renderContext).toBe("canonical");
      expect(payload.intercepted).toBe(false);
      expect(payload.parallelRouteMap).toEqual({});
      expect(payload.headHtml).toContain("<title>About SourceOG</title>");
      expect(payload.bodyHtml).toContain("This route is prerenderable");
      expect(payload.shellMode).toBe("document");
      expect(payload.shellHtmlStart).toBe("<html><body>");
      expect(payload.shellHtmlEnd).toBe("</body></html>");
      expect(payload.rscPayloadFormat).toBe("react-flight-text");
      expect(payload.rscPayloadChunks.length).toBeGreaterThan(0);
      expect(payload.rscPayloadChunks.join("")).not.toContain("useState is not a function");
      expect(payload.rscPayloadChunks.join("")).not.toContain("return value is not iterable");
      expect(payload.renderedSegments.some((segment) => segment.kind === "page" && segment.routeId === "page:/about" && segment.pathname === "/about")).toBe(true);
      expect(payload.serverTree.id).toBe("render-tree:page:/about");
      expect(payload.serverTree.kind).toBe("root");
      expect(payload.serverTree.routeId).toBe("page:/about");
      expect(payload.serverTree.children.some((child) => child.kind === "layout")).toBe(true);
      expect(JSON.stringify(payload.serverTree)).toContain("./ClientCounter");
      expect(payload.renderMode).toBe("server-components");
      expect(payload.hydrationMode).toBe("mixed-route");
      expect(payload.entryAssetHref).toBeUndefined();
      expect(payload.flightHref).toBe("/__sourceog/flight?pathname=%2Fabout");
      expect(payload.clientReferenceRefs.some((entry) => entry.filePath?.includes("ClientCounter.tsx") || entry.moduleId.includes("clientcounter"))).toBe(true);
      expect(payload.flightManifestRefs.boundaryAssetHrefs.some((href) => href.includes("/__sourceog/boundaries/page__about__boundary"))).toBe(true);
      expect(payload.flightManifestRefs.actionIds.length).toBeGreaterThan(0);
      expect(payload.boundaryRefs.some((boundary) => boundary.moduleId === "./ClientCounter" && boundary.bootstrapStrategy === "hydrate-island" && boundary.assetHref?.includes("/__sourceog/boundaries/page__about__boundary"))).toBe(true);
    } finally {
      await instance.close();
    }
  }, 75_000);

  it("serves raw Flight text when the client negotiates text/x-component", async () => {
    const fixtureRoot = path.resolve(process.cwd(), "examples/app-basic");
    const tempRoot = path.join(process.cwd(), ".tmp-tests");
    await fs.mkdir(tempRoot, { recursive: true });
    tempDir = await fs.mkdtemp(path.join(tempRoot, "sourceog-flight-stream-"));
    await fs.cp(fixtureRoot, tempDir, { recursive: true, filter: shouldCopyFixture });
    const cwd = tempDir;
    await buildApplication(cwd);

    const instance = await createTestInstance({
      cwd,
      mode: "production"
    });

    try {
      const streamResponse = await instance.fetch("/__sourceog/flight?pathname=%2Fabout", {
        headers: {
          Accept: "text/x-component"
        }
      });
      expect(streamResponse.status).toBe(200);
      expect(streamResponse.headers.get("content-type")).toBe("text/x-component");
      expect(streamResponse.headers.get("x-sourceog-route-id")).toBe("page:/about");
      expect(streamResponse.headers.get("x-sourceog-canonical-route-id")).toBe("page:/about");
      expect(streamResponse.headers.get("x-sourceog-resolved-route-id")).toBe("page:/about");
      expect(streamResponse.headers.get("x-sourceog-render-context-key")).toBe("canonical:/about");
      expect(streamResponse.headers.get("x-sourceog-render-context")).toBe("canonical");
      expect(streamResponse.headers.get("x-sourceog-rsc-payload-format")).toBe("react-flight-text");

      const transportText = await streamResponse.text();
      expect(transportText.length).toBeGreaterThan(0);
      expect(transportText.startsWith("{")).toBe(false);
      expect(transportText).toContain("About");
      expect(transportText).toContain("ClientIsland");
      expect(transportText).toMatch(/^\d+:/m);
    } finally {
      await instance.close();
    }
  }, 75_000);
});
