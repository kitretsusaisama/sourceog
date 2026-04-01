import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveConfig } from "@sourceog/platform";
import { scanRoutes } from "@sourceog/router";
import { createRouteGraphManifest } from "@sourceog/compiler";

const tempDirs: string[] = [];

async function makeTempApp(): Promise<string> {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "sourceog-graph-"));
  tempDirs.push(cwd);
  await fs.mkdir(path.join(cwd, "app", "(marketing)"), { recursive: true });
  await fs.mkdir(path.join(cwd, "app", "dashboard", "@team"), { recursive: true });
  await fs.mkdir(path.join(cwd, "app", "feed", "(.)photo"), { recursive: true });

  await fs.writeFile(path.join(cwd, "app", "layout.tsx"), [
    'import React from "react";',
    "export default function RootLayout({ children }: { children: React.ReactNode }) {",
    '  return <html><body>{children}</body></html>;',
    "}"
  ].join("\n"), "utf8");

  await fs.writeFile(path.join(cwd, "app", "(marketing)", "page.tsx"), 'export default function Page(){ return <div>marketing</div>; }', "utf8");
  await fs.writeFile(path.join(cwd, "app", "dashboard", "@team", "page.tsx"), 'export default function Page(){ return <div>team</div>; }', "utf8");
  await fs.writeFile(path.join(cwd, "app", "feed", "(.)photo", "page.tsx"), 'export default function Page(){ return <div>photo</div>; }', "utf8");

  return cwd;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("route graph manifest", () => {
  it("captures route groups, parallel slots, and intercepting segments in the canonical graph", async () => {
    const cwd = await makeTempApp();
    const config = await resolveConfig(cwd);
    const manifest = await scanRoutes(config);
    const routeGraph = createRouteGraphManifest(manifest, "test-build");

    expect(routeGraph.routes.some((entry) => entry.routeId === "page:/" && entry.groupSegments.includes("marketing") && entry.canonicalRouteId === "page:/" && entry.materialized)).toBe(true);
    expect(routeGraph.routes.some((entry) => entry.routeId === "page:/dashboard#slot:team" && entry.slotSegments.includes("team") && entry.slotName === "team" && entry.canonicalRouteId === "page:/dashboard#slot:team" && entry.primaryRouteId === undefined && entry.renderContextKey === "slot:team" && !entry.materialized)).toBe(true);
    expect(routeGraph.routes.some((entry) => entry.routeId === "page:/feed/photo#intercept:(.)" && entry.interceptSegments.includes("(.)") && entry.interceptTarget === "(.)" && entry.renderContextKey === "intercept:(.)" && entry.canonicalRouteId === "page:/feed/photo#intercept:(.)" && entry.primaryRouteId === undefined && !entry.materialized)).toBe(true);
    expect(routeGraph.nodes.some((entry) => entry.kind === "group" && entry.rawSegment === "(marketing)")).toBe(true);
    expect(routeGraph.nodes.some((entry) => entry.kind === "parallel" && entry.slotName === "team")).toBe(true);
    expect(routeGraph.nodes.some((entry) => entry.kind === "intercepting" && entry.interceptTarget === "(.)")).toBe(true);
  });
});
