import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApplication } from "@sourceog/compiler";

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

describe("adapter capability gating", () => {
  it(
    "fails the build when the configured adapter does not support required features",
    async () => {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sourceog-adapter-"));

      await writeFile(
        path.join(tempDir, "sourceog.config.mjs"),
        `export default {
          appDir: "app",
          distDir: ".sourceog",
          experimental: { edge: true },
          adapter: {
            name: "test-node-only",
            checkCapabilities({ features }) {
              return {
                supported: features.filter((feature) => feature !== "edge-runtime"),
                unsupported: features.includes("edge-runtime") ? ["edge-runtime"] : [],
                warnings: []
              };
            }
          }
        };`
      );

      await writeFile(
        path.join(tempDir, "app", "api", "hello", "route.ts"),
        `
        export async function GET() {
          return new Response(JSON.stringify({ ok: true }), {
            headers: { "content-type": "application/json" }
          });
        }
        `
      );

      const buildPromise = buildApplication(tempDir);

      await expect(buildPromise).rejects.toMatchObject({
        code: "SOURCEOG_ADAPTER_CAPABILITY_MISSING"
      });

      await expect(buildPromise).rejects.toThrow(/edge-runtime/i);
    },
    15_000
  );
});