import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  createMiddlewareEngine,
  compileMatcherPattern,
  FrameworkError,
  type MiddlewareDefinition,
  type SourceOGRequest,
} from "@sourceog/server";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(pathname: string): SourceOGRequest {
  return {
    method: "GET",
    url: new URL(`http://localhost${pathname}`),
    headers: {},
    cookies: {},
    body: null,
    requestId: "test-req",
    traceId: "test-trace",
  };
}

function noopHandler(): MiddlewareDefinition["handler"] {
  return async (_req, _res, next) => {
    next();
  };
}

// Arbitrary for MiddlewareDefinition (without handler — we add a noop)
const middlewareDefArb = fc.record({
  id: fc.string({ minLength: 1, maxLength: 32 }),
  scope: fc.constantFrom("global" as const, "scoped" as const, "route-local" as const),
  matcher: fc.array(
    fc.constantFrom("/", "/about", "/blog/:slug", "/api/:path*", "/:path*"),
    { minLength: 1, maxLength: 3 }
  ),
  edgeCompatible: fc.boolean(),
  priority: fc.integer({ min: -100, max: 1000 }),
}).map((def) => ({
  ...def,
  handler: noopHandler(),
}));

// ---------------------------------------------------------------------------
// Property 10: Middleware manifest is sorted by priority descending
// Validates: Requirements 4.1
// ---------------------------------------------------------------------------

describe("MiddlewareEngine — Property 10: Middleware manifest sorted by priority descending", () => {
  it("manifest.entries are sorted by priority descending for any input", () => {
    const engine = createMiddlewareEngine();

    fc.assert(
      fc.property(
        fc.array(middlewareDefArb, { minLength: 0, maxLength: 20 }),
        (definitions) => {
          const manifest = engine.compile(definitions);

          for (let i = 0; i < manifest.entries.length - 1; i++) {
            if (manifest.entries[i].priority < manifest.entries[i + 1].priority) {
              return false;
            }
          }
          return true;
        }
      )
    );
  });

  it("manifest.entries length equals definitions length", () => {
    const engine = createMiddlewareEngine();

    fc.assert(
      fc.property(
        fc.array(middlewareDefArb, { minLength: 0, maxLength: 20 }),
        (definitions) => {
          const manifest = engine.compile(definitions);
          return manifest.entries.length === definitions.length;
        }
      )
    );
  });
});

// ---------------------------------------------------------------------------
// Property 11: Edge-incompatible middleware excluded from edge manifest
// Validates: Requirements 4.2
// ---------------------------------------------------------------------------

describe("MiddlewareEngine — Property 11: Edge-incompatible middleware excluded from edge manifest", () => {
  it("no edgeCompatible:false entry appears in manifest.edgeEntries", () => {
    const engine = createMiddlewareEngine();

    fc.assert(
      fc.property(
        fc.array(middlewareDefArb, { minLength: 0, maxLength: 20 }),
        (definitions) => {
          const manifest = engine.compile(definitions);

          for (const entry of manifest.edgeEntries) {
            if (!entry.edgeCompatible) return false;
          }
          return true;
        }
      )
    );
  });

  it("all edgeCompatible:true definitions appear in manifest.edgeEntries", () => {
    const engine = createMiddlewareEngine();

    fc.assert(
      fc.property(
        fc.array(middlewareDefArb, { minLength: 0, maxLength: 20 }),
        (definitions) => {
          const manifest = engine.compile(definitions);
          const edgeIds = new Set(manifest.edgeEntries.map((e) => e.id));

          for (const def of definitions) {
            if (def.edgeCompatible && !edgeIds.has(def.id)) {
              return false;
            }
          }
          return true;
        }
      )
    );
  });
});

// ---------------------------------------------------------------------------
// Property 12: Compiled matcher correctness
// Validates: Requirements 4.6
// ---------------------------------------------------------------------------

/**
 * Reference implementation: mirrors patternToRegex in middleware-engine.ts.
 * Must be kept in sync with the production implementation.
 */
function referenceMatch(pattern: string, pathname: string): boolean {
  try {
    // Regex literal
    if (pattern.startsWith("/") && pattern.endsWith("/") && pattern.length > 2) {
      const inner = pattern.slice(1, -1);
      if (/[\\^$.|?*+()[\]{}]/.test(inner)) {
        return new RegExp(inner).test(pathname);
      }
    }

    let src = pattern
      .replace(/\[\[\.\.\.([^\]]+)\]\]/g, "\x00CATCHALL\x00")
      .replace(/\[\.\.\.([^\]]+)\]/g, "\x00CATCHALL\x00")
      .replace(/\[([^\]]+)\]/g, "\x00SEGMENT\x00");

    // Escape regex special chars
    src = src.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    src = src.replace(/\x00CATCHALL\x00/g, "(.+)");
    src = src.replace(/\x00SEGMENT\x00/g, "([^/]+)");

    // /:param* → optional catch-all including the preceding slash
    src = src.replace(/\/:([ a-zA-Z_][a-zA-Z0-9_]*)\*/g, "(?:/(.*))?");
    src = src.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)\*/g, "(.*)");
    src = src.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)\+/g, "(.+)");
    src = src.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, "([^/]+)");

    return new RegExp(`^${src}$`).test(pathname);
  } catch {
    return false;
  }
}

