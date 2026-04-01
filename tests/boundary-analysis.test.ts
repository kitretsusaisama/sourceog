import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveConfig } from "@sourceog/platform";
import { scanRoutes } from "@sourceog/router";
import { analyzeModuleBoundaries } from "@sourceog/compiler";

const tempDirs: string[] = [];

async function makeTempApp(): Promise<string> {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "sourceog-boundary-"));
  tempDirs.push(cwd);
  await fs.mkdir(path.join(cwd, "app", "components"), { recursive: true });

  await fs.writeFile(path.join(cwd, "app", "layout.tsx"), [
    'import React from "react";',
    "export default function RootLayout({ children }: { children: React.ReactNode }) {",
    '  return <html><body>{children}</body></html>;',
    "}"
  ].join("\n"), "utf8");

  await fs.writeFile(path.join(cwd, "app", "page.tsx"), [
    'import React from "react";',
    'import ClientWidget from "./components/ClientWidget";',
    "export default function Page(): JSX.Element {",
    "  return <ClientWidget />;",
    "}"
  ].join("\n"), "utf8");

  await fs.writeFile(path.join(cwd, "app", "components", "ClientWidget.tsx"), [
    '"use client";',
    'import React from "react";',
    'import "node:fs";',
    'import { mutateSomething } from "./server-only";',
    "void mutateSomething;",
    "export default function ClientWidget(): JSX.Element {",
    '  return <div>client</div>;',
    "}"
  ].join("\n"), "utf8");

  await fs.writeFile(path.join(cwd, "app", "components", "server-only.ts"), [
    '"use server";',
    "export async function mutateSomething(): Promise<number> {",
    "  return 1;",
    "}"
  ].join("\n"), "utf8");

  return cwd;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("module boundary analysis", () => {
  it("emits client/server/action manifests and diagnostics for invalid client imports", async () => {
    const cwd = await makeTempApp();
    const config = await resolveConfig(cwd);
    const manifest = await scanRoutes(config);
    const analysis = await analyzeModuleBoundaries(manifest);
    const normalizedClientWidgetPath = path.join(cwd, "app", "components", "ClientWidget.tsx").replaceAll("\\", "/").toLowerCase();
    const registryKey = `${normalizedClientWidgetPath}#default`;

    expect(analysis.clientReferenceManifest.entries.some((entry) => entry.filePath.endsWith("ClientWidget.tsx") && entry.routeIds.includes("page:/"))).toBe(true);
    expect(analysis.clientReferenceManifest.entries.some((entry) => entry.manifestKey === registryKey && entry.exportName === "default" && entry.exports.includes("default"))).toBe(true);
    expect(analysis.clientReferenceManifest.registry[registryKey]).toBeDefined();
    expect(analysis.clientReferenceManifest.registry[registryKey]?.id).toMatch(/^[a-f0-9]{16}$/);
    expect(analysis.serverReferenceManifest.entries.some((entry) => entry.filePath.endsWith("server-only.ts"))).toBe(false);
    expect(analysis.actionManifest.entries.some((entry) => entry.filePath.endsWith("server-only.ts"))).toBe(false);
    expect(analysis.diagnostics.some((issue) => issue.code === "SOURCEOG_CLIENT_IMPORTS_NODE_BUILTIN")).toBe(true);
    expect(analysis.diagnostics.some((issue) => issue.code === "SOURCEOG_CLIENT_IMPORTS_SERVER_MODULE")).toBe(true);
  });

  it('reports "use client" files with no exports', async () => {
    const cwd = await makeTempApp();
    await fs.writeFile(path.join(cwd, "app", "components", "ClientWidget.tsx"), [
      '"use client";',
      'import React from "react";',
      "const hidden = 1;",
      "void hidden;"
    ].join("\n"), "utf8");

    const config = await resolveConfig(cwd);
    const manifest = await scanRoutes(config);
    const analysis = await analyzeModuleBoundaries(manifest);

    expect(analysis.diagnostics.some((issue) => issue.code === "SOURCEOG_USE_CLIENT_NO_EXPORTS")).toBe(true);
  });
});
