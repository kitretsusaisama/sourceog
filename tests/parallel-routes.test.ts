import path from "node:path";
import { promises as fs } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { buildApplication } from "@sourceog/compiler";
import { resolveConfig } from "@sourceog/platform";
import { renderRouteToResponse } from "@sourceog/renderer";
import { matchPageRoute, scanRoutes } from "@sourceog/router";
import type { SourceOGResponse } from "@sourceog/runtime";

let tempDir: string | undefined;

afterEach(async () => {
  if (tempDir) {
    await fs.rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

async function readResponseBody(response: SourceOGResponse): Promise<string> {
  if (!response.body) {
    return "";
  }

  if (typeof response.body === "string") {
    return response.body;
  }

  if (response.body instanceof Uint8Array) {
    return Buffer.from(response.body).toString("utf8");
  }

  const chunks: Uint8Array[] = [];
  for await (const chunk of response.body) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

describe("parallel routes", () => {
  it("attaches parallel slot pages to the matched primary route during render", async () => {
    const tempRoot = path.join(process.cwd(), ".tmp-tests");
    await fs.mkdir(tempRoot, { recursive: true });
    tempDir = await fs.mkdtemp(path.join(tempRoot, "sourceog-parallel-"));

    await fs.mkdir(path.join(tempDir, "app", "dashboard", "@team"), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, "sourceog.config.ts"),
      `export default { appDir: "app", distDir: ".sourceog" };`,
      "utf8"
    );
    await fs.writeFile(
      path.join(tempDir, "app", "dashboard", "layout.tsx"),
      `import React from "react";
       export default function DashboardLayout({ children, team }: { children: React.ReactNode; team?: React.ReactNode }) {
         return <section><main>{children}</main><aside>{team}</aside></section>;
       }`,
      "utf8"
    );
    await fs.writeFile(
      path.join(tempDir, "app", "dashboard", "page.tsx"),
      `export default function DashboardPage() { return <div>Overview Content</div>; }`,
      "utf8"
    );
    await fs.writeFile(
      path.join(tempDir, "app", "dashboard", "@team", "page.tsx"),
      `export default function TeamSlotPage() { return <div>Team Slot Content</div>; }`,
      "utf8"
    );

    await buildApplication(tempDir);

    const config = await resolveConfig(tempDir);
    const manifest = await scanRoutes(config);
    const match = matchPageRoute(manifest, "/dashboard");

    expect(match).not.toBeNull();
    expect(match?.route.isParallelSlot).toBe(false);
    expect(match?.parallelRoutes.team?.isParallelSlot).toBe(true);
    expect(match?.parallelRouteMap.team).toBe("page:/dashboard#slot:team");
    expect(match?.canonicalRouteId).toBe("page:/dashboard");
    expect(match?.resolvedRouteId).toBe("page:/dashboard");
    expect(match?.renderContextKey).toBe("canonical:/dashboard");
    expect(match?.intercepted).toBe(false);

    if (!match) {
      throw new Error("Failed to find route match for /dashboard");
    }

    const response = await renderRouteToResponse(match.route, {
      request: {
        url: new URL("http://sourceog.local/dashboard"),
        method: "GET",
        headers: new Headers(),
        cookies: new Map(),
        requestId: "parallel-test",
        runtime: "node",
        async bodyText() {
          return "";
        },
        async bodyJson<T>() {
          return {} as T;
        }
      },
      params: {},
      query: new URLSearchParams()
    }, {
      parallelRoutes: match.parallelRoutes
    });

    const html = await readResponseBody(response);
    expect(html).toContain("Overview Content");
    expect(html).toContain("Team Slot Content");
  }, 30_000);
});
