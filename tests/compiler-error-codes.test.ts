/**
 * Unit tests for compiler error codes (Task 1.8)
 *
 * Covers:
 *   - USE_CLIENT_NO_EXPORTS   — thrown by buildClientReferenceManifest (Req 1.4)
 *   - CLIENT_REF_NO_CHUNKS    — thrown by buildClientReferenceManifest (Req 1.5)
 *   - USE_CLIENT_NO_MANIFEST_ENTRY — thrown by ClientIsland in RSC worker context (Req 1.1, 8.2)
 */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import React from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildClientReferenceManifest,
  CompilerError as CompilerCompilerError
} from "@sourceog/compiler";
import type { AnalyzedModuleBoundary, ChunkGraph } from "@sourceog/compiler";
import {
  ClientIsland,
  CompilerError as RuntimeCompilerError
} from "@sourceog/runtime";
import type { ClientReferenceManifestRegistryEntry } from "@sourceog/runtime";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

async function makeTempDist(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sourceog-err-codes-"));
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
    clientExports: ["default"],
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

// ---------------------------------------------------------------------------
// USE_CLIENT_NO_EXPORTS
// ---------------------------------------------------------------------------

describe("USE_CLIENT_NO_EXPORTS", () => {
  it("is thrown when a 'use client' file has no exports (Req 1.4)", async () => {
    const distRoot = await makeTempDist();
    const module = makeModule({ clientExports: [] });
    const chunkGraph = makeChunkGraph({
      "/project/src/Button.tsx": ["/__sourceog/chunks/button.js"]
    });

    await expect(
      buildClientReferenceManifest([module], chunkGraph, distRoot)
    ).rejects.toMatchObject({
      code: "USE_CLIENT_NO_EXPORTS",
      name: "CompilerError"
    });
  });

  it("error message references the offending file path", async () => {
    const distRoot = await makeTempDist();
    const module = makeModule({ clientExports: [], filePath: "/project/src/Empty.tsx" });
    const chunkGraph = makeChunkGraph({
      "/project/src/Empty.tsx": ["/__sourceog/chunks/empty.js"]
    });

    await expect(
      buildClientReferenceManifest([module], chunkGraph, distRoot)
    ).rejects.toThrow("/project/src/Empty.tsx");
  });

  it("is a CompilerError instance", async () => {
    const distRoot = await makeTempDist();
    const module = makeModule({ clientExports: [] });
    const chunkGraph = makeChunkGraph({
      "/project/src/Button.tsx": ["/__sourceog/chunks/button.js"]
    });

    let caught: unknown;
    try {
      await buildClientReferenceManifest([module], chunkGraph, distRoot);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(CompilerCompilerError);
    expect((caught as CompilerCompilerError).code).toBe("USE_CLIENT_NO_EXPORTS");
  });

  it("does not throw for 'use server' modules with no client exports", async () => {
    const distRoot = await makeTempDist();
    const module = makeModule({ directive: "use-server", clientExports: [] });
    const chunkGraph = makeChunkGraph({});

    // Should resolve without error — non-client modules are skipped
    await expect(
      buildClientReferenceManifest([module], chunkGraph, distRoot)
    ).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// CLIENT_REF_NO_CHUNKS
// ---------------------------------------------------------------------------

describe("CLIENT_REF_NO_CHUNKS", () => {
  it("is thrown when a 'use client' file is absent from the chunk graph (Req 1.5)", async () => {
    const distRoot = await makeTempDist();
    const module = makeModule();
    const chunkGraph = makeChunkGraph({}); // no entry for Button.tsx

    await expect(
      buildClientReferenceManifest([module], chunkGraph, distRoot)
    ).rejects.toMatchObject({
      code: "CLIENT_REF_NO_CHUNKS",
      name: "CompilerError"
    });
  });

  it("error message references the offending file path", async () => {
    const distRoot = await makeTempDist();
    const module = makeModule({ filePath: "/project/src/Widget.tsx" });
    const chunkGraph = makeChunkGraph({}); // Widget.tsx not in graph

    await expect(
      buildClientReferenceManifest([module], chunkGraph, distRoot)
    ).rejects.toThrow("/project/src/Widget.tsx");
  });

  it("is a CompilerError instance", async () => {
    const distRoot = await makeTempDist();
    const module = makeModule();
    const chunkGraph = makeChunkGraph({});

    let caught: unknown;
    try {
      await buildClientReferenceManifest([module], chunkGraph, distRoot);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(CompilerCompilerError);
    expect((caught as CompilerCompilerError).code).toBe("CLIENT_REF_NO_CHUNKS");
  });

  it("does not throw when the file is present in the chunk graph", async () => {
    const distRoot = await makeTempDist();
    const module = makeModule();
    const chunkGraph = makeChunkGraph({
      "/project/src/Button.tsx": ["/__sourceog/chunks/button.js"]
    });

    await expect(
      buildClientReferenceManifest([module], chunkGraph, distRoot)
    ).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// USE_CLIENT_NO_MANIFEST_ENTRY
// ---------------------------------------------------------------------------

describe("USE_CLIENT_NO_MANIFEST_ENTRY", () => {
  let originalGlobal: typeof globalThis & {
    __SOURCEOG_RSC_WORKER__?: boolean;
    __SOURCEOG_CLIENT_REFERENCE_MANIFEST__?: Record<string, ClientReferenceManifestRegistryEntry>;
  };

  beforeEach(() => {
    originalGlobal = globalThis as typeof originalGlobal;
    // Simulate RSC worker context
    originalGlobal.__SOURCEOG_RSC_WORKER__ = true;
    originalGlobal.__SOURCEOG_CLIENT_REFERENCE_MANIFEST__ = {};
  });

  afterEach(() => {
    delete originalGlobal.__SOURCEOG_RSC_WORKER__;
    delete originalGlobal.__SOURCEOG_CLIENT_REFERENCE_MANIFEST__;
  });

  function DummyComponent(): React.JSX.Element {
    return React.createElement("div", null, "dummy");
  }
  DummyComponent.displayName = "DummyComponent";

  it("is thrown in RSC worker context when manifest entry is missing (Req 1.1, 8.2)", () => {
    // Empty manifest — no entry for DummyComponent
    originalGlobal.__SOURCEOG_CLIENT_REFERENCE_MANIFEST__ = {};

    expect(() =>
      ClientIsland({
        component: DummyComponent,
        moduleId: "./DummyComponent",
        exportName: "default"
      })
    ).toThrow(RuntimeCompilerError);
  });

  it("error has code USE_CLIENT_NO_MANIFEST_ENTRY", () => {
    originalGlobal.__SOURCEOG_CLIENT_REFERENCE_MANIFEST__ = {};

    let caught: unknown;
    try {
      ClientIsland({
        component: DummyComponent,
        moduleId: "./DummyComponent",
        exportName: "default"
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(RuntimeCompilerError);
    expect((caught as RuntimeCompilerError).code).toBe("USE_CLIENT_NO_MANIFEST_ENTRY");
  });

  it("error message includes the moduleId and exportName", () => {
    originalGlobal.__SOURCEOG_CLIENT_REFERENCE_MANIFEST__ = {};

    let caught: unknown;
    try {
      ClientIsland({
        component: DummyComponent,
        moduleId: "./MySpecialComponent",
        exportName: "MyExport"
      });
    } catch (err) {
      caught = err;
    }

    const message = (caught as Error).message;
    expect(message).toContain("MySpecialComponent");
    expect(message).toContain("MyExport");
  });

  it("does NOT throw when a matching manifest entry exists", () => {
    const entry: ClientReferenceManifestRegistryEntry = {
      id: "abcdef1234567890",
      chunks: ["/__sourceog/chunks/dummy.js"],
      name: "default",
      async: false,
      filepath: "/project/src/DummyComponent.tsx",
      exports: ["default"]
    };
    originalGlobal.__SOURCEOG_CLIENT_REFERENCE_MANIFEST__ = {
      "/project/src/dummycomponent#default": entry
    };

    // Should not throw — entry is found
    expect(() =>
      ClientIsland({
        component: DummyComponent,
        moduleId: "DummyComponent",
        exportName: "default"
      })
    ).not.toThrow();
  });

  it("does NOT throw USE_CLIENT_NO_MANIFEST_ENTRY outside RSC worker context (browser/SSR path)", () => {
    // Disable RSC worker context
    originalGlobal.__SOURCEOG_RSC_WORKER__ = false;
    originalGlobal.__SOURCEOG_CLIENT_REFERENCE_MANIFEST__ = {};

    // In browser/SSR context, ClientIsland takes the React render path.
    // Calling it outside a React render tree will throw a React hook error,
    // but crucially NOT a CompilerError with USE_CLIENT_NO_MANIFEST_ENTRY.
    let caught: unknown;
    try {
      ClientIsland({
        component: DummyComponent,
        moduleId: "./DummyComponent",
        exportName: "default"
      });
    } catch (err) {
      caught = err;
    }

    // If it throws, it must NOT be our CompilerError — it's a React hook error
    if (caught !== undefined) {
      expect(caught).not.toBeInstanceOf(RuntimeCompilerError);
      expect((caught as Error).message).not.toContain("USE_CLIENT_NO_MANIFEST_ENTRY");
    }
  });

  it("never renders a data-sourceog-client-placeholder element (INV-002)", () => {
    originalGlobal.__SOURCEOG_CLIENT_REFERENCE_MANIFEST__ = {};

    let caught: unknown;
    try {
      ClientIsland({
        component: DummyComponent,
        moduleId: "./DummyComponent",
        exportName: "default"
      });
    } catch (err) {
      caught = err;
    }

    // Must throw, not silently return a placeholder
    expect(caught).toBeDefined();
    expect((caught as RuntimeCompilerError).code).toBe("USE_CLIENT_NO_MANIFEST_ENTRY");
  });
});
