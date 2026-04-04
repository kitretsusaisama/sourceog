// packages/genbook/src/utils/hashing.ts
// Alibaba CTO 2027 Standard — Deterministic Key Derivation

import { createHash } from 'node:crypto';

/**
 * Generates a SHA256 hash for a given string input.
 * 
 * @param input - The string content to hash.
 * @returns The full 64-character hex digest.
 */
export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Generates a short, URL-safe ID derived from the input content.
 * Useful for generating request IDs or short cache keys where collision risk is low.
 * 
 * @param input - The string content to hash.
 * @param length - The length of the resulting ID (default: 16).
 * @returns A shortened hex digest.
 */
export function shortId(input: string, length = 16): string {
  // Default 16 chars provides 64 bits of entropy, sufficient for unique IDs in a single context.
  return sha256(input).slice(0, length);
}

/**
 * Derives a canonical, collision-resistant key from multiple string parts.
 * Uses a delimiter to prevent collision attacks (e.g. "a" + "bc" vs "ab" + "c").
 * 
 * @param parts - Array of strings to combine into a key.
 * @returns A SHA256 hash of the combined parts.
 */
export function deriveKey(...parts: string[]): string {
  return sha256(parts.join('::'));
}

/**
 * Derives a stable ID for a specific route pattern and parameter set.
 * Ensures that route params are sorted for determinism.
 * 
 * @param routePattern - The route pattern (e.g., "/blog/[slug]").
 * @param params - The route parameters object.
 * @returns A 12-character unique ID for the route instance.
 */
export function deriveCanonicalRouteId(
  routePattern: string,
  params: Record<string, string | string[] | undefined>
): string {
  const sortedKeys = Object.keys(params).sort();
  const stableParams = sortedKeys.map((key) => {
    const value = params[key];
    const serialized = Array.isArray(value) ? value.join('/') : (value ?? '');
    return `${key}=${serialized}`;
  }).join('&');

  return shortId(`${routePattern}?${stableParams}`, 12);
}

/**
 * Derives the render context key used to identify specific rendering states
 * (e.g., canonical vs. intercepted routes).
 * 
 * @param pathname - The request pathname.
 * @param intercepted - Whether the route is intercepted.
 * @returns A 16-character unique context key.
 */
export function deriveRenderContextKey(
  pathname: string,
  intercepted: boolean
): string {
  return shortId(`canonical:${pathname}:${String(intercepted)}`, 16);
}

/**
 * Computes a hash for a JSON-serializable object.
 * Ensures keys are sorted for deterministic serialization.
 * 
 * @param obj - The object to hash.
 * @returns A SHA256 hash of the object's stable JSON representation.
 */
export function hashObject(obj: object): string {
  // JSON.stringify is deterministic in V8 for same key order, 
  // but explicit sorting is safer for cross-runtime consistency.
  const str = JSON.stringify(obj, Object.keys(obj).sort());
  return sha256(str);
}