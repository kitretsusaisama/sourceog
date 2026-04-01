import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { ISRCoordinator } from "@sourceog/runtime";

async function withTempDir<T>(prefix: string, run: (tmpDir: string) => Promise<T>): Promise<T> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    return await run(tmpDir);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

describe("ISRCoordinator - Property 5: ISR lock is always released", () => {
  it("lock map is empty after successful revalidation path", async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 1, maxLength: 64 }), async (routeKey) => {
        const coordinator = new ISRCoordinator();
        let lock = null;
        try {
          lock = await coordinator.acquireLock(routeKey);
        } finally {
          if (lock !== null) {
            await coordinator.releaseLock(lock);
          }
        }
        return coordinator.getLockMap().size === 0;
      })
    );
  });

  it("lock map is empty after failed revalidation path (exception thrown)", async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 1, maxLength: 64 }), async (routeKey) => {
        const coordinator = new ISRCoordinator();
        let lock = null;
        try {
          lock = await coordinator.acquireLock(routeKey);
          throw new Error("revalidation failed");
        } catch {
          // swallow
        } finally {
          if (lock !== null) {
            await coordinator.releaseLock(lock);
          }
        }
        return coordinator.getLockMap().size === 0;
      })
    );
  });

  it("acquireLock returns null when routeKey is already locked", async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 1, maxLength: 64 }), async (routeKey) => {
        const coordinator = new ISRCoordinator({ lockTimeoutMs: 100 });
        const lock1 = await coordinator.acquireLock(routeKey);
        const lock2 = await coordinator.acquireLock(routeKey);
        if (lock1) {
          await coordinator.releaseLock(lock1);
        }
        return lock1 !== null && lock2 === null;
      }),
      { numRuns: 20 }
    );
  });
});

describe("ISRCoordinator - Property 6: Atomic swap has no partial visibility", () => {
  it("output path contains exactly newContent after atomicSwap completes", async () => {
    await fc.assert(
      fc.asyncProperty(fc.uint8Array({ minLength: 1, maxLength: 1024 }), async (contentBytes) => {
        return withTempDir("isr-test-", async (tmpDir) => {
          const coordinator = new ISRCoordinator({ outputDir: tmpDir });
          const routeKey = "test-route";
          const newContent = Buffer.from(contentBytes);

          await coordinator.atomicSwap(routeKey, newContent);

          const finalPath = path.join(tmpDir, "test-route.html");
          const written = await fs.readFile(finalPath);
          return written.equals(newContent);
        });
      }),
      { numRuns: 10 }
    );
  }, 45_000);

  it("no .tmp file remains after atomicSwap completes", async () => {
    await fc.assert(
      fc.asyncProperty(fc.uint8Array({ minLength: 1, maxLength: 512 }), async (contentBytes) => {
        return withTempDir("isr-test-", async (tmpDir) => {
          const coordinator = new ISRCoordinator({ outputDir: tmpDir });
          const routeKey = "no-tmp-route";
          const newContent = Buffer.from(contentBytes);

          await coordinator.atomicSwap(routeKey, newContent);

          const tmpPath = path.join(tmpDir, "no-tmp-route.html.tmp");
          try {
            await fs.access(tmpPath);
            return false;
          } catch {
            return true;
          }
        });
      }),
      { numRuns: 18 }
    );
  }, 30000);

  it("previous content is preserved in .prev after atomicSwap", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array({ minLength: 1, maxLength: 512 }),
        fc.uint8Array({ minLength: 1, maxLength: 512 }),
        async (firstBytes, secondBytes) => {
          return withTempDir("isr-test-", async (tmpDir) => {
            const coordinator = new ISRCoordinator({ outputDir: tmpDir });
            const routeKey = "prev-route";
            const first = Buffer.from(firstBytes);
            const second = Buffer.from(secondBytes);

            await coordinator.atomicSwap(routeKey, first);
            await coordinator.atomicSwap(routeKey, second);

            const prevPath = path.join(tmpDir, "prev-route.html.prev");
            const prevContent = await fs.readFile(prevPath);
            return prevContent.equals(first);
          });
        }
      ),
      { numRuns: 18 }
    );
  }, 30000);

  it("concurrent reads during swap never observe partial content", async () => {
    await fc.assert(
      fc.asyncProperty(fc.uint8Array({ minLength: 100, maxLength: 4096 }), async (contentBytes) => {
        return withTempDir("isr-test-", async (tmpDir) => {
          const coordinator = new ISRCoordinator({ outputDir: tmpDir });
          const routeKey = "concurrent-route";
          const newContent = Buffer.from(contentBytes);
          const finalPath = path.join(tmpDir, "concurrent-route.html");

          await coordinator.atomicSwap(routeKey, Buffer.from("initial"));

          const observations: Array<Buffer | null> = [];
          const readerPromises = Array.from({ length: 5 }, async () => {
            try {
              const data = await fs.readFile(finalPath);
              observations.push(data);
            } catch {
              observations.push(null);
            }
          });

          const swapPromise = coordinator.atomicSwap(routeKey, newContent);
          await Promise.all([swapPromise, ...readerPromises]);

          const finalData = await fs.readFile(finalPath);
          if (!finalData.equals(newContent)) {
            return false;
          }

          const oldContent = Buffer.from("initial");
          for (const obs of observations) {
            if (obs === null) {
              continue;
            }
            if (!obs.equals(oldContent) && !obs.equals(newContent)) {
              return false;
            }
          }

          return true;
        });
      }),
      { numRuns: 10 }
    );
  }, 30000);
});

describe("ISRCoordinator - unit tests", () => {
  it("acquireLock returns a Lock with the correct routeKey", async () => {
    const coordinator = new ISRCoordinator();
    const lock = await coordinator.acquireLock("/blog/hello");
    expect(lock).not.toBeNull();
    expect(lock?.routeKey).toBe("/blog/hello");
    if (lock) {
      await coordinator.releaseLock(lock);
    }
  });

  it("releaseLock removes the lock from the map", async () => {
    const coordinator = new ISRCoordinator();
    const lock = await coordinator.acquireLock("my-route");
    expect(coordinator.getLockMap().has("my-route")).toBe(true);
    await coordinator.releaseLock(lock!);
    expect(coordinator.getLockMap().has("my-route")).toBe(false);
  });

  it("isStale returns true when expiresAt is in the past", async () => {
    const coordinator = new ISRCoordinator();
    const result = await coordinator.isStale("route", { expiresAt: Date.now() - 1000 });
    expect(result).toBe(true);
  });

  it("isStale returns false when expiresAt is in the future", async () => {
    const coordinator = new ISRCoordinator();
    const result = await coordinator.isStale("route", { expiresAt: Date.now() + 60_000 });
    expect(result).toBe(false);
  });
});