describe("MiddlewareEngine — Property 12: Compiled matcher correctness", () => {
  // Use a constrained set of patterns and pathnames to keep the test meaningful
  const patternArb = fc.constantFrom(
    "/",
    "/about",
    "/blog/:slug",
    "/api/:path*",
    "/:path*",
    "/dashboard/:section/:id",
    "/static/[file]"
  );

  const pathnameArb = fc.constantFrom(
    "/",
    "/about",
    "/blog/hello-world",
    "/blog/",
    "/api/users",
    "/api/users/123",
    "/dashboard/settings/profile",
    "/static/image.png",
    "/other/path"
  );

  it("compiledMatcher.test(pathname) agrees with reference regex match", () => {
    fc.assert(
      fc.property(
        fc.array(patternArb, { minLength: 1, maxLength: 3 }),
        pathnameArb,
        (patterns, pathname) => {
          const compiled = compileMatcherPattern(patterns);
          const compiledResult = compiled.test(pathname);
          const referenceResult = patterns.some((p) => referenceMatch(p, pathname));
          return compiledResult === referenceResult;
        }
      )
    );
  });

  it("exact path pattern matches only that path", () => {
    const matcher = compileMatcherPattern(["/about"]);
    expect(matcher.test("/about")).toBe(true);
    expect(matcher.test("/about/")).toBe(false);
    expect(matcher.test("/other")).toBe(false);
  });

  it("dynamic segment pattern matches single segment", () => {
    const matcher = compileMatcherPattern(["/blog/:slug"]);
    expect(matcher.test("/blog/hello")).toBe(true);
    expect(matcher.test("/blog/hello/world")).toBe(false);
    expect(matcher.test("/blog/")).toBe(false);
  });

  it("catch-all pattern matches multiple segments", () => {
    const matcher = compileMatcherPattern(["/api/:path*"]);
    expect(matcher.test("/api/users")).toBe(true);
    expect(matcher.test("/api/users/123")).toBe(true);
    expect(matcher.test("/api/")).toBe(true);
    expect(matcher.test("/api")).toBe(true); // :path* is optional
  });

  it("multiple patterns: test returns true if any pattern matches", () => {
    const matcher = compileMatcherPattern(["/about", "/contact"]);
    expect(matcher.test("/about")).toBe(true);
    expect(matcher.test("/contact")).toBe(true);
    expect(matcher.test("/home")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Unit tests for MiddlewareEngine.compile
// ---------------------------------------------------------------------------

describe("MiddlewareEngine.compile — unit tests", () => {
  it("sorts entries by priority descending", () => {
    const engine = createMiddlewareEngine();
    const defs: MiddlewareDefinition[] = [
      { id: "low", scope: "global", matcher: ["/"], handler: noopHandler(), edgeCompatible: true, priority: 10 },
      { id: "high", scope: "global", matcher: ["/"], handler: noopHandler(), edgeCompatible: true, priority: 100 },
      { id: "mid", scope: "global", matcher: ["/"], handler: noopHandler(), edgeCompatible: true, priority: 50 },
    ];

    const manifest = engine.compile(defs);
    expect(manifest.entries.map((e) => e.id)).toEqual(["high", "mid", "low"]);
  });

  it("excludes edgeCompatible:false from edgeEntries", () => {
    const engine = createMiddlewareEngine();
    const defs: MiddlewareDefinition[] = [
      { id: "edge", scope: "global", matcher: ["/"], handler: noopHandler(), edgeCompatible: true, priority: 1 },
      { id: "node-only", scope: "global", matcher: ["/"], handler: noopHandler(), edgeCompatible: false, priority: 2 },
    ];

    const manifest = engine.compile(defs);
    expect(manifest.entries).toHaveLength(2);
    expect(manifest.edgeEntries).toHaveLength(1);
    expect(manifest.edgeEntries[0].id).toBe("edge");
  });

  it("throws FrameworkError(MIDDLEWARE_COMPILE_ERROR) for invalid regex pattern", () => {
    const engine = createMiddlewareEngine();
    const defs: MiddlewareDefinition[] = [
      {
        id: "bad",
        scope: "global",
        // Regex literal syntax (wrapped in /.../) with an invalid regex inside
        matcher: ["/(?invalid-regex/"],
        handler: noopHandler(),
        edgeCompatible: true,
        priority: 1,
      },
    ];

    expect(() => engine.compile(defs)).toThrow(FrameworkError);
    try {
      engine.compile(defs);
    } catch (err) {
      expect(err).toBeInstanceOf(FrameworkError);
      expect((err as FrameworkError).code).toBe("MIDDLEWARE_COMPILE_ERROR");
    }
  });

  it("empty definitions produce empty manifest", () => {
    const engine = createMiddlewareEngine();
    const manifest = engine.compile([]);
    expect(manifest.entries).toHaveLength(0);
    expect(manifest.edgeEntries).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Unit tests for MiddlewareEngine.execute
// ---------------------------------------------------------------------------

describe("MiddlewareEngine.execute — unit tests", () => {
  it("invokes handlers in priority order", async () => {
    const engine = createMiddlewareEngine();
    const order: string[] = [];

    const defs: MiddlewareDefinition[] = [
      {
        id: "first",
        scope: "global",
        matcher: ["/:path*"],
        handler: async (_req, _res, next) => { order.push("first"); next(); },
        edgeCompatible: true,
        priority: 100,
      },
      {
        id: "second",
        scope: "global",
        matcher: ["/:path*"],
        handler: async (_req, _res, next) => { order.push("second"); next(); },
        edgeCompatible: true,
        priority: 50,
      },
    ];

    const manifest = engine.compile(defs);
    await engine.execute(makeRequest("/test"), manifest);
    expect(order).toEqual(["first", "second"]);
  });

  it("stops chain on redirect", async () => {
    const engine = createMiddlewareEngine();
    const called: string[] = [];

    const defs: MiddlewareDefinition[] = [
      {
        id: "redirector",
        scope: "global",
        matcher: ["/:path*"],
        handler: async (_req, res) => { called.push("redirector"); res.redirect("/login"); },
        edgeCompatible: true,
        priority: 100,
      },
      {
        id: "never",
        scope: "global",
        matcher: ["/:path*"],
        handler: async (_req, _res, next) => { called.push("never"); next(); },
        edgeCompatible: true,
        priority: 50,
      },
    ];

    const manifest = engine.compile(defs);
    const result = await engine.execute(makeRequest("/dashboard"), manifest);

    expect(called).toEqual(["redirector"]);
    expect(result.action).toBe("redirect");
    expect(result.destination).toBe("/login");
  });

  it("stops chain on rewrite", async () => {
    const engine = createMiddlewareEngine();
    const called: string[] = [];

    const defs: MiddlewareDefinition[] = [
      {
        id: "rewriter",
        scope: "global",
        matcher: ["/:path*"],
        handler: async (_req, res) => { called.push("rewriter"); res.rewrite("/new-path"); },
        edgeCompatible: true,
        priority: 100,
      },
      {
        id: "never",
        scope: "global",
        matcher: ["/:path*"],
        handler: async (_req, _res, next) => { called.push("never"); next(); },
        edgeCompatible: true,
        priority: 50,
      },
    ];

    const manifest = engine.compile(defs);
    const result = await engine.execute(makeRequest("/old-path"), manifest);

    expect(called).toEqual(["rewriter"]);
    expect(result.action).toBe("rewrite");
    expect(result.destination).toBe("/new-path");
  });

  it("continues chain when next() is called", async () => {
    const engine = createMiddlewareEngine();
    const called: string[] = [];

    const defs: MiddlewareDefinition[] = [
      {
        id: "a",
        scope: "global",
        matcher: ["/:path*"],
        handler: async (_req, _res, next) => { called.push("a"); next(); },
        edgeCompatible: true,
        priority: 100,
      },
      {
        id: "b",
        scope: "global",
        matcher: ["/:path*"],
        handler: async (_req, _res, next) => { called.push("b"); next(); },
        edgeCompatible: true,
        priority: 50,
      },
    ];

    const manifest = engine.compile(defs);
    const result = await engine.execute(makeRequest("/page"), manifest);

    expect(called).toEqual(["a", "b"]);
    expect(result.action).toBe("next");
  });

  it("skips handlers whose matcher does not match the pathname", async () => {
    const engine = createMiddlewareEngine();
    const called: string[] = [];

    const defs: MiddlewareDefinition[] = [
      {
        id: "api-only",
        scope: "scoped",
        matcher: ["/api/:path*"],
        handler: async (_req, _res, next) => { called.push("api-only"); next(); },
        edgeCompatible: true,
        priority: 100,
      },
      {
        id: "global",
        scope: "global",
        matcher: ["/:path*"],
        handler: async (_req, _res, next) => { called.push("global"); next(); },
        edgeCompatible: true,
        priority: 50,
      },
    ];

    const manifest = engine.compile(defs);
    await engine.execute(makeRequest("/blog/post"), manifest);

    expect(called).toEqual(["global"]);
    expect(called).not.toContain("api-only");
  });

  it("accumulates headers and cookies across the chain", async () => {
    const engine = createMiddlewareEngine();

    const defs: MiddlewareDefinition[] = [
      {
        id: "header-setter",
        scope: "global",
        matcher: ["/:path*"],
        handler: async (_req, res, next) => {
          res.setHeader("x-custom", "value");
          res.setCookie("session", "abc123");
          next();
        },
        edgeCompatible: true,
        priority: 100,
      },
    ];

    const manifest = engine.compile(defs);
    const result = await engine.execute(makeRequest("/page"), manifest);

    expect(result.headers["x-custom"]).toBe("value");
    expect(result.cookies).toHaveLength(1);
    expect(result.cookies[0].name).toBe("session");
  });
});
