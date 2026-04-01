import { describe, it, expect } from "vitest";
import { ISRCoordinator } from "@sourceog/runtime";

describe("ISRCoordinator - acquireLock timeout logic", () => {
  it("acquires a lock when no lock is held", async () => {
    const coordinator = new ISRCoordinator();
    const lock = await coordinator.acquireLock("/home");
    expect(lock).not.toBeNull();
    expect(lock?.routeKey).toBe("/home");
    await coordinator.releaseLock(lock!);
  });

  it("returns null after timeout when lock is already held", async () => {
    // Use a very short timeout so the test completes quickly
    const coordinator = new ISRCoordinator({ lockTimeoutMs: 30 });
    const held = await coordinator.acquireLock("/blog");
    expect(held).not.toBeNull();

    // Second attempt should time out because the lock is still held
    const second = await coordinator.acquireLock("/blog");
    expect(second).toBeNull();

    await coordinator.releaseLock(held!);
  }, 5_000);

  it("acquires lock successfully after the previous lock is released", async () => {
    const coordinator = new ISRCoordinator();
    const first = await coordinator.acquireLock("/about");
    expect(first).not.toBeNull();
    await coordinator.releaseLock(first!);

    const second = await coordinator.acquireLock("/about");
    expect(second).not.toBeNull();
    await coordinator.releaseLock(second!);
  });

  it("respects a short timeout on a contended lock", async () => {
    const coordinator = new ISRCoordinator({ lockTimeoutMs: 10 });
    const held = await coordinator.acquireLock("/products");
    expect(held).not.toBeNull();

    const start = Date.now();
    const result = await coordinator.acquireLock("/products");
    const elapsed = Date.now() - start;

    expect(result).toBeNull();
    // Should have returned within a reasonable window (not hung forever)
    expect(elapsed).toBeLessThan(500);

    await coordinator.releaseLock(held!);
  }, 5_000);
});
