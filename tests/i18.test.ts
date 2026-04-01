import { describe, it, expect } from "vitest";
import { applyI18nExpansion } from "@sourceog/router";
import type { RouteTree } from "@sourceog/router";

function makeTree(): RouteTree {
  const about = {
    routeKey: "page:/about",
    pattern: "/about",
    renderMode: "ssg" as const,
    locale: undefined,
    parent: null,
    children: [],
    // Required RouteNode fields with minimal stubs
    segment: {} as never,
    layoutChain: [],
    edgeCompatible: true,
  };

  return {
    root: about,
    index: new Map([[about.routeKey, about]]),
    localeVariants: new Map(),
    collisions: [],
  };
}

describe("i18n", () => {
  it("uses as-needed by default", () => {
    const tree = makeTree();
    applyI18nExpansion(tree, {
      locales: ["en", "fr"],
      defaultLocale: "en",
    });

    expect(tree.localeVariants.get("en")?.[0].pattern).toBe("/about");
    expect(tree.localeVariants.get("fr")?.[0].pattern).toBe("/fr/about");
  });

  it("supports never mode", () => {
    const tree = makeTree();
    applyI18nExpansion(tree, {
      locales: ["en", "fr"],
      defaultLocale: "en",
      localePrefix: "never",
    });

    expect(tree.localeVariants.get("en")?.[0].pattern).toBe("/about");
    expect(tree.localeVariants.get("fr")?.[0].pattern).toBe("/about");
  });

  it("supports always mode", () => {
    const tree = makeTree();
    applyI18nExpansion(tree, {
      locales: ["en", "fr"],
      defaultLocale: "en",
      localePrefix: "always",
    });

    expect(tree.localeVariants.get("en")?.[0].pattern).toBe("/en/about");
    expect(tree.localeVariants.get("fr")?.[0].pattern).toBe("/fr/about");
  });

  it("supports custom localePathnames", () => {
    const tree = makeTree();
    applyI18nExpansion(tree, {
      locales: ["en", "fr"],
      defaultLocale: "en",
      localePathnames: {
        en: "",
        fr: "france",
      },
    });

    expect(tree.localeVariants.get("en")?.[0].pattern).toBe("/about");
    expect(tree.localeVariants.get("fr")?.[0].pattern).toBe("/france/about");
  });
});
