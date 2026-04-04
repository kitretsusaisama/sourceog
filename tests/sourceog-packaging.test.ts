import path from "node:path";
import { promises as fs } from "node:fs";
import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";

function run(command: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
describe.sequential("sourceog packaging", () => {
  it("packs a dist-only sourceog tarball", async () => {
    const packageRoot = path.join(process.cwd(), "packages", "sourceog");
    const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

    // Build first — dist/ must exist before npm pack
    await run(npmCommand, ["run", "build"], packageRoot);

    const output = await run(npmCommand, ["pack", "--json"], packageRoot);
    const result = JSON.parse(output) as Array<{
      filename: string;
      files: Array<{ path: string }>;
    }>;

    expect(result).toHaveLength(1);
    const packResult = result[0] ?? { filename: "", files: [] };
    const packedPaths = packResult.files.map((entry) => entry.path);

    expect(packedPaths).toContain("dist/index.js");
    expect(packedPaths).toContain("dist/index.d.ts");
    expect(packedPaths).toContain("dist/bin.js");
    expect(packedPaths).toContain("dist/automation.js");
    expect(packedPaths).toContain("dist/cache.js");
    expect(packedPaths).toContain("dist/config.js");
    expect(packedPaths).toContain("dist/doctor.js");
    expect(packedPaths).toContain("dist/explain.js");
    expect(packedPaths).toContain("dist/graph.js");
    expect(packedPaths).toContain("dist/headers.js");
    expect(packedPaths).toContain("dist/governance.js");
    expect(packedPaths).toContain("dist/policies.js");
    expect(packedPaths).toContain("dist/inspect.js");
    expect(packedPaths).toContain("dist/navigation.js");
    expect(packedPaths).toContain("dist/rsc-worker-bootstrap.mjs");
    expect(packedPaths).toContain("dist/request.js");
    expect(packedPaths).toContain("dist/replay.js");
    expect(packedPaths).toContain("dist/runtime.js");
    expect(packedPaths).toContain("dist/server.js");
    expect(packedPaths).toContain("dist/testing.js");
    expect(packedPaths).toContain("dist/workers/worker-entry.js");
    expect(packedPaths).toContain("dist/actions.d.ts");
    expect(packedPaths).toContain("dist/automation.d.ts");
    expect(packedPaths).toContain("dist/cache.d.ts");
    expect(packedPaths).toContain("dist/config.d.ts");
    expect(packedPaths).toContain("dist/doctor.d.ts");
    expect(packedPaths).toContain("dist/explain.d.ts");
    expect(packedPaths).toContain("dist/graph.d.ts");
    expect(packedPaths).toContain("dist/headers.d.ts");
    expect(packedPaths).toContain("dist/governance.d.ts");
    expect(packedPaths).toContain("dist/inspect.d.ts");
    expect(packedPaths).toContain("dist/navigation.d.ts");
    expect(packedPaths).toContain("dist/policies.d.ts");
    expect(packedPaths).toContain("dist/request.d.ts");
    expect(packedPaths).toContain("dist/replay.d.ts");
    expect(packedPaths).toContain("dist/runtime.d.ts");
    expect(packedPaths).toContain("dist/server.d.ts");
    expect(packedPaths).toContain("dist/testing.d.ts");
    expect(packedPaths).toContain("dist/_types/sourceog-runtime/src/index.d.ts");
    expect(packedPaths).toContain("dist/_verify/sourceog-server/server.ts.txt");
    expect(packedPaths).toContain("dist/_verify/sourceog-renderer/render.ts.txt");
    expect(packedPaths).toContain("dist/_verify/sourceog-renderer/rsc.ts.txt");
    expect(packedPaths).toContain("dist/_verify/sourceog-runtime/client-island.tsx.txt");
    expect(packedPaths.some((filePath) => filePath.startsWith("src/"))).toBe(false);
    expect(packedPaths.some((filePath) => filePath.includes("archived/pre-adosf"))).toBe(false);

    await fs.rm(path.join(packageRoot, packResult.filename), { force: true });
  }, 120_000);
});
