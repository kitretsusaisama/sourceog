import { ZodSchema } from "zod";
import type { SourceOGRequest } from "@sourceog/runtime";
export type ReadonlyHeaders = Headers;
/**
 * Reads `req.bodyJson()` once, then validates the result against `schema`.
 *
 * On success: returns the typed, validated value.
 * On Zod failure: throws `FrameworkError(code: "VALIDATION_FAILED")` with
 *   the Zod issues in `context.issues`.
 *
 * Requirements: 14.3, 14.4
 */
export declare function parseBody<T>(req: SourceOGRequest, schema: ZodSchema<T>): Promise<T>;
/**
 * Extracts query parameters from a `URL` as a plain object, then validates
 * against `schema`.
 *
 * On success: returns the typed, validated value.
 * On Zod failure: throws `FrameworkError(code: "VALIDATION_FAILED")`.
 *
 * Requirements: 14.3, 14.4
 */
export declare function parseQuery<T>(url: URL, schema: ZodSchema<T>): T;
/**
 * Extracts headers from a `Headers` object as a plain object, then validates
 * against `schema`.
 *
 * On success: returns the typed, validated value.
 * On Zod failure: throws `FrameworkError(code: "VALIDATION_FAILED")`.
 *
 * Requirements: 14.3, 14.4
 */
export declare function parseHeaders<T>(headers: ReadonlyHeaders, schema: ZodSchema<T>): T;
