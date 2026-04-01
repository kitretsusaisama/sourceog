import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { analyzeModuleBoundaries } from "@sourceog/compiler";
import { resolveConfig } from "@sourceog/platform";
import { scanRoutes } from "@sourceog/router";

const tempDirs: string[] = [];

async function makeTempApp(): Promise<string> {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "sourceog-client-refs-"));
  tempDirs.push(cwd);
  await fs.mkdir(path.join(cwd, "app", "components"), { recursive: true });
  await fs.writeFile(path.join(cwd, "sourceog.config.ts"), "export default { appDir: 'app', distDir: '.sourceog' };", "utf8");
  await fs.writeFile(path.join(cwd, "app", "layout.tsx"), [
    'import React from "react";',
    "export default function RootLayout({ children }: { children: React.ReactNode }) {",
    '  return <html><body>{children}</body></html>;',
    "}"
  ].join("\n"), "utf8");
  await fs.writeFile(path.join(cwd, "app", "page.tsx"), [
    'import React from "react";',
    'import ClientWidget, { NamedWidget } from "./components/ClientWidget";',
    "void NamedWidget;",
    "export default function Page(): JSX.Element {",
    "  return <ClientWidget />;",
    "}"
  ].join("\n"), "utf8");
  await fs.writeFile(path.join(cwd, "app", "components", "ClientWidget.tsx"), [
    '"use client";',
    'import React from "react";',
    "export function NamedWidget(): JSX.Element {",
    '  return <span>named</span>;',
    "}",
    "export default function ClientWidget(): JSX.Element {",
    '  return <div>client</div>;',
    "}"
  ].join("\n"), "utf8");
  return cwd;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("client reference manifest registry", () => {
  it("keeps stable module ids and manifest keys across repeated analysis", async () => {
    const cwd = await makeTempApp();
    const config = await resolveConfig(cwd);
    const manifest = await scanRoutes(config);
    const first = await analyzeModuleBoundaries(manifest);
    const second = await analyzeModuleBoundaries(manifest);

    expect(Object.keys(first.clientReferenceManifest.registry).sort()).toEqual(
      Object.keys(second.clientReferenceManifest.registry).sort()
    );

    for (const key of Object.keys(first.clientReferenceManifest.registry)) {
      expect(first.clientReferenceManifest.registry[key]?.id).toBe(second.clientReferenceManifest.registry[key]?.id);
    }

    expect(first.clientReferenceManifest.entries.some((entry) => entry.exportName === "default")).toBe(true);
    expect(first.clientReferenceManifest.entries.some((entry) => entry.exportName === "NamedWidget")).toBe(true);
  });
});
