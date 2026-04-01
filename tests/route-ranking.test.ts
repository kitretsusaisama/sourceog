import { describe, it } from "vitest";
import * as fc from "fast-check";
import {
  rankRoutes,
  type DesignRouteMatch,
  type DesignRouteSegment,
  type RenderMode,
} from "@sourceog/router";

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const segmentTypeArb = fc.constantFrom(
  "static" as const,
  "dynamic" as const,
  "catch-all" as const,
  "optional-catch-all" as const
);

const segmentArb: fc.Arbitrary<DesignRouteSegment> = fc.record({
  segment: fc.string({ minLength: 1, maxLength: 20 }),
  type: segmentTypeArb,
  fsPath: fc.string({ minLength: 1, maxLength: 40 }),
  children: fc.constant([]),
  files: fc.constant({}),
});

const renderModeArb: fc.Arbitrary<RenderMode> = fc.constantFrom(
  "ssr",
  "ssg",
  "isr",
  "static",
  "edge"
);

const routeMatchArb: fc.Arbitrary<DesignRouteMatch> = fc.record({
  pattern: fc.string({ minLength: 1, maxLength: 40 }),
  params: fc.constant({}),
  segments: fc.array(segmentArb, { minLength: 1, maxLength: 5 }),
  layoutChain: fc.constant([]),
  renderMode: renderModeArb,
  routeKey: fc.string({ minLength: 1, maxLength: 40 }),
});

// ---------------------------------------------------------------------------
// Property 2: Route ranking is stable
// Validates: Requirements 13.4
// ---------------------------------------------------------------------------

describe("rankRoutes — Property 2: Route ranking is stable", () => {
  it("rankRoutes returns the same routeKey regardless of input order", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(routeMatchArb, { minLength: 1, maxLength: 10 }),
        async (candidates) => {
          const forward = rankRoutes(candidates);
          const reversed = rankRoutes([...candidates].reverse());
          return forward.routeKey === reversed.routeKey;
        }
      )
    );
  });
});

// ---------------------------------------------------------------------------
// Property 3: Static segments outrank dynamic segments
// Validates: Requirements 13.3
// ---------------------------------------------------------------------------

describe("rankRoutes — Property 3: Static segments outrank dynamic segments", () => {
  it("a route with only static segments beats a route with only dynamic segments at the same depth", async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate N segments (1–4) to use as the depth
        fc.integer({ min: 1, max: 4 }),
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.string({ minLength: 1, maxLength: 20 }),
        async (depth, staticKey, dynamicKey) => {
          const staticSegments: DesignRouteSegment[] = Array.from({ length: depth }, (_, i) => ({
            segment: `seg${i}`,
            type: "static",
            fsPath: `/static/${i}`,
            children: [],
            files: {},
          }));

          const dynamicSegments: DesignRouteSegment[] = Array.from({ length: depth }, (_, i) => ({
            segment: `param${i}`,
            type: "dynamic",
            fsPath: `/dynamic/${i}`,
            children: [],
            files: {},
          }));

          const staticMatch: DesignRouteMatch = {
            pattern: "/static",
            params: {},
            segments: staticSegments,
            layoutChain: [],
            renderMode: "ssr",
            routeKey: staticKey,
          };

          const dynamicMatch: DesignRouteMatch = {
            pattern: "/[param]",
            params: {},
            segments: dynamicSegments,
            layoutChain: [],
            renderMode: "ssr",
            routeKey: dynamicKey,
          };

          const winner = rankRoutes([staticMatch, dynamicMatch]);
          return winner.routeKey === staticMatch.routeKey;
        }
      )
    );
  });

  it("static always wins over catch-all at the same depth", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 4 }),
        async (depth) => {
          const staticMatch: DesignRouteMatch = {
            pattern: "/static",
            params: {},
            segments: Array.from({ length: depth }, (_, i) => ({
              segment: `seg${i}`,
              type: "static" as const,
              fsPath: `/s/${i}`,
              children: [],
              files: {},
            })),
            layoutChain: [],
            renderMode: "ssr",
            routeKey: "static-route",
          };

          const catchAllMatch: DesignRouteMatch = {
            pattern: "/[...slug]",
            params: {},
            segments: Array.from({ length: depth }, (_, i) => ({
              segment: `slug${i}`,
              type: "catch-all" as const,
              fsPath: `/c/${i}`,
              children: [],
              files: {},
            })),
            layoutChain: [],
            renderMode: "ssr",
            routeKey: "catchall-route",
          };

          const winner = rankRoutes([staticMatch, catchAllMatch]);
          return winner.routeKey === "static-route";
        }
      )
    );
  });
});

// ---------------------------------------------------------------------------
// Property 1: Route matching is deterministic
// Validates: Requirements 13.1
// ---------------------------------------------------------------------------

describe("rankRoutes — Property 1: Route matching is deterministic", () => {
  it("calling rankRoutes twice with the same candidates returns the same routeKey", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(routeMatchArb, { minLength: 1, maxLength: 10 }),
        async (candidates) => {
          const first = rankRoutes(candidates);
          const second = rankRoutes(candidates);
          return first.routeKey === second.routeKey;
        }
      )
    );
  });

  it("rankRoutes result is always one of the input candidates", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(routeMatchArb, { minLength: 1, maxLength: 10 }),
        async (candidates) => {
          const winner = rankRoutes(candidates);
          return candidates.some((c) => c.routeKey === winner.routeKey);
        }
      )
    );
  });
});
