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

describe.sequential("production asset serving", () => {
  it("serves route chunk and metadata assets from the production server", async () => {
    const fixtureRoot = path.resolve(process.cwd(), "examples/app-basic");
    const tempRoot = path.join(process.cwd(), ".tmp-tests");
    await fs.mkdir(tempRoot, { recursive: true });
    tempDir = await fs.mkdtemp(path.join(tempRoot, "sourceog-server-assets-"));
    await fs.cp(fixtureRoot, tempDir, { recursive: true, filter: shouldCopyFixture });
    const cwd = tempDir;
    await buildApplication(cwd);

    const instance = await createTestInstance({
      cwd,
      mode: "production"
    });

    try {
      const routeAsset = await instance.fetch("/__sourceog/routes/page__about.js");
      const metadataAsset = await instance.fetch("/__sourceog/metadata/page__about.json");
      const flightAsset = await instance.fetch("/__sourceog/flight/about/index.json");
      const aboutBrowserEntryAsset = await instance.fetch("/__sourceog/entries/page__about.js");
      const aboutBoundaryAsset = await instance.fetch("/__sourceog/boundaries/page__about__boundary_0_ClientCounter.js");
      const browserEntryAsset = await instance.fetch("/__sourceog/entries/page__playground.js");

      expect(routeAsset.status).toBe(200);
      expect(routeAsset.headers.get("content-type")).toContain("application/javascript");
      expect(await routeAsset.text()).toContain('export const routeId = "page:/about"');

      expect(metadataAsset.status).toBe(200);
      expect(metadataAsset.headers.get("content-type")).toContain("application/json");
      expect(await metadataAsset.text()).toContain('"routeId": "page:/about"');

      expect(flightAsset.status).toBe(200);
      expect(flightAsset.headers.get("content-type")).toContain("application/json");
      expect(await flightAsset.text()).toContain('"pathname": "/about"');

      expect(aboutBrowserEntryAsset.status).toBe(404);

      expect(aboutBoundaryAsset.status).toBe(200);
      expect(aboutBoundaryAsset.headers.get("content-type")).toContain("application/javascript");
      expect(await aboutBoundaryAsset.text()).toContain("sourceogBootstrapBoundary");

      expect(browserEntryAsset.status).toBe(200);
      expect(browserEntryAsset.headers.get("content-type")).toContain("application/javascript");
      expect(await browserEntryAsset.text()).toContain("hydrateRoot");
    } finally {
      await instance.close();
    }
  }, 75_000);
});
