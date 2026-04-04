import path from "node:path";
import { promises as fs } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { resolveConfig, type ResolvedSourceOGConfig } from "@sourceog/platform";
import {
  renderRouteToCanonicalResult,
  renderRouteToResponse
} from "@sourceog/renderer";
import { matchPageRoute, scanRoutes } from "@sourceog/router";
import type {
  SourceOGResponse,
  ClientReferenceRef,
  ClientBoundaryDescriptor
} from "@sourceog/runtime";

let tempDir: string | undefined;

function isResolvedSourceOGConfig(
  value: unknown
): value is ResolvedSourceOGConfig {
  return !!value &&
    typeof value === "object" &&
    "srcDir" in value &&
    "distDir" in value &&
    "basePath" in value;
}

function shouldCopyFixture(sourcePath: string): boolean {
  const name = path.basename(sourcePath);
  return name !== "node_modules" && name !== "out-test";
}

afterEach(async () => {
  if (tempDir) {
    await fs.rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

async function readResponseBody(response: SourceOGResponse): Promise<string> {
  if (!response.body) return "";
  if (typeof response.body === "string") return response.body;
  if (response.body instanceof Uint8Array) {
    return Buffer.from(response.body).toString("utf8");
  }

  const chunks: Uint8Array[] = [];
  for await (const chunk of response.body) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function setupFixture(): Promise<ResolvedSourceOGConfig> {
  process.env.SOURCEOG_SESSION_SECRET = "test-secret";

  const fixtureRoot = path.resolve(process.cwd(), "examples/app-basic");
  const tempRoot = path.join(process.cwd(), ".tmp-tests");

  await fs.mkdir(tempRoot, { recursive: true });
  tempDir = await fs.mkdtemp(path.join(tempRoot, "sourceog-rendering-"));
  await fs.cp(fixtureRoot, tempDir, {
    recursive: true,
    filter: shouldCopyFixture
  });

  const config = await resolveConfig(tempDir);

  if (!isResolvedSourceOGConfig(config)) {
    throw new Error("resolveConfig() did not return ResolvedSourceOGConfig");
  }

  return config;
}

function createRequestContext(url: string) {
  return {
    request: {
      url: new URL(url),
      method: "GET",
      headers: new Headers(),
      cookies: new Map(),
      requestId: "test",
      runtime: "node" as const,
      async bodyText() {
        return "";
      },
      async bodyJson<T>() {
        return {} as T;
      }
    }
  };
}

describe("renderer", () => {
  it("produces a canonical server-components render result for node routes", async () => {
    const config = await setupFixture();
    const manifest = await scanRoutes(config);
    const match = matchPageRoute(manifest, "/about");

    expect(match).not.toBeNull();

    const clientReferenceRefs: ClientReferenceRef[] = [];

    const boundaryRefs: ClientBoundaryDescriptor[] = [
      {
        boundaryId: "./ClientCounter",
        routeId: "page:/about",
        assetHref:
          "/__sourceog/boundaries/page__about__boundary_0_ClientCounter.js"
      }
    ];

    const result = await renderRouteToCanonicalResult(
      match?.route,
      {
        ...createRequestContext("http://sourceog.local/about"),
        params: match?.params,
        query: new URLSearchParams()
      },
      {
        pathname: "/about",
        routeIdentity: {
          canonicalRouteId: match?.canonicalRouteId,
          resolvedRouteId: match?.resolvedRouteId,
          renderContextKey: match?.renderContextKey,
          renderContext: match?.renderContext,
          intercepted: match?.intercepted,
          parallelRouteMap: match?.parallelRouteMap
        },
        clientAssets: {
          runtimeHref: "/__sourceog/client.js",
          routeAssetHref: "/__sourceog/routes/page__about.js",
          metadataHref: "/__sourceog/metadata/page__about.json",
          flightHref: "/__sourceog/flight?pathname=%2Fabout",
          renderMode: "server-components",
          hydrationMode: "mixed-route",
          clientReferenceRefs,
          boundaryRefs,
          actionEntries: []
        },
        parallelRoutes: match?.parallelRoutes
      }
    );

    expect(result.routeId).toBe("page:/about");
    expect(result.renderMode).toBe("server-components");
    expect(result.rscPayloadFormat).toBe("react-flight-text");
    expect(result.headHtml).toContain("<title>About SourceOG</title>");
    expect(result.bodyHtml).toContain("This route is prerenderable");
    expect(result.shellMode).toBe("document");
    expect(result.clientReferenceRefs).toHaveLength(0);
    expect(result.boundaryRefs).toHaveLength(1);
    expect(
      result.serverTree.children.some((child: any) => child.kind === "layout")
    ).toBe(true);
  }, 30_000);

  it("streams a page response with document markup", async () => {
    const config = await setupFixture();
    const manifest = await scanRoutes(config);
    const match = matchPageRoute(manifest, "/about");

    expect(match).not.toBeNull();

    const clientReferenceRefs: ClientReferenceRef[] = [];

    const boundaryRefs: ClientBoundaryDescriptor[] = [
      {
        boundaryId: "./ClientCounter",
        routeId: "page:/about",
        assetHref:
          "/__sourceog/boundaries/page__about__boundary_0_ClientCounter.js"
      }
    ];

    const response = await renderRouteToResponse(
      match?.route,
      {
        ...createRequestContext("http://sourceog.local/about"),
        params: match?.params,
        query: new URLSearchParams()
      },
      {
        routeIdentity: {
          canonicalRouteId: match?.canonicalRouteId,
          resolvedRouteId: match?.resolvedRouteId,
          renderContextKey: match?.renderContextKey,
          renderContext: match?.renderContext,
          intercepted: match?.intercepted,
          parallelRouteMap: match?.parallelRouteMap
        },
        clientAssets: {
          runtimeHref: "/__sourceog/client.js",
          routeAssetHref: "/__sourceog/routes/page__about.js",
          metadataHref: "/__sourceog/metadata/page__about.json",
          flightHref: "/__sourceog/flight?pathname=%2Fabout",
          sharedChunkHrefs: ["/__sourceog/chunks/shared_layout.js"],
          preloadHrefs: [
            "/__sourceog/client.js",
            "/__sourceog/routes/page__about.js",
            "/__sourceog/boundaries/page__about__boundary_0_ClientCounter.js",
            "/__sourceog/metadata/page__about.json",
            "/__sourceog/chunks/shared_layout.js",
            "/__sourceog/flight?pathname=%2Fabout"
          ],
          renderMode: "server-components",
          hydrationMode: "mixed-route",
          clientReferenceRefs,
          boundaryRefs,
          actionEntries: []
        }
      }
    );

    expect(response.headers.get("x-sourceog-render-mode")).toBe("flight-derived");
    expect(response.headers.get("x-sourceog-render-runtime")).toBe("server-components");
    expect(response.headers.get("x-sourceog-rsc-payload-format")).toBe("react-flight-text");

    const html = await readResponseBody(response);

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<title>About SourceOG</title>");
    expect(html).toContain("This route is prerenderable");
    expect(html).toContain('<div id="sourceog-root">');
    expect(html).toContain("/__sourceog/client.js");
    expect(html).toContain('rel="modulepreload" href="/__sourceog/routes/page__about.js"');
    expect(html).toContain(
      'rel="modulepreload" href="/__sourceog/boundaries/page__about__boundary_0_ClientCounter.js"'
    );
    expect(html).toContain(
      'rel="preload" as="fetch" href="/__sourceog/metadata/page__about.json"'
    );
    expect(html).toContain(
      'rel="preload" as="fetch" href="/__sourceog/flight?pathname=%2Fabout"'
    );
    expect(html).toContain('"hydrationMode":"mixed-route"');
    expect(html).toContain('"renderMode":"server-components"');
    expect(html).toContain('"rscPayloadFormat":"react-flight-text"');
    expect(html).toContain('"resolvedRouteId":"page:/about"');
    expect(html).toContain('"renderContext":"canonical"');
    expect(html).toContain('"intercepted":false');
    expect(html).toContain('"parallelRouteMap":{}');
    expect(html).toContain('"boundaryRefs":[{"boundaryId":"./ClientCounter"');
    expect(html).toContain('"clientReferenceRefs":[]');
    expect(html).toContain('"shellMode":"document"');
    expect(html).toContain("window.__SOURCEOG_INITIAL_RENDER_SNAPSHOT__=");
    expect(html).toContain(
      "window.__SOURCEOG_LAST_RENDER_SNAPSHOT__=window.__SOURCEOG_INITIAL_RENDER_SNAPSHOT__"
    );
    expect(html).toContain('"renderedSegments":[{"kind":"layout"');
    expect(html).toContain('"kind":"page","routeId":"page:/about"');
    expect(html).toContain('"serverTree":{"id":"render-tree:page:/about"');
    expect(html).toContain('"boundaryIds":["./ClientCounter"]');
    expect(html).toContain('"flightHref":"/__sourceog/flight?pathname=%2Fabout"');
    expect(html).toContain('document.documentElement.dataset.sourceogRoute="page:/about"');
  }, 30_000);
});