import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveConfig } from "@sourceog/platform";

describe("config", () => {
  it("loads sourceog.config.ts", async () => {
    process.env.SOURCEOG_SESSION_SECRET = "test-secret";
    const config = await resolveConfig(path.resolve(process.cwd(), "examples/app-basic"));
    expect(config.appDir).toBe("app");
    expect(config.i18n?.defaultLocale).toBe("en");
  });
});
