/**
 * Property 3: XSS Safety — RSC Payload Script Injection
 * Validates: Requirements 9.1, 9.2, 9.3
 *
 * For any arbitrary Unicode string (including XSS vectors like </script>,
 * <!--, and -->), escapeScriptContent() must produce output that never
 * contains unescaped versions of those sequences inside a <script> block.
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { escapeScriptContent } from "@sourceog/renderer";

// ---------------------------------------------------------------------------
// Dangerous sequences that must never appear unescaped inside <script> blocks
// ---------------------------------------------------------------------------

const DANGEROUS_SEQUENCES = ["</script>", "<!--", "-->"];

/**
 * Simulate what the browser parser would see: wrap the escaped value in a
 * <script> tag and assert none of the dangerous sequences appear verbatim.
 */
function assertSafeInScriptTag(escaped: string): void {
  const html = `<script>${escaped}</script>`;
  for (const seq of DANGEROUS_SEQUENCES) {
    // The only </script> that should appear is the closing tag we added,
    // which is at the very end. Any occurrence before the final position
    // means the content broke out of the script context.
    if (seq === "</script>") {
      // The closing tag we appended is the only allowed occurrence
      const idx = html.indexOf(seq);
      expect(idx).toBe(html.length - "</script>".length);
    } else {
      expect(html).not.toContain(seq);
    }
  }
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Arbitrary string that may contain XSS vectors */
function arbitraryXssString(): fc.Arbitrary<string> {
  return fc.oneof(
    // Pure XSS vectors
    fc.constant("</script>"),
    fc.constant("<!--"),
    fc.constant("-->"),
    fc.constant('</script><script>alert(1)</script>'),
    fc.constant("<!-- comment -->"),
    fc.constant("--></script>"),
    // Arbitrary Unicode strings that may happen to contain the sequences
    fc.string({ unit: "grapheme", minLength: 0, maxLength: 200 }),
    // Strings built by concatenating XSS vectors with arbitrary content
    fc.tuple(
      fc.string({ unit: "grapheme", minLength: 0, maxLength: 50 }),
      fc.constantFrom(...DANGEROUS_SEQUENCES),
      fc.string({ unit: "grapheme", minLength: 0, maxLength: 50 })
    ).map(([a, mid, b]) => `${a}${mid}${b}`)
  );
}

/** Arbitrary JSON-like object serialized to string (simulates snapshot/context payloads) */
function arbitraryJsonPayload(): fc.Arbitrary<string> {
  return fc.record({
    routeId: fc.string({ unit: "grapheme", minLength: 0, maxLength: 50 }),
    data: fc.string({ unit: "grapheme", minLength: 0, maxLength: 100 }),
    xss: fc.constantFrom(...DANGEROUS_SEQUENCES, "safe-value")
  }).map((obj) => JSON.stringify(obj));
}

// ---------------------------------------------------------------------------
// Property 3: XSS Safety — RSC Payload Script Injection
// ---------------------------------------------------------------------------

describe("Property 3: XSS Safety — RSC Payload Script Injection", () => {
  it(
    "escapeScriptContent() never leaves </script> unescaped inside a script block",
    () => {
      fc.assert(
        fc.property(arbitraryXssString(), (input) => {
          const escaped = escapeScriptContent(input);
          assertSafeInScriptTag(escaped);
        }),
        { numRuns: 1000 }
      );
    }
  );

  it(
    "escapeScriptContent() never leaves <!-- unescaped inside a script block",
    () => {
      fc.assert(
        fc.property(arbitraryXssString(), (input) => {
          const escaped = escapeScriptContent(input);
          const html = `<script>${escaped}</script>`;
          expect(html).not.toContain("<!--");
        }),
        { numRuns: 1000 }
      );
    }
  );

  it(
    "escapeScriptContent() never leaves --> unescaped inside a script block",
    () => {
      fc.assert(
        fc.property(arbitraryXssString(), (input) => {
          const escaped = escapeScriptContent(input);
          const html = `<script>${escaped}</script>`;
          expect(html).not.toContain("-->");
        }),
        { numRuns: 1000 }
      );
    }
  );

  it(
    "JSON-serialized payloads with XSS vectors are safe after escaping",
    () => {
      fc.assert(
        fc.property(arbitraryJsonPayload(), (json) => {
          const escaped = escapeScriptContent(json);
          assertSafeInScriptTag(escaped);
          // The escaped value must still be parseable as JSON after unescaping
          // (i.e., escaping is reversible and doesn't corrupt the data structure)
          const unescaped = escaped
            .replaceAll("<\\/", "</")
            .replaceAll("<\\!--", "<!--")
            .replaceAll("--\\>", "-->");
          expect(() => JSON.parse(unescaped)).not.toThrow();
        }),
        { numRuns: 500 }
      );
    }
  );

  it("known XSS vectors are escaped correctly", () => {
    expect(escapeScriptContent("</script>")).toBe("<\\/script>");
    expect(escapeScriptContent("<!--")).toBe("<\\!--");
    expect(escapeScriptContent("-->")).toBe("--\\>");
    expect(escapeScriptContent('</script><script>alert(1)</script>')).toBe(
      "<\\/script><script>alert(1)<\\/script>"
    );
    expect(escapeScriptContent("<!-- comment -->")).toBe("<\\!-- comment --\\>");
  });

  it("strings without dangerous sequences are returned unchanged", () => {
    fc.assert(
      fc.property(
        fc.string({ unit: "grapheme", minLength: 0, maxLength: 200 }).filter(
          (s) => !s.includes("</") && !s.includes("<!--") && !s.includes("-->")
        ),
        (safe) => {
          expect(escapeScriptContent(safe)).toBe(safe);
        }
      ),
      { numRuns: 500 }
    );
  });
});
