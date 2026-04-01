/**
 * Performance Regression: Data Cache Tag Invalidation
 * Validates: Requirement 23.2 — revalidateTag on a DataCache with 10,000 entries
 * completes in less than 1 millisecond (O(1) via TagIndex).
 */
import { describe, it, expect } from "vitest";
import { DataCache } from "@sourceog/runtime";
import type { DataCacheKey } from "@sourceog/runtime";

const ENTRY_COUNT = 10_000;
const TARGET_TAG = "invalidate-me";
const THRESHOLD_MS = 1;

function makeKey(i: number): DataCacheKey {
  return {
    url: `https://example.com/item/${i}`,
    method: "GET",
    bodyHash: "",
    tags: [TARGET_TAG],
    runtimeTarget: "node",
  };
}

describe("perf: DataCache tag invalidation", () => {
  it(`revalidateTag completes in < ${THRESHOLD_MS}ms for ${ENTRY_COUNT.toLocaleString()} entries`, async () => {
    const cache = new DataCache(undefined, { maxL1Size: ENTRY_COUNT + 1 });

    // Populate cache with ENTRY_COUNT entries all carrying TARGET_TAG
    for (let i = 0; i < ENTRY_COUNT; i++) {
      await cache.set(makeKey(i), { index: i }, { tags: [TARGET_TAG], revalidate: false });
    }

    // Measure revalidateTag — should be O(1) via TagIndex, not O(n) scan
    const start = performance.now();
    await cache.revalidateTag(TARGET_TAG);
    const elapsed = performance.now() - start;

    expect(elapsed, `revalidateTag took ${elapsed.toFixed(3)}ms — expected < ${THRESHOLD_MS}ms`).toBeLessThan(
      THRESHOLD_MS
    );

    // Sanity check: all entries are gone
    const sample = await cache.get(makeKey(0));
    expect(sample).toBeNull();
  });

  it("revalidateTag does not degrade with unrelated entries present", async () => {
    const cache = new DataCache(undefined, { maxL1Size: ENTRY_COUNT * 2 + 1 });

    // Half the entries carry TARGET_TAG, half carry an unrelated tag
    for (let i = 0; i < ENTRY_COUNT; i++) {
      await cache.set(makeKey(i), { index: i }, { tags: [TARGET_TAG], revalidate: false });
    }
    for (let i = 0; i < ENTRY_COUNT; i++) {
      const key: DataCacheKey = { ...makeKey(i), url: `https://example.com/other/${i}`, tags: ["other-tag"] };
      await cache.set(key, { index: i }, { tags: ["other-tag"], revalidate: false });
    }

    const start = performance.now();
    await cache.revalidateTag(TARGET_TAG);
    const elapsed = performance.now() - start;

    expect(elapsed, `revalidateTag took ${elapsed.toFixed(3)}ms with mixed entries — expected < ${THRESHOLD_MS}ms`).toBeLessThan(
      THRESHOLD_MS
    );
  });
});
