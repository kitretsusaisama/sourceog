/**
 * Property 4: Manifest Path Bounds
 * Validates: Requirements 10.1, 10.2, 10.3
 *
 * For any arbitrary routeFile string (including path traversal patterns like
 * ../../etc/passwd), the resolved manifest path must either:
 *   (a) start with projectRoot — i.e., be bounded within the project, OR
 *   (b) throw CompilerError with code MANIFEST_PATH_TRAVERSAL for absolute
 *       paths that resolve outside projectRoot.
 *
 * The traversal must never silently return a path outside projectRoot.
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import path from "node:path";
import {
  resolveManifestPathForRouteFile,
  CompilerError,
  PROJECT_ROOT
} from "@sourceog/renderer";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Attempt to resolve the manifest path for a given routeFile.
 * Returns the resolved path on success, or the thrown error on failure.
 */
function tryResolve(routeFile: string): string | CompilerError | Error {
  try {
    const result = resolveManifestPathForRouteFile(routeFile);
    return result ?? "";
  } catch (err) {
    return err as Error;
  }
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Arbitrary relative path segments that may include traversal components */
function arbitraryRelativePath(): fc.Arbitrary<string> {
  return fc.oneof(
    // Classic traversal patterns
    fc.constant("../../etc/passwd"),
    fc.constant("../../../etc/shadow"),
    fc.constant("../../windows/system32/config/sam"),
    fc.constant("../outside/project"),
    // Relative paths inside the project (safe)
    fc.constant("src/app/page.tsx"),
    fc.constant("app/dashboard/page.tsx"),
    fc.constant("pages/index.tsx"),
    // Arbitrary relative paths
    fc.array(
      fc.oneof(
        fc.constant(".."),
        fc.constant("."),
        fc.stringMatching(/^[a-z0-9_-]{1,10}$/)
      ),
      { minLength: 1, maxLength: 6 }
    ).map((parts) => parts.join("/") + "/page.tsx")
  );
}

/** Arbitrary absolute path that is outside PROJECT_ROOT */
function arbitraryAbsoluteOutsidePath(): fc.Arbitrary<string> {
  return fc.oneof(
    fc.constant("/etc/passwd"),
    fc.constant("/etc/shadow"),
    fc.constant("/tmp/malicious/page.tsx"),
    fc.constant("/root/.ssh/id_rsa"),
    fc.constant("C:\\Windows\\System32\\config\\sam"),
    // Absolute path that starts with a different root
    fc.stringMatching(/^\/[a-z]{3,8}\/[a-z]{3,8}\/page\.tsx$/)
  ).filter((p) => !p.startsWith(PROJECT_ROOT));
}

/** Arbitrary absolute path that is inside PROJECT_ROOT */
function arbitraryAbsoluteInsidePath(): fc.Arbitrary<string> {
  return fc.oneof(
    fc.constant(path.join(PROJECT_ROOT, "src", "app", "page.tsx")),
    fc.constant(path.join(PROJECT_ROOT, "app", "page.tsx")),
    fc.constant(path.join(PROJECT_ROOT, "pages", "index.tsx")),
    fc.array(
      fc.stringMatching(/^[a-z0-9_-]{1,10}$/),
      { minLength: 1, maxLength: 4 }
    ).map((parts) => path.join(PROJECT_ROOT, ...parts, "page.tsx"))
  );
}

// ---------------------------------------------------------------------------
// Property 4: Manifest Path Bounds
// ---------------------------------------------------------------------------

describe("Property 4: Manifest Path Bounds", () => {
  it(
    "resolved manifest path always starts with projectRoot for relative routeFile inputs",
    () => {
      fc.assert(
        fc.property(arbitraryRelativePath(), (routeFile) => {
          const result = tryResolve(routeFile);

          if (result instanceof Error) {
            // Only CompilerError with MANIFEST_PATH_TRAVERSAL is acceptable
            expect(result).toBeInstanceOf(CompilerError);
            expect((result as CompilerError).code).toBe("MANIFEST_PATH_TRAVERSAL");
          } else if (result !== "") {
            // If a path was returned, it must be within projectRoot
            expect(result.startsWith(PROJECT_ROOT)).toBe(true);
          }
          // Empty string means no manifest found — that's fine
        }),
        { numRuns: 500 }
      );
    }
  );

  it(
    "absolute paths outside projectRoot throw CompilerError with MANIFEST_PATH_TRAVERSAL",
    () => {
      fc.assert(
        fc.property(arbitraryAbsoluteOutsidePath(), (routeFile) => {
          const result = tryResolve(routeFile);

          // Must throw — never silently return a path outside projectRoot
          expect(result).toBeInstanceOf(Error);
          expect((result as CompilerError).code).toBe("MANIFEST_PATH_TRAVERSAL");
          expect((result as CompilerError).name).toBe("CompilerError");
        }),
        { numRuns: 200 }
      );
    }
  );

  it(
    "absolute paths inside projectRoot never return a path outside projectRoot",
    () => {
      fc.assert(
        fc.property(arbitraryAbsoluteInsidePath(), (routeFile) => {
          const result = tryResolve(routeFile);

          if (result instanceof Error) {
            // Should not throw for paths inside projectRoot
            expect(result).not.toBeInstanceOf(CompilerError);
          } else if (result !== "") {
            expect(result.startsWith(PROJECT_ROOT)).toBe(true);
          }
        }),
        { numRuns: 200 }
      );
    }
  );

  it(
    "known traversal vectors are rejected or bounded",
    () => {
      const traversalVectors = [
        "../../etc/passwd",
        "../../../root/.ssh/id_rsa",
        "../../../../windows/system32",
        "src/../../etc/shadow",
      ];

      for (const vector of traversalVectors) {
        const result = tryResolve(vector);
        if (result instanceof Error) {
          expect((result as CompilerError).code).toBe("MANIFEST_PATH_TRAVERSAL");
        } else if (result !== "") {
          // If resolved, must be within projectRoot
          expect(result.startsWith(PROJECT_ROOT)).toBe(true);
        }
      }
    }
  );

  it(
    "absolute paths outside projectRoot always throw CompilerError",
    () => {
      const outsidePaths = [
        "/etc/passwd",
        "/tmp/evil/page.tsx",
        "/root/.ssh/id_rsa",
      ].filter((p) => !p.startsWith(PROJECT_ROOT));

      for (const outsidePath of outsidePaths) {
        let caught: unknown;
        try {
          resolveManifestPathForRouteFile(outsidePath);
        } catch (err) {
          caught = err;
        }
        expect(caught).toBeDefined();
        expect((caught as CompilerError).code).toBe("MANIFEST_PATH_TRAVERSAL");
        expect((caught as CompilerError).name).toBe("CompilerError");
      }
    }
  );
});
