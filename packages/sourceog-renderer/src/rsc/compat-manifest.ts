// sourceog-renderer/src/rsc/compat-manifest.ts
// Alibaba CTO 2027 Standard — Client Manifest Compatibility Shim
//
// This module provides a stable façade for normalizing client reference
// manifests used by the RSC worker runtime. It bridges older call-sites
// (which may pass a variety of shapes) to the canonical
// `NormalizedClientManifest` format produced by the shared Genbook types.

import type {
  ClientReferenceManifestInput,
  NormalizedClientManifest,
} from '@sourceog/genbook';
import { normalizeClientManifest as coreNormalizeClientManifest } from '../manifests/client-reference-manifest.js';
import { logger } from '../core/logger.js';

/**
 * Predicate to determine whether a value looks like a valid
 * `ClientReferenceManifestInput`.
 *
 * This is intentionally permissive: the underlying normalizer is already
 * defensive and can handle the supported shapes.
 */
function isManifestInput(
  value: unknown,
): value is ClientReferenceManifestInput {
  if (!value || typeof value !== 'object') {
    return false;
  }

  // Common patterns:
  // 1) Flat registry map          → { "id#name": { ... } }
  // 2) Wrapped registry           → { registry: { ... } }
  // 3) Path-keyed entries         → { "path/to/file.js": { ... } }
  //
  // We only do a shallow sanity check here; detailed normalization is
  // delegated to `coreNormalizeClientManifest`.
  return true;
}

/**
 * Normalizes an arbitrary manifest-like input into a
 * `NormalizedClientManifest`.
 *
 * Supported inputs match the shapes documented in
 * `src/manifests/client-reference-manifest.ts`:
 * - Registry wrapper: `{ registry: { ... } }`
 * - Flat registry map
 * - Path-keyed entries with embedded `id` / `name`
 *
 * @param input - Raw manifest input from disk, configuration, or worker data.
 * @returns A normalized manifest map keyed by composite id (`id#name`) and
 *          module root (`id`) for fast lookups.
 */
export function normalizeClientManifestCompat(
  input: unknown,
): NormalizedClientManifest {
  if (!isManifestInput(input)) {
    logger.warn('Received non-object client manifest input for normalization', {
      type: typeof input,
    });

    // Delegate to core normalizer with an empty object; it will return an
    // empty `NormalizedClientManifest`, which is safer than throwing in
    // production request paths.
    return coreNormalizeClientManifest({} as ClientReferenceManifestInput);
  }

  return coreNormalizeClientManifest(input);
}

/**
 * Safely normalizes a client manifest, returning `null` instead of throwing
 * on unexpected input or runtime failures.
 *
 * This is intended for legacy integration points where manifest issues should
 * degrade gracefully rather than crash the worker.
 *
 * @param input - Raw manifest input.
 * @returns A normalized manifest or `null` on failure.
 */
export function tryNormalizeClientManifestCompat(
  input: unknown,
): NormalizedClientManifest | null {
  try {
    return normalizeClientManifestCompat(input);
  } catch (error) {
    logger.error('Failed to normalize client manifest', error);
    return null;
  }
}