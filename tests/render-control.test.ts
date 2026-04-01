import { describe, expect, it } from "vitest";
import { isNotFoundInterrupt, isRedirectInterrupt, notFound, redirectTo } from "@sourceog/runtime";

describe("render control helpers", () => {
  it("throws redirect interrupts", () => {
    try {
      redirectTo("/login", 307);
    } catch (error) {
      expect(isRedirectInterrupt(error)).toBe(true);
      expect(isRedirectInterrupt(error) ? error.location : "").toBe("/login");
    }
  });

  it("throws not found interrupts", () => {
    try {
      notFound();
    } catch (error) {
      expect(isNotFoundInterrupt(error)).toBe(true);
    }
  });
});
