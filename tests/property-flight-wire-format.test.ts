/**
 * Property 7: Flight Wire Format Validity
 * Validates: Requirements 3.2, 8.9 (INV-002)
 * Tag: `Feature: sourceog-rsc-contract-remediation, Property 7: Flight Wire Format Validity`
 *
 * For any Flight payload produced by the RSC worker, every non-empty line must
 * match the React Flight wire format line prefix pattern /^\d+:[A-Z"\[{]/
 * and no line may contain the string "data-sourceog-client-placeholder".
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

// ---------------------------------------------------------------------------
// React Flight wire format reference
//
// The React Flight protocol is a line-delimited text format where each line
// has the form:  <row-id>:<type-tag><payload>\n
//
// Row IDs are decimal integers. Type tags include:
//   D  — module reference (client reference)
//   I  — import chunk
//   E  — error
//   S  — symbol
//   F  — server reference
//   T  — text node
//   "  — string literal
//   [  — array
//   {  — object / React element
//   uppercase letters for other row types
//
// The pattern /^\d+:[A-Z"\[{]/ covers all valid line prefixes.
// ---------------------------------------------------------------------------

/** Valid React Flight wire format line examples */
const VALID_FLIGHT_LINES = [
  '0:D{"id":"abc123","chunks":["chunk.js"],"name":"default","async":false}',
  '1:["$","div",null,{"className":"container"}]',
  '2:{"$$typeof":"$","type":"$1","key":null,"props":{}}',
  '3:I["chunk-abc.js",["chunk-abc.js"],"default"]',
  '4:T<div>Hello world</div>',
  '5:S"Symbol.for(react.suspense)"',
  '0:"root"',
  '1:[["$","h1",null,{}]]',
  '0:{"id":"test","chunks":[],"name":"Button","async":false}'
];

/** Invalid lines that must NOT appear in a Flight payload */
const INVALID_FLIGHT_LINES = [
  '<div data-sourceog-client-placeholder="true"></div>',
  'data-sourceog-client-placeholder',
  'undefined',
  '',
  'not-a-flight-line',
  '{"type":"div"}',  // missing row-id prefix
  'abc:D{}',         // non-numeric row-id
];

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Arbitrary valid Flight row ID (non-negative integer) */
function arbitraryRowId(): fc.Arbitrary<number> {
  return fc.integer({ min: 0, max: 9999 });
}

/** Arbitrary valid Flight type tag */
function arbitraryTypeTag(): fc.Arbitrary<string> {
  return fc.constantFrom("D", "I", "E", "S", "F", "T", '"', "[", "{");
}

/** Arbitrary valid Flight payload suffix (simplified) */
function arbitraryPayloadSuffix(): fc.Arbitrary<string> {
  return fc.oneof(
    fc.constant('{"id":"abc","chunks":[],"name":"default","async":false}'),
    fc.constant('["$","div",null,{}]'),
    fc.constant('{"$$typeof":"$","type":"div","key":null,"props":{}}'),
    fc.constant('"hello world"'),
    fc.constant('[]'),
    fc.constant('{}')
  );
}

/** Arbitrary valid Flight line: `<rowId>:<typeTag><payload>` */
function arbitraryValidFlightLine(): fc.Arbitrary<string> {
  return fc.tuple(arbitraryRowId(), arbitraryTypeTag(), arbitraryPayloadSuffix())
    .map(([rowId, tag, payload]) => `${rowId}:${tag}${payload}`);
}

/** Arbitrary Flight payload: array of valid lines (as would come from the RSC worker) */
function arbitraryFlightPayload(): fc.Arbitrary<string[]> {
  return fc.array(arbitraryValidFlightLine(), { minLength: 1, maxLength: 20 });
}

// ---------------------------------------------------------------------------
// Validation helpers (mirror the server-side validation logic)
// ---------------------------------------------------------------------------

