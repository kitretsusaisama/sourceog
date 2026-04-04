import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildClientReferenceManifest } from "@sourceog/compiler";
import type { AnalyzedModuleBoundary } from "@sourceog/compiler";

const tempDirs: string[] = [];

async function makeTempDist(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sourceog-crm-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

function makeModule(overrides: Partial<AnalyzedModuleBoundary> = {}): AnalyzedModuleBoundary {
  return {
    filePath: "/project/src/Button.tsx",
    directive: "use-client",
    importSpecifiers: [],
    resolvedLocalImports: [],
    nodeBuiltinImports: [],
    actionExports: [],
    clientExports: ["default", "ButtonVariant"],
    routeIds: ["page:/"],
    pathnames: ["/"],
    ...overrides
  };
}

function makeChunkGraph(map: Record<string, string[]> = {}): ChunkGraph {
  return {
    getChunksForModule(absolutePath: string): string[] {
      return map[absolutePath] ?? [];
    }
  };
}

describe("buildClientReferenceManifest", () => {
  it("builds one entry per export with correct shape", async () => {
    const distRoot = await makeTempDist();
    const module = makeModule();
    const chunkGraph = makeChunkGraph({
      "/project/src/Button.tsx": ["/__sourceog/chunks/button.js"]
    });

    const manifest = await buildClientReferenceManifest([module], chunkGraph, distRoot);

    const keys = Object.keys(manifest);
    expect(keys).toHaveLength(2);
    expect(keys).toContain("/project/src/button.tsx#default");
    expect(keys).toContain("/project/src/button.tsx#ButtonVariant");

    for (const entry of Object.values(manifest)) {
      expect(entry.id).toMatch(/^[0-9a-f]{16}$/);
      expect(entry.chunks).toEqual(["/__sourceog/chunks/button.js"]);
      expect(entry.filepath).toBe("/project/src/Button.tsx");
      expect(entry.exports).toEqual(["default", "ButtonVariant"]);
      expect(typeof entry.async).toBe("boolean");
    }
  });

  it("produces stable ids across two calls (Req 1.2)", async () => {
    const distRoot = await makeTempDist();
    const module = makeModule();
    const chunkGraph = makeChunkGraph({
      "/project/src/Button.tsx": ["/__sourceog/chunks/button.js"]
    });

    const first = await buildClientReferenceManifest([module], chunkGraph, distRoot);
    const second = await buildClientReferenceManifest([module], chunkGraph, distRoot);

    for (const key of Object.keys(first)) {
      expect(first[key]?.id).toBe(second[key]?.id);
    }
  });

  it("writes identical JSON to both server and browser paths (Req 1.3, INV-004)", async () => {
    const distRoot = await makeTempDist();
    const module = makeModule();
    const chunkGraph = makeChunkGraph({
      "/project/src/Button.tsx": ["/__sourceog/chunks/button.js"]
    });

    const manifest = await buildClientReferenceManifest([module], chunkGraph, distRoot);

    const serverPath = path.join(distRoot, "manifests", "client-reference-manifest.json");
    const browserPath = path.join(distRoot, "public", "_sourceog", "client-refs.json");

    const serverContent = JSON.parse(await fs.readFile(serverPath, "utf8"));
    const browserContent = JSON.parse(await fs.readFile(browserPath, "utf8"));

    expect(serverContent).toEqual(browserContent);
    expect(serverContent).toEqual(manifest);
  });

  it("throws USE_CLIENT_NO_EXPORTS for a 'use client' file with no exports (Req 1.4)", async () => {
    const distRoot = await makeTempDist();
    const module = makeModule({ clientExports: [] });
    const chunkGraph = makeChunkGraph({
      "/project/src/Button.tsx": ["/__sourceog/chunks/button.js"]
    });

    await expect(buildClientReferenceManifest([module], chunkGraph, distRoot)).rejects.toMatchObject({
      code: "USE_CLIENT_NO_EXPORTS"
    });
  });

  it("throws CLIENT_REF_NO_CHUNKS for a 'use client' file absent from chunk graph (Req 1.5)", async () => {
    const distRoot = await makeTempDist();
    const module = makeModule();
    const chunkGraph = makeChunkGraph({}); // no chunks for this file

    await expect(buildClientReferenceManifest([module], chunkGraph, distRoot)).rejects.toMatchObject({
      code: "CLIENT_REF_NO_CHUNKS"
    });
  });

  it("skips non-'use client' modules", async () => {
    const distRoot = await makeTempDist();
    const serverModule = makeModule({ directive: "use-server", clientExports: [] });
    const chunkGraph = makeChunkGraph({});

    const manifest = await buildClientReferenceManifest([serverModule], chunkGraph, distRoot);
    expect(Object.keys(manifest)).toHaveLength(0);
  });

  it("id is 16-character lowercase hex (Req 1.1)", async () => {
    const distRoot = await makeTempDist();
    const module = makeModule({ clientExports: ["default"] });
    const chunkGraph = makeChunkGraph({
      "/project/src/Button.tsx": ["/__sourceog/chunks/button.js"]
    });

    const manifest = await buildClientReferenceManifest([module], chunkGraph, distRoot);
    const values = Object.values(manifest);
    expect(values.length).toBeGreaterThan(0);
    const entry = values[0];

    expect(entry.id).toHaveLength(16);
    expect(entry.id).toMatch(/^[0-9a-f]{16}$/);
  });
});
