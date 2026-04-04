import { ZodSchema } from "zod";
import { FrameworkError } from "@sourceog/runtime";
import type { SourceOGRequest } from "@sourceog/runtime";

// ---------------------------------------------------------------------------
// ReadonlyHeaders type alias (Headers is already readonly in the Web API sense)
// ---------------------------------------------------------------------------

export type ReadonlyHeaders = Headers;

// ---------------------------------------------------------------------------
// parseBody
// ---------------------------------------------------------------------------

/**
 * Reads `req.bodyJson()` once, then validates the result against `schema`.
 *
 * On success: returns the typed, validated value.
 * On Zod failure: throws `FrameworkError(code: "VALIDATION_FAILED")` with
 *   the Zod issues in `context.issues`.
 *
 * Requirements: 14.3, 14.4
 */
export async function parseBody<T>(req: SourceOGRequest, schema: ZodSchema<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.bodyJson<unknown>();
  } catch (err) {
    throw new FrameworkError("VALIDATION_FAILED", "Failed to parse request body as JSON.", {
      layer: "platform",
      context: { cause: String(err) },
    });
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new FrameworkError("VALIDATION_FAILED", "Request body failed schema validation.", {
      layer: "platform",
      context: { issues: result.error.issues },
    });
  }

  return result.data;
}

// ---------------------------------------------------------------------------
// parseQuery
// ---------------------------------------------------------------------------

/**
 * Extracts query parameters from a `URL` as a plain object, then validates
 * against `schema`.
 *
 * On success: returns the typed, validated value.
 * On Zod failure: throws `FrameworkError(code: "VALIDATION_FAILED")`.
 *
 * Requirements: 14.3, 14.4
 */
export function parseQuery<T>(url: URL, schema: ZodSchema<T>): T {
  const raw: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    raw[key] = value;
  });

  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new FrameworkError("VALIDATION_FAILED", "Query parameters failed schema validation.", {
      layer: "platform",
      context: { issues: result.error.issues },
    });
  }

  return result.data;
}

// ---------------------------------------------------------------------------
// parseHeaders
// ---------------------------------------------------------------------------

/**
 * Extracts headers from a `Headers` object as a plain object, then validates
 * against `schema`.
 *
 * On success: returns the typed, validated value.
 * On Zod failure: throws `FrameworkError(code: "VALIDATION_FAILED")`.
 *
 * Requirements: 14.3, 14.4
 */
export function parseHeaders<T>(headers: ReadonlyHeaders, schema: ZodSchema<T>): T {
  const raw: Record<string, string> = {};
  headers.forEach((value, key) => {
    raw[key] = value;
  });

  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new FrameworkError("VALIDATION_FAILED", "Headers failed schema validation.", {
      layer: "platform",
      context: { issues: result.error.issues },
    });
  }

  return result.data;
}
