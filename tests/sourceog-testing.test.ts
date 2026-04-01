import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { DeploymentManifest } from "@sourceog/runtime";
import { cloudflareAdapter } from "../packages/adapter-cloudflare/src/index";
import { nodeAdapter } from "../packages/adapter-node/src/index";
import { vercelEdgeAdapter } from "../packages/adapter-vercel-edge/src/index";
import { vercelNodeAdapter } from "../packages/adapter-vercel-node/src/index";
import {
  adapterParityHarness,
  createTestInstance,
  runFixture
} from "@sourceog/testing";

let tempDir: string | undefined;

async function writeFile(target: string, contents: string): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, contents, "utf8");
}

afterEach(async () => {
  if (tempDir) {
    await fs.rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe("@sourceog/testing", () => {
  it("creates an in-process test instance and serves a fixture app", async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sourceog-testing-"));
    await writeFile(
      path.join(tempDir, "sourceog.config.ts"),
      "export default { appDir: 'app', distDir: '.sourceog' };"
    );
    await writeFile(
      path.join(tempDir, "app", "api", "hello", "route.ts"),
      "export async function GET() { return 'Testing Works'; }"
    );
    await writeFile(
      path.join(tempDir, "fixtures", "home.json"),
      JSON.stringify({ pathname: "/api/hello" }, null, 2)
    );

    const instance = await createTestInstance({ cwd: tempDir, mode: "production" });
    const response = await instance.fetch("/api/hello");
    const html = await response.text();
    const fixture = await runFixture(instance, "home");

    expect(response.status).toBe(200);
    expect(html).toContain("Testing Works");
    expect(fixture.response.status).toBe(200);
    expect(fixture.response.body).toContain("Testing Works");

    await instance.close();
  });

  it("reports adapter parity results through the harness", async () => {
    const manifest: DeploymentManifest = {
      version: "2027.1",
      buildId: "test-build",
      generatedAt: new Date().toISOString(),
      stability: "stable",
      routes: [
        {
          routeId: "page:/",
          pathname: "/",
          kind: "page",
          runtime: "node",
          prerendered: false,
          edgeCompatible: true
        }
      ],
      manifests: {
        routeManifest: "route-manifest.json",
        routeGraphManifest: "route-graph-manifest.json",
        renderManifest: "render-manifest.json",
        bundleManifest: "bundle-manifest.json",
        routeOwnershipManifest: "route-ownership-manifest.json",
        assetManifest: "asset-manifest.json",
        adapterManifest: "adapter-manifest.json",
        diagnosticsManifest: "diagnostics-manifest.json",
        prerenderManifest: "prerender-manifest.json",
        cacheManifest: "cache-manifest.json",
        automationManifest: "automation-manifest.json",
        clientManifest: "client-manifest.json",
        clientReferenceManifest: "client-reference-manifest.json",
        clientBoundaryManifest: "client-boundary-manifest.json",
        rscReferenceManifest: "rsc-reference-manifest.json",
        serverReferenceManifest: "server-reference-manifest.json",
        actionManifest: "action-manifest.json"
      }
    };

    const result = await adapterParityHarness({
      manifest,
      adapters: [nodeAdapter, cloudflareAdapter, vercelNodeAdapter, vercelEdgeAdapter],
      fixtures: [
        {
          name: "root",
          request: { pathname: "/", method: "GET" }
        }
      ]
    });

    expect(result.passed).toBe(true);
    expect(result.mismatches).toEqual([]);
  });
});
