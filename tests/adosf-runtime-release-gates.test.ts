import { describe, expect, it } from "vitest";
import { invalidateResource, setRevalidationHandler, ClientRuntime } from "@sourceog/runtime";
import { verifyAdosfReleaseGates } from "@sourceog/compiler";

describe("ADOSF runtime and release gates", () => {
  it("falls back from invalidateResource route ids to path invalidation", async () => {
    const invalidatedPaths: string[] = [];
    setRevalidationHandler({
      async revalidatePath(pathname) {
        invalidatedPaths.push(pathname);
      },
      async revalidateTag() {
        // no-op
      }
    });

    await invalidateResource("route:/about");
    expect(invalidatedPaths).toEqual(["/about"]);
  });

  it("client runtime handles route invalidation without DOM replacement helpers", async () => {
    let refreshed = 0;
    const runtime = new ClientRuntime({
      flightApplier: {
        async apply() {
          // no-op
        }
      },
      refreshRoute: async () => {
        refreshed += 1;
      }
    });

    runtime.graph.seedFromManifest({
      version: "adosf-x/1",
      generatedAt: new Date().toISOString(),
      nodes: [],
      edges: [{ from: "route:/about", to: "data:posts" }]
    });

    await runtime.onInvalidation("data:posts");
    expect(refreshed).toBe(1);
  });

  it("passes ADOSF release gates for the current workspace", async () => {
    const failures = await verifyAdosfReleaseGates(process.cwd());
    expect(failures).toEqual([]);
  });
});
