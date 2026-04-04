/**
 * Property 10: XSS Safety — HTML Attribute Injection
 * Validates: Requirements 11.1, 11.4
 *
 * For any arbitrary string used as an HTML attribute value, escapeHtmlAttr()
 * must produce output that never contains unescaped &, \" , or > characters,
 * preventing attribute breakout and XSS injection.
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { escapeHtmlAttr } from "@sourceog/renderer";

// ---------------------------------------------------------------------------
// Characters that must be escaped inside double-quoted HTML attribute values
// ---------------------------------------------------------------------------

/**
 * Assert that the escaped value does not break out of a double-quoted attribute.
 * Checks: no raw \" , no raw >, no bare &.
 */
function assertSafeInHtmlAttr(escaped: string): void {
  expect(escaped).not.toContain('"');
  expect(escaped).not.toContain(">");
  const bareAmpersand = /&(?!amp;|quot;|gt;|lt;|#\d+;)/;
  expect(bareAmpersand.test(escaped)).toBe(false);
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Arbitrary string that may contain HTML injection vectors */
function arbitraryAttrString(): fc.Arbitrary<string> {
  return fc.oneof(
    fc.constant('"'),
    fc.constant("&"),
    fc.constant(">"),
    fc.constant('"><script>alert(1)</script>'),
    fc.constant("&amp;"),
    fc.constant('" onmouseover="alert(1)"'),
    fc.constant("> injected"),
    fc.string({ unit: "grapheme", minLength: 0, maxLength: 200 }),
    fc.tuple(
      fc.string({ unit: "grapheme", minLength: 0, maxLength: 50 }),
      fc.constantFrom(...DANGEROUS_CHARS),
      fc.string({ unit: "grapheme", minLength: 0, maxLength: 50 })
    ).map(([a, mid, b]) => `${a}${mid}${b}`)
  );
}

// ---------------------------------------------------------------------------
// Property 10: XSS Safety — HTML Attribute Injection
// ---------------------------------------------------------------------------

describe("Property 10: XSS Safety — HTML Attribute Injection", () => {
  it(
    "escapeHtmlAttr() never leaves a raw double-quote in an attribute value",
    () => {
      fc.assert(
        fc.property(arbitraryAttrString(), (input) => {
          const escaped = escapeHtmlAttr(input);
          expect(escaped).not.toContain('"');
        }),
        { numRuns: 1000 }
      );
    }
  );

  it(
    "escapeHtmlAttr() never leaves a raw > in an attribute value",
    () => {
      fc.assert(
        fc.property(arbitraryAttrString(), (input) => {
          const escaped = escapeHtmlAttr(input);
          expect(escaped).not.toContain(">");
        }),
        { numRuns: 1000 }
      );
    }
  );

  it(
    "escapeHtmlAttr() never leaves a bare & in an attribute value",
    () => {
      fc.assert(
        fc.property(arbitraryAttrString(), (input) => {
          const escaped = escapeHtmlAttr(input);
          const bareAmpersand = /&(?!amp;|quot;|gt;|lt;|#\d+;)/;
          expect(bareAmpersand.test(escaped)).toBe(false);
        }),
        { numRuns: 1000 }
      );
    }
  );

  it(
    "escaped attribute values are safe when embedded in double-quoted HTML attributes",
    () => {
      fc.assert(
        fc.property(arbitraryAttrString(), (input) => {
          assertSafeInHtmlAttr(escapeHtmlAttr(input));
        }),
        { numRuns: 1000 }
      );
    }
  );

  it("known injection vectors are escaped correctly", () => {
    expect(escapeHtmlAttr('"')).toBe("&quot;");
    expect(escapeHtmlAttr("&")).toBe("&amp;");
    expect(escapeHtmlAttr(">")).toBe("&gt;");
    expect(escapeHtmlAttr('"><script>alert(1)</script>')).toBe(
      "&quot;&gt;<script&gt;alert(1)</script&gt;"
    );
    expect(escapeHtmlAttr('" onmouseover="alert(1)"')).toBe(
      "&quot; onmouseover=&quot;alert(1)&quot;"
    );
  });

  it("strings without dangerous characters are returned unchanged", () => {
    fc.assert(
      fc.property(
        fc.string({ unit: "grapheme", minLength: 0, maxLength: 200 }).filter(
          (s) => !s.includes("&") && !s.includes('"') && !s.includes(">")
        ),
        (safe) => {
          expect(escapeHtmlAttr(safe)).toBe(safe);
        }
      ),
      { numRuns: 500 }
    );
  });
});
