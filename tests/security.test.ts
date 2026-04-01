import { describe, expect, it } from "vitest";
import { defineSecurityPolicy, applySecurityPolicy } from "@sourceog/platform";
import { html } from "@sourceog/runtime";

describe("security policy", () => {
  it("applies hardened headers to responses", () => {
    const response = html("<p>Hello</p>");
    applySecurityPolicy(response, defineSecurityPolicy({
      extraHeaders: {
        "x-company-policy": "active"
      }
    }));

    expect(response.headers.get("content-security-policy")).toContain("default-src");
    expect(response.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(response.headers.get("x-company-policy")).toBe("active");
  });
});
