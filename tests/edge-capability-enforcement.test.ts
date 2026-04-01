/**
 * Unit tests for edge capability enforcement
 * Validates: Requirements 6.2, 6.3, 6.4
 */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  computeRouteRuntimeCapability,
  enforceEdgeCapability,
  NODE_ONLY_MODULES
} from "@sourceog/compiler";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sourceog-edge-unit-"));
  tempDirs.push(dir);
  return dir;
}

async function writeFile(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true }))
  );
});

describe("edge capability enforcement", () => {
  describe("EDGE_CAPABILITY_VIOLATION error details", () => {
    it("error includes routeId, importPath, importedBy, line, column, and suggestion", async () => {
      const dir = await makeTempDir();
      const routeFile = path.join(dir, "route.ts");
      await writeFile(routeFile, `import "node:fs";\nexport default function Page() { return null; }\n`);

      const capability = await computeRouteRuntimeCapability(routeFile, "page:/test", "edge");

      expect(capability.violations.length).toBeGreaterThan(0);
      const violation = capability.violations[0]!;
      expect(violation.importPath).toBe("node:fs");
      expect(violation.importedBy).toBe(routeFile);
      expect(violation.line).toBe(1);
      expect(violation.column).toBeGreaterThan(0);
      expect(violation.suggestion).toBeTruthy();
      expect(violation.type).toBe("node-only-import");

      let caughtError: unknown;
      try {
        enforceEdgeCapability(capability);
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeDefined();
      expect((caughtError as { code: string }).code).toBe("EDGE_CAPABILITY_VIOLATION");
      expect((caughtError as Error).message).toContain("page:/test");
      expect((caughtError as Error).message).toContain("node:fs");
      expect((caughtError as { details: { routeId: string } }).details.routeId).toBe("page:/test");
    });

    it("error message includes file, line, and column of the violation", async () => {
      const dir = await makeTempDir();
      const routeFile = path.join(dir, "route.ts");
      // Put the import on line 3 to verify line detection
      await writeFile(routeFile, `// comment\n// another\nimport "node:crypto";\nexport default function Page() { return null; }\n`);

      const capability = await computeRouteRuntimeCapability(routeFile, "page:/crypto-route", "edge");

      expect(capability.violations.length).toBeGreaterThan(0);
      const violation = capability.violations[0]!;
      expect(violation.importPath).toBe("node:crypto");
      expect(violation.line).toBe(3);
    });
  });

  describe("node-targeted route skips edge checks", () => {
    it("returns empty violations and supportsEdge: false for node runtime target", async () => {
      const dir = await makeTempDir();
      const routeFile = path.join(dir, "route.ts");
      // Even with node-only imports, node-targeted routes skip checks
      await writeFile(routeFile, `import "node:fs";\nexport default function Page() { return null; }\n`);

      const capability = await computeRouteRuntimeCapability(routeFile, "page:/node-route", "node");

      expect(capability.runtimeTarget).toBe("node");
      expect(capability.violations).toHaveLength(0);
      // supportsEdge is false for node routes (they don't support edge)
      expect(capability.supportsEdge).toBe(false);
    });

    it("enforceEdgeCapability does not throw for node-targeted route with no violations", async () => {
      const capability = {
        routeId: "page:/node-route",
        runtimeTarget: "node" as const,
        supportsEdge: false,
        violations: []
      };

      expect(() => enforceEdgeCapability(capability)).not.toThrow();
    });
  });

  describe("transitive node-only import detection", () => {
    it("detects node-only imports through a chain of local imports", async () => {
      const dir = await makeTempDir();
      const routeFile = path.join(dir, "route.ts");
      const utilFile = path.join(dir, "util.ts");
      const deepFile = path.join(dir, "deep.ts");

      // deep.ts imports node:path
      await writeFile(deepFile, `import "node:path";\nexport const x = 1;\n`);
      // util.ts imports deep.ts
      await writeFile(utilFile, `import "./deep";\nexport const y = 2;\n`);
      // route.ts imports util.ts (no direct node-only import)
      await writeFile(routeFile, `import "./util";\nexport default function Page() { return null; }\n`);

      const capability = await computeRouteRuntimeCapability(routeFile, "page:/transitive", "edge");

      expect(capability.violations.length).toBeGreaterThan(0);
      expect(capability.supportsEdge).toBe(false);
      // The violation should point to deep.ts where the actual import is
      const violation = capability.violations.find((v) => v.importPath === "node:path");
      expect(violation).toBeDefined();
      expect(violation!.importedBy).toContain("deep.ts");
    });

    it("does not flag transitive imports that are not node-only", async () => {
      const dir = await makeTempDir();
      const routeFile = path.join(dir, "route.ts");
      const utilFile = path.join(dir, "util.ts");

      await writeFile(utilFile, `export const helper = () => "hello";\n`);
      await writeFile(routeFile, `import "./util";\nexport default function Page() { return null; }\n`);

      const capability = await computeRouteRuntimeCapability(routeFile, "page:/clean", "edge");

      expect(capability.violations).toHaveLength(0);
      expect(capability.supportsEdge).toBe(true);
    });
  });

  describe("NODE_ONLY_MODULES set", () => {
    it("contains all 14 node: prefixed modules", () => {
      const nodeModules = [
        "node:fs", "node:path", "node:child_process", "node:crypto",
        "node:net", "node:http", "node:https", "node:stream", "node:os",
        "node:buffer", "node:events", "node:util", "node:zlib", "node:net"
      ];
      for (const mod of nodeModules) {
        expect(NODE_ONLY_MODULES.has(mod)).toBe(true);
      }
    });

    it("contains bare-specifier equivalents", () => {
      const bareModules = [
        "fs", "path", "child_process", "crypto", "net",
        "http", "https", "stream", "os", "buffer", "events", "util", "zlib"
      ];
      for (const mod of bareModules) {
        expect(NODE_ONLY_MODULES.has(mod)).toBe(true);
      }
    });

    it("has exactly 26 entries (13 node: + 13 bare)", () => {
      // node:net appears once in node: prefixed, once in bare — 13 unique each
      expect(NODE_ONLY_MODULES.size).toBe(26);
    });
  });

  describe("clean edge route", () => {
    it("returns supportsEdge: true and empty violations for a route with no node imports", async () => {
      const dir = await makeTempDir();
      const routeFile = path.join(dir, "route.ts");
      await writeFile(routeFile, `export default function Page() { return null; }\n`);

      const capability = await computeRouteRuntimeCapability(routeFile, "page:/clean", "edge");

      expect(capability.supportsEdge).toBe(true);
      expect(capability.violations).toHaveLength(0);
      expect(capability.routeId).toBe("page:/clean");
      expect(capability.runtimeTarget).toBe("edge");
    });
  });
});
