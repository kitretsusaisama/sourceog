import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveConfig } from "@sourceog/platform";
import { matchPageRoute, scanRoutes } from "@sourceog/router";

describe("router", () => {
  it("scans routes and matches dynamic params", async () => {
    process.env.SOURCEOG_SESSION_SECRET = "test-secret";
    const cwd = path.resolve(process.cwd(), "examples/app-basic");
    const config = await resolveConfig(cwd);
    const manifest = await scanRoutes(config);

    expect(manifest.pages.map((route) => route.pathname)).toContain("/blog/[slug]");
    expect(matchPageRoute(manifest, "/blog/hello-sourceog")?.params).toEqual({
      slug: "hello-sourceog"
    });
  }, 15000);
});