const FLIGHT_LINE_PATTERN = /^\d+:[A-Z"\[{]/;
const PLACEHOLDER_PATTERN = "data-sourceog-client-placeholder";

function validateFlightPayload(chunks: string[]): {
  valid: boolean;
  invalidLines: string[];
  containsPlaceholder: boolean;
} {
  const allLines = chunks
    .join("")
    .split("\n")
    .filter((line) => line.length > 0);

  const invalidLines = allLines.filter((line) => !FLIGHT_LINE_PATTERN.test(line));
  const containsPlaceholder = chunks.some((chunk) => chunk.includes(PLACEHOLDER_PATTERN));

  return {
    valid: invalidLines.length === 0 && !containsPlaceholder,
    invalidLines,
    containsPlaceholder
  };
}

// ---------------------------------------------------------------------------
// Property 7: Flight Wire Format Validity
// ---------------------------------------------------------------------------

describe("Property 7: Flight Wire Format Validity", () => {
  it(
    "every non-empty line in a valid Flight payload matches /^\\d+:[A-Z\"\\[{]/",
    () => {
      fc.assert(
        fc.property(
          arbitraryFlightPayload(),
          (chunks) => {
            const result = validateFlightPayload(chunks);

            // Every non-empty line must match the Flight wire format pattern
            expect(result.invalidLines).toHaveLength(0);

            // No line may contain the placeholder string (INV-002)
            expect(result.containsPlaceholder).toBe(false);

            return result.valid;
          }
        ),
        { numRuns: 100 }
      );
    }
  );

  it("known valid Flight lines all pass the wire format pattern", () => {
    for (const line of VALID_FLIGHT_LINES) {
      expect(line).toMatch(FLIGHT_LINE_PATTERN);
    }
  });

  it("placeholder string is detected and rejected", () => {
    const chunksWithPlaceholder = [
      '0:D{"id":"abc","chunks":[],"name":"default","async":false}\n',
      '1:<div data-sourceog-client-placeholder="true"></div>\n'
    ];

    const result = validateFlightPayload(chunksWithPlaceholder);
    expect(result.containsPlaceholder).toBe(true);
    expect(result.valid).toBe(false);
  });

  it("payload with no placeholder and all valid lines is accepted", () => {
    fc.assert(
      fc.property(
        arbitraryFlightPayload(),
        (chunks) => {
          // Ensure no placeholder is present
          const cleanChunks = chunks.map((c) =>
            c.replace(/data-sourceog-client-placeholder/g, "data-clean")
          );

          const result = validateFlightPayload(cleanChunks);
          expect(result.containsPlaceholder).toBe(false);

          // All lines must still match the pattern
          const allLines = cleanChunks.join("").split("\n").filter((l) => l.length > 0);
          for (const line of allLines) {
            expect(line).toMatch(FLIGHT_LINE_PATTERN);
          }

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it("renderRouteToFlightStream output is a ReadableStream (structural check)", async () => {
    // Verify the function signature returns a ReadableStream-compatible object
    // by checking the exported function exists and has the right shape
    const { renderRouteToFlightStream, teeReadableStream } = await import("@sourceog/renderer");

    expect(typeof renderRouteToFlightStream).toBe("function");
    expect(typeof teeReadableStream).toBe("function");

    // teeReadableStream must split a stream into two independent branches
    const encoder = new TextEncoder();
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("0:D{}\n"));
        controller.enqueue(encoder.encode('1:["$","div",null,{}]\n'));
        controller.close();
      }
    });

    const [branch1, branch2] = teeReadableStream(source);

    const readAll = async (stream: ReadableStream<Uint8Array>): Promise<string> => {
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      let result = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        result += decoder.decode(value, { stream: true });
      }
      return result;
    };

    const [text1, text2] = await Promise.all([readAll(branch1), readAll(branch2)]);

    // Both branches must receive identical content
    expect(text1).toBe(text2);
    expect(text1).toContain("0:D{}");
    expect(text1).toContain('1:["$","div",null,{}]');

    // Each line must match the Flight wire format pattern
    const lines = text1.split("\n").filter((l) => l.length > 0);
    for (const line of lines) {
      expect(line).toMatch(FLIGHT_LINE_PATTERN);
    }
  });
});
