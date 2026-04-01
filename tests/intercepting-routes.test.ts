import path from "node:path";
import { promises as fs } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { buildApplication } from "@sourceog/compiler";
import { createTestInstance } from "@sourceog/testing";

let tempDir: string | undefined;

async function writeFile(target: string, contents: string): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, contents, "utf8");
}

afterEach(async () => {
  if (tempDir) {
    await fs.rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe.sequential("intercepting routes", () => {
  it("resolves intercepting routes only when the intercept render context is requested", async () => {
    const tempRoot = path.join(process.cwd(), ".tmp-tests");
    await fs.mkdir(tempRoot, { recursive: true });
    tempDir = await fs.mkdtemp(path.join(tempRoot, "sourceog-intercept-"));

    await writeFile(
      path.join(tempDir, "app", "layout.tsx"),
      [
        'import React from "react";',
        "export default function RootLayout({ children }: { children: React.ReactNode }) {",
        '  return <html><body>{children}</body></html>;',
        "}"
      ].join("\n")
    );
    await writeFile(
      path.join(tempDir, "app", "feed", "layout.tsx"),
      [
        'import React from "react";',
        "export default function FeedLayout({ children }: { children: React.ReactNode }) {",
        '  return <main data-layout="feed">{children}</main>;',
        "}"
      ].join("\n")
    );
    await writeFile(
      path.join(tempDir, "app", "feed", "photo", "page.tsx"),
      'export default function Page() { return <div>canonical photo page</div>; }'
    );
    await writeFile(
      path.join(tempDir, "app", "feed", "(.)photo", "page.tsx"),
      'export default function Page() { return <div>intercepted photo modal</div>; }'
    );

    await buildApplication(tempDir);
    const instance = await createTestInstance({
      cwd: tempDir,
      mode: "production"
    });

    try {
      const canonicalResponse = await instance.fetch("/feed/photo");
      const interceptedResponse = await instance.fetch("/feed/photo", {
        headers: {
          "x-sourceog-intercept": "1"
        }
      });
      const interceptedFlightResponse = await instance.fetch("/__sourceog/flight?pathname=%2Ffeed%2Fphoto&intercept=1");

      expect(await canonicalResponse.text()).toContain("canonical photo page");
      expect(await interceptedResponse.text()).toContain("intercepted photo modal");
      const flightPayload = await interceptedFlightResponse.json() as {
        routeId: string;
        canonicalRouteId: string;
        resolvedRouteId: string;
        renderContextKey: string;
        renderContext: "canonical" | "intercepted";
        intercepted: boolean;
        pathname: string;
      };
      expect(flightPayload.pathname).toBe("/feed/photo");
      expect(flightPayload.routeId).toBe("page:/feed/photo#intercept:(.)");
      expect(flightPayload.canonicalRouteId).toBe("page:/feed/photo");
      expect(flightPayload.resolvedRouteId).toBe("page:/feed/photo#intercept:(.)");
      expect(flightPayload.renderContextKey).toBe("intercept:(.)");
      expect(flightPayload.renderContext).toBe("intercepted");
      expect(flightPayload.intercepted).toBe(true);
    } finally {
      await instance.close();
    }
  }, 60_000);
});
