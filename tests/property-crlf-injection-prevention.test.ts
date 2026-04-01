/**
 * Property 11: CRLF Injection Prevention
 * Validates: Requirements 11.2, 11.3
 *
 * For any arbitrary header or cookie value, sanitizeHeaderValue() must strip
 * all \r and \n characters to prevent HTTP response splitting attacks.
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { sanitizeHeaderValue } from "@sourceog/server";

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Arbitrary string that may contain CRLF injection vectors */
function arbitraryHeaderValue(): fc.Arbitrary<string> {
  return fc.oneof(
    fc.constant("\r\n"),
    fc.constant("\r"),
    fc.constant("\n"),
    fc.constant("value\r\nX-Injected: evil"),
    fc.constant("value\nX-Injected: evil"),
    fc.constant("value\rX-Injected: evil"),
    fc.constant("\r\nSet-Cookie: session=hijacked"),
    fc.constant("normal-value"),
    fc.string({ unit: "grapheme", minLength: 0, maxLength: 200 }),
    fc.tuple(
      fc.string({ unit: "grapheme", minLength: 0, maxLength: 50 }),
      fc.constantFrom("\r\n", "\r", "\n"),
      fc.string({ unit: "grapheme", minLength: 0, maxLength: 50 })
    ).map(([a, mid, b]) => `${a}${mid}${b}`)
  );
}

// ---------------------------------------------------------------------------
// Property 11: CRLF Injection Prevention
// ---------------------------------------------------------------------------

describe("Property 11: CRLF Injection Prevention", () => {
  it(
    "sanitizeHeaderValue() never leaves \\r in the output",
    () => {
      fc.assert(
        fc.property(arbitraryHeaderValue(), (value) => {
          const sanitized = sanitizeHeaderValue(value);
          expect(sanitized).not.toContain("\r");
        }),
        { numRuns: 1000 }
      );
    }
  );

  it(
    "sanitizeHeaderValue() never leaves \\n in the output",
    () => {
      fc.assert(
        fc.property(arbitraryHeaderValue(), (value) => {
          const sanitized = sanitizeHeaderValue(value);
          expect(sanitized).not.toContain("\n");
        }),
        { numRuns: 1000 }
      );
    }
  );

  it(
    "sanitizeHeaderValue() never leaves \\r\\n in the output",
    () => {
      fc.assert(
        fc.property(arbitraryHeaderValue(), (value) => {
          const sanitized = sanitizeHeaderValue(value);
          expect(sanitized).not.toContain("\r\n");
        }),
        { numRuns: 1000 }
      );
    }
  );

  it(
    "sanitized values preserve all non-CRLF characters",
    () => {
      fc.assert(
        fc.property(
          fc.string({ unit: "grapheme", minLength: 0, maxLength: 200 }).filter(
            (s) => !s.includes("\r") && !s.includes("\n")
          ),
          (safe) => {
            expect(sanitizeHeaderValue(safe)).toBe(safe);
          }
        ),
        { numRuns: 500 }
      );
    }
  );

  it("known CRLF injection vectors are sanitized correctly", () => {
    expect(sanitizeHeaderValue("value\r\nX-Injected: evil")).toBe("valueX-Injected: evil");
    expect(sanitizeHeaderValue("value\nX-Injected: evil")).toBe("valueX-Injected: evil");
    expect(sanitizeHeaderValue("value\rX-Injected: evil")).toBe("valueX-Injected: evil");
    expect(sanitizeHeaderValue("\r\nSet-Cookie: session=hijacked")).toBe("Set-Cookie: session=hijacked");
    expect(sanitizeHeaderValue("normal-value")).toBe("normal-value");
    expect(sanitizeHeaderValue("\r\n")).toBe("");
    expect(sanitizeHeaderValue("")).toBe("");
  });
});
