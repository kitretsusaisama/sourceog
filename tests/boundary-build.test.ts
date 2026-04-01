import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApplication } from "@sourceog/compiler";

const tempDirs: string[] = [];

async function makeTempApp(): Promise<string> {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "sourceog-boundary-build-"));
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

describe("boundary build enforcement", () => {
  it("fails builds when module boundary analysis reports compiler errors", async () => {
    const cwd = await makeTempApp();

    await expect(buildApplication(cwd)).rejects.toMatchObject({
      code: "SOURCEOG_MODULE_BOUNDARY_VIOLATION"
    });
  }, 30_000);
});
