import path from "node:path";
import { readFileSync } from "node:fs";
import { promises as fs } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { buildApplication } from "@sourceog/compiler";
import { createTestInstance } from "@sourceog/testing";

let tempDir: string | undefined;

function shouldCopyFixture(sourcePath: string): boolean {
  const name = path.basename(sourcePath);
  return name !== "node_modules" && name !== ".sourceog" && name !== "out-test";
}

afterEach(async () => {
  if (tempDir) {
    await fs.rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe.sequential("server actions", () => {
  it("invokes route-scoped server actions through the production action endpoint", async () => {
    const fixtureRoot = path.resolve(process.cwd(), "examples/app-basic");
    const tempRoot = path.join(process.cwd(), ".tmp-tests");
    await fs.mkdir(tempRoot, { recursive: true });
    tempDir = await fs.mkdtemp(path.join(tempRoot, "sourceog-actions-"));
    await fs.cp(fixtureRoot, tempDir, { recursive: true, filter: shouldCopyFixture });

    await buildApplication(tempDir);
    const actionManifest = JSON.parse(
      readFileSync(path.join(tempDir, ".sourceog", "action-manifest.json"), "utf8")
    ) as {
      entries: Array<{
        actionId: string;
        exportName: string;
        refreshPolicy: string;
        revalidationPolicy: string;
      }>;
    };
    const cacheManifest = JSON.parse(
      readFileSync(path.join(tempDir, ".sourceog", "cache-manifest.json"), "utf8")
    ) as {
      invalidationLinks: Array<{
        actionId: string;
        routeIds: string[];
        pathnames: string[];
        targetCacheKeys: string[];
        tags: string[];
      }>;
    };
    const actionEntry = actionManifest.entries.find((entry) => entry.exportName === "recordAboutVisit");
    const actionId = actionEntry?.actionId;
    const invalidationLink = cacheManifest.invalidationLinks.find((entry) => entry.actionId === actionId);
    expect(actionId).toBeDefined();
    expect(invalidationLink).toBeDefined();
    expect(actionEntry?.refreshPolicy).toBe("refresh-current-route-on-revalidate");
    expect(actionEntry?.revalidationPolicy).toBe("track-runtime-revalidation");

    const instance = await createTestInstance({
      cwd: tempDir,
      mode: "production"
    });

    try {
      const response = await instance.fetch(`/__sourceog/actions/${encodeURIComponent(actionId!)}`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ args: [] })
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("application/json");
      expect(response.headers.get("x-sourceog-action-refresh")).toBe("current-route");
      expect(response.headers.get("x-sourceog-revalidated-paths")).toBe(JSON.stringify(invalidationLink?.pathnames ?? []));
      expect(response.headers.get("x-sourceog-revalidated-route-ids")).toBe(JSON.stringify(invalidationLink?.routeIds ?? []));
      expect(response.headers.get("x-sourceog-revalidated-cache-keys")).toBe(JSON.stringify(invalidationLink?.targetCacheKeys ?? []));
      expect(await response.text()).toContain('"invalidated": true');
    } finally {
      await instance.close();
    }
  }, 60_000);

  it("applies manifest-linked invalidation for actions without explicit revalidate calls", async () => {
    const fixtureRoot = path.resolve(process.cwd(), "examples/app-basic");
    const tempRoot = path.join(process.cwd(), ".tmp-tests");
    await fs.mkdir(tempRoot, { recursive: true });
    tempDir = await fs.mkdtemp(path.join(tempRoot, "sourceog-actions-policy-"));
    await fs.cp(fixtureRoot, tempDir, { recursive: true, filter: shouldCopyFixture });

    await buildApplication(tempDir);
    const actionManifest = JSON.parse(
      readFileSync(path.join(tempDir, ".sourceog", "action-manifest.json"), "utf8")
    ) as {
      entries: Array<{
        actionId: string;
        exportName: string;
        refreshPolicy: string;
        revalidationPolicy: string;
      }>;
    };
    const cacheManifest = JSON.parse(
      readFileSync(path.join(tempDir, ".sourceog", "cache-manifest.json"), "utf8")
    ) as {
      invalidationLinks: Array<{
        actionId: string;
        routeIds: string[];
        pathnames: string[];
        targetCacheKeys: string[];
        tags: string[];
      }>;
    };
    const actionEntry = actionManifest.entries.find((entry) => entry.exportName === "recordAboutVisitViaPolicy");
    const actionId = actionEntry?.actionId;
    const invalidationLink = cacheManifest.invalidationLinks.find((entry) => entry.actionId === actionId);
    expect(actionId).toBeDefined();
    expect(invalidationLink).toBeDefined();
    expect(actionEntry?.refreshPolicy).toBe("refresh-current-route-on-revalidate");
    expect(actionEntry?.revalidationPolicy).toBe("track-runtime-revalidation");

    const instance = await createTestInstance({
      cwd: tempDir,
      mode: "production"
    });

    try {
      const response = await instance.fetch(`/__sourceog/actions/${encodeURIComponent(actionId!)}`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ args: [] })
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("application/json");
      expect(response.headers.get("x-sourceog-action-refresh")).toBe("current-route");
      expect(response.headers.get("x-sourceog-revalidated-paths")).toBe(JSON.stringify(invalidationLink?.pathnames ?? []));
      expect(response.headers.get("x-sourceog-revalidated-tags")).toBe(
        (invalidationLink?.tags.length ?? 0) > 0
          ? JSON.stringify(invalidationLink?.tags ?? [])
          : null
      );
      expect(response.headers.get("x-sourceog-revalidated-route-ids")).toBe(JSON.stringify(invalidationLink?.routeIds ?? []));
      expect(response.headers.get("x-sourceog-revalidated-cache-keys")).toBe(JSON.stringify(invalidationLink?.targetCacheKeys ?? []));
      expect(await response.text()).toContain('"invalidated": true');

      const staleRouteResponse = await instance.fetch("/about");
      expect(staleRouteResponse.status).toBe(200);
      expect(staleRouteResponse.headers.get("x-sourceog-cache")).toBe("STALE");
    } finally {
      await instance.close();
    }
  }, 60_000);
});
