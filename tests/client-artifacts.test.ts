import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { promises as fs } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { analyzeModuleBoundaries, writeClientArtifacts } from "@sourceog/compiler";
import { resolveConfig } from "@sourceog/platform";
import { scanRoutes } from "@sourceog/router";

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

describe("client artifacts", () => {
  it("writes route-aware client entries and runtime assets", async () => {
    process.env.SOURCEOG_SESSION_SECRET = "test-secret";
    const fixtureRoot = path.resolve(process.cwd(), "examples/app-basic");
    const tempRoot = path.join(process.cwd(), ".tmp-tests");
    await fs.mkdir(tempRoot, { recursive: true });
    tempDir = await fs.mkdtemp(path.join(tempRoot, "sourceog-client-artifacts-"));
    await fs.cp(fixtureRoot, tempDir, { recursive: true, filter: shouldCopyFixture });
    const cwd = tempDir;
    const config = await resolveConfig(cwd);
    const manifest = await scanRoutes(config);
    const boundaryAnalysis = await analyzeModuleBoundaries(manifest);
    const artifacts = await writeClientArtifacts(config, manifest, {
      clientReferenceManifest: boundaryAnalysis.clientReferenceManifest,
      actionManifest: boundaryAnalysis.actionManifest
    });

    expect(existsSync(artifacts.runtimeAsset)).toBe(true);
    expect(artifacts.routeEntries.length).toBeGreaterThan(0);
    expect(Array.isArray(artifacts.sharedChunks)).toBe(true);

    const playgroundEntry = artifacts.routeEntries.find((entry) => entry.pathname === "/playground");
    expect(playgroundEntry).toBeDefined();
    expect(playgroundEntry?.hydrationMode).toBe("full-route");
    expect(playgroundEntry?.generatedEntryFile?.endsWith(".tsx")).toBe(true);
    expect(existsSync(playgroundEntry!.generatedEntryFile!)).toBe(true);
    expect(existsSync(playgroundEntry!.browserEntryAsset!)).toBe(true);
    expect(existsSync(playgroundEntry!.outputAsset)).toBe(true);
    expect(existsSync(playgroundEntry!.metadataAsset)).toBe(true);
    expect(playgroundEntry!.routeChunkIds.length).toBeGreaterThan(0);
    expect(playgroundEntry!.ownershipHash).toHaveLength(16);
    expect(playgroundEntry!.preloadAssets).toContain(artifacts.runtimeAsset);

    const entrySource = readFileSync(playgroundEntry!.generatedEntryFile!, "utf8");
    expect(entrySource).toContain('hydrateRoot');
    expect(entrySource).toContain("RouteComponent");

    const routeChunkSource = readFileSync(playgroundEntry!.outputAsset, "utf8");
    expect(routeChunkSource).toContain("ownershipHash");
    expect(routeChunkSource).toContain("sharedChunkIds");

    const aboutEntry = artifacts.routeEntries.find((entry) => entry.pathname === "/about");
    expect(aboutEntry?.hydrationMode).toBe("mixed-route");
    expect(aboutEntry?.generatedEntryFile).toBeUndefined();
    expect(aboutEntry?.browserEntryAsset).toBeUndefined();
    expect(aboutEntry?.hasClientBoundaries).toBe(true);
    expect(aboutEntry?.clientBoundaryModuleIds).toContain("./ClientCounter");
    expect(aboutEntry?.boundaryRefs.some((boundary) => boundary.moduleId === "./ClientCounter" && boundary.bootstrapStrategy === "hydrate-island" && Boolean(boundary.assetFilePath) && Boolean(boundary.assetHref))).toBe(true);
    expect(aboutEntry?.boundaryRefs.every((boundary) => !boundary.assetFilePath || existsSync(boundary.assetFilePath))).toBe(true);
    expect(aboutEntry?.preloadAssets.some((asset) => asset.includes(path.join("static", "__sourceog", "boundaries")))).toBe(true);
    expect(aboutEntry?.actionIds.length).toBeGreaterThan(0);
  }, 75_000);
});
