import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { z } from "zod";
import { parseBody, parseQuery, parseHeaders } from "@sourceog/platform";
import { FrameworkError } from "@sourceog/runtime";
import type { SourceOGRequest } from "@sourceog/runtime";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a minimal SourceOGRequest whose bodyJson() resolves to `body`.
 */
function makeRequest(body: unknown): SourceOGRequest {
  return {
    url: new URL("http://localhost/"),
    method: "POST",
    headers: new Headers({ "content-type": "application/json" }),
    cookies: new Map(),
    requestId: "test-id",
    runtime: "node",
    async bodyText() {
      return JSON.stringify(body);
    },
    async bodyJson<T>() {
      return body as T;
    },
  };
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/**
 * Generates a flat record of string keys → string/number/boolean values.
 * This matches a simple Zod object schema we can construct dynamically.
 */
const flatRecordArb: fc.Arbitrary<Record<string, string>> = fc.dictionary(
  fc.string({ minLength: 1, maxLength: 12 }).filter((k) => /^[a-z][a-zA-Z0-9]*$/.test(k)),
  fc.string({ minLength: 0, maxLength: 32 }),
  { minKeys: 1, maxKeys: 6 }
);

// ---------------------------------------------------------------------------
// Property 22: parseBody round trip for valid input
// Validates: Requirements 14.3
// ---------------------------------------------------------------------------

describe("ValidationHelpers — Property 22: parseBody round trip for valid input", () => {
  /**
   * **Validates: Requirements 14.3**
   *
   * For any object that satisfies a Zod schema, parseBody must return the
   * typed value without throwing.
   */
  it("returns the typed value for valid body without throwing", async () => {
    await fc.assert(
      fc.asyncProperty(flatRecordArb, async (record) => {
        // Build a Zod schema that exactly matches the generated record's shape
        const schemaShape: Record<string, z.ZodString> = {};
        for (const key of Object.keys(record)) {
          schemaShape[key] = z.string();
        }
        const schema = z.object(schemaShape);

        const req = makeRequest(record);
        const result = await parseBody(req, schema);

        // Every key in the original record must be present and equal
        for (const [k, v] of Object.entries(record)) {
          if ((result as Record<string, unknown>)[k] !== v) return false;
        }
        return true;
      })
    );
  });

  it("returns the exact value for a simple string schema", async () => {
    const schema = z.object({ name: z.string(), age: z.number() });
    const req = makeRequest({ name: "Alice", age: 30 });
    const result = await parseBody(req, schema);
    expect(result.name).toBe("Alice");
    expect(result.age).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// Property 23: parseBody rejects invalid input
// Validates: Requirements 14.4
// ---------------------------------------------------------------------------

describe("ValidationHelpers — Property 23: parseBody rejects invalid input", () => {
  /**
   * **Validates: Requirements 14.4**
   *
   * For any object that does NOT satisfy the schema, parseBody must throw
   * FrameworkError with code "VALIDATION_FAILED".
   */
  it("throws FrameworkError(VALIDATION_FAILED) for invalid body", async () => {
    // Schema expects { id: number } — we send strings for id to force failure
    const schema = z.object({ id: z.number() });

    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1 }),
        async (invalidId) => {
          const req = makeRequest({ id: invalidId }); // string instead of number
          try {
            await parseBody(req, schema);
            return false; // Should have thrown
          } catch (err) {
            if (!(err instanceof FrameworkError)) return false;
            if (err.code !== "VALIDATION_FAILED") return false;
            // context must contain issues
            if (!Array.isArray(err.context.issues)) return false;
            return true;
          }
        }
      )
    );
  });

  it("throws FrameworkError with issues in context", async () => {
    const schema = z.object({ count: z.number() });
    const req = makeRequest({ count: "not-a-number" });

    await expect(parseBody(req, schema)).rejects.toBeInstanceOf(FrameworkError);

    try {
      await parseBody(req, schema);
    } catch (err) {
      expect(err).toBeInstanceOf(FrameworkError);
      expect((err as FrameworkError).code).toBe("VALIDATION_FAILED");
      expect(Array.isArray((err as FrameworkError).context.issues)).toBe(true);
    }
  });

  it("throws FrameworkError for completely wrong shape", async () => {
    const schema = z.object({ x: z.number(), y: z.number() });
    const req = makeRequest("not an object at all");

    await expect(parseBody(req, schema)).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
  });
});

// ---------------------------------------------------------------------------
// Unit tests for parseQuery and parseHeaders
// ---------------------------------------------------------------------------

describe("parseQuery — unit tests", () => {
  it("returns typed value for valid query params", () => {
    const schema = z.object({ page: z.string(), limit: z.string() });
    const url = new URL("http://localhost/?page=1&limit=10");
    const result = parseQuery(url, schema);
    expect(result.page).toBe("1");
    expect(result.limit).toBe("10");
  });

  it("throws FrameworkError(VALIDATION_FAILED) for missing required param", () => {
    const schema = z.object({ required: z.string() });
    const url = new URL("http://localhost/");
    expect(() => parseQuery(url, schema)).toThrow(FrameworkError);
    try {
      parseQuery(url, schema);
    } catch (err) {
      expect((err as FrameworkError).code).toBe("VALIDATION_FAILED");
    }
  });
});

describe("parseHeaders — unit tests", () => {
  it("returns typed value for valid headers", () => {
    const schema = z.object({ "x-api-key": z.string() });
    const headers = new Headers({ "x-api-key": "secret-key" });
    const result = parseHeaders(headers, schema);
    expect(result["x-api-key"]).toBe("secret-key");
  });

  it("throws FrameworkError(VALIDATION_FAILED) for missing required header", () => {
    const schema = z.object({ authorization: z.string() });
    const headers = new Headers();
    expect(() => parseHeaders(headers, schema)).toThrow(FrameworkError);
    try {
      parseHeaders(headers, schema);
    } catch (err) {
      expect((err as FrameworkError).code).toBe("VALIDATION_FAILED");
    }
  });
});
