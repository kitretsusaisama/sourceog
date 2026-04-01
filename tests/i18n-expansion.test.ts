import { describe, it } from "vitest";
import * as fc from "fast-check";
import {
  applyI18nExpansion,
  type DesignRouteSegment,
  type I18nConfig,
  type RenderMode,
  type RouteNode,
  type RouteTree,
} from "@sourceog/router";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSegment(overrides: Partial<DesignRouteSegment> = {}): DesignRouteSegment {
  return {
    segment: "page",
    type: "static",
    fsPath: "/app/page.tsx",
    children: [],
    files: {},
    ...overrides,
  };
}

function makeNode(routeKey: string, renderMode: RenderMode): RouteNode {
  return {
    routeKey,
    pattern: `/${routeKey}`,
    segment: makeSegment(),
    parent: null,
    children: [],
    layoutChain: [],
    renderMode,
    edgeCompatible: true,
  };
}

function makeRouteTree(nodes: RouteNode[]): RouteTree {
  const index = new Map<string, RouteNode>();
  for (const node of nodes) {
    index.set(node.routeKey, node);
  }

  const root = nodes[0] ?? makeNode("root", "ssr");

  return {
    root,
    index,
    localeVariants: new Map(),
    collisions: [],
  };
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const renderModeArb: fc.Arbitrary<RenderMode> = fc.constantFrom(
  "ssr",
  "ssg",
  "isr",
  "static",
  "edge"
);

const safeKeyArb = fc.stringMatching(/^[a-z][a-z0-9-]{0,19}$/);

const localeArb = fc.stringMatching(/^[a-z]{2}(-[A-Z]{2})?$/);

const nodeArb: fc.Arbitrary<RouteNode> = fc.record({
  routeKey: safeKeyArb,
  renderMode: renderModeArb,
}).map(({ routeKey, renderMode }) => makeNode(routeKey, renderMode));

const i18nConfigArb: fc.Arbitrary<I18nConfig> = fc
  .array(localeArb, { minLength: 1, maxLength: 5 })
  .chain((locales) => {
    const unique = [...new Set(locales)];
    return fc.record({
      locales: fc.constant(unique),
      defaultLocale: fc.constantFrom(...unique),
    });
  });

// ---------------------------------------------------------------------------
// Property 4: i18n locale expansion covers all SSG routes
// Validates: Requirements 7.1, 7.2
// ---------------------------------------------------------------------------

describe("applyI18nExpansion — Property 4: i18n locale expansion covers all SSG routes", () => {
  it("every SSG node has a variant in localeVariants for each configured locale", async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate 1–8 nodes with unique routeKeys
        fc.array(nodeArb, { minLength: 1, maxLength: 8 }),
        i18nConfigArb,
        async (rawNodes, i18n) => {
          // Deduplicate by routeKey
          const seen = new Set<string>();
          const nodes = rawNodes.filter((n) => {
            if (seen.has(n.routeKey)) return false;
            seen.add(n.routeKey);
            return true;
          });

          const tree = makeRouteTree(nodes);
          applyI18nExpansion(tree, i18n);

          const ssgNodes = nodes.filter((n) => n.renderMode === "ssg");

          for (const locale of i18n.locales) {
            const variants = tree.localeVariants.get(locale) ?? [];
            for (const ssgNode of ssgNodes) {
              const hasVariant = variants.some(
                (v) => (v as { sourceRouteKey?: string }).sourceRouteKey === ssgNode.routeKey
                  || v.routeKey === ssgNode.routeKey
              );
              if (!hasVariant) return false;
            }
          }

          return true;
        }
      )
    );
  });

  it("locale variants have the correct locale set on each node", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(nodeArb, { minLength: 1, maxLength: 6 }),
        i18nConfigArb,
        async (rawNodes, i18n) => {
          const seen = new Set<string>();
          const nodes = rawNodes.filter((n) => {
            if (seen.has(n.routeKey)) return false;
            seen.add(n.routeKey);
            return true;
          });

          const tree = makeRouteTree(nodes);
          applyI18nExpansion(tree, i18n);

          for (const [locale, variants] of tree.localeVariants.entries()) {
            for (const variant of variants) {
              if (variant.locale !== locale) return false;
            }
          }

          return true;
        }
      )
    );
  });

  it("non-SSG nodes are NOT included in localeVariants", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(nodeArb, { minLength: 1, maxLength: 6 }),
        i18nConfigArb,
        async (rawNodes, i18n) => {
          const seen = new Set<string>();
          const nodes = rawNodes.filter((n) => {
            if (seen.has(n.routeKey)) return false;
            seen.add(n.routeKey);
            return true;
          });

          const tree = makeRouteTree(nodes);
          applyI18nExpansion(tree, i18n);

          const nonSsgKeys = new Set(
            nodes.filter((n) => n.renderMode !== "ssg").map((n) => n.routeKey)
          );

          for (const variants of tree.localeVariants.values()) {
            for (const variant of variants) {
              const sourceKey = (variant as { sourceRouteKey?: string }).sourceRouteKey ?? variant.routeKey;
              if (nonSsgKeys.has(sourceKey)) return false;
            }
          }

          return true;
        }
      )
    );
  });
});
