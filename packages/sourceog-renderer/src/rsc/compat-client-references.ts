// sourceog-renderer/src/rsc/compat-client-references.ts
// Alibaba CTO 2027 Standard — Client Reference Extraction

import type {
  NormalizedClientManifest,
  ClientManifestEntry,
} from '@sourceog/genbook';

/**
 * Extracts the list of client reference IDs used during a render.
 *
 * In a full implementation, this would track modules actually imported during
 * the render pass. For RSC, the manifest maps server components and client
 * boundaries to module identifiers, so we can conservatively return all keys.
 *
 * The manifest keys are composite IDs in the form `moduleId#exportName`
 * or module root keys for default exports.
 */
export function extractClientReferences(
  manifest: NormalizedClientManifest,
): string[] {
  // The manifest keys themselves are the composite ids `id#name`.
  // Returning them allows the client runtime to look up module references.
  return Object.keys(manifest);
}

/**
 * Validates that a specific client reference exists in the manifest.
 *
 * This is useful for:
 * 1. Preload and prefetch hint generation.
 * 2. Error boundaries when a dynamic import or client boundary hydrate fails.
 *
 * Resolution strategy:
 * - First try the composite key `moduleId#exportName`.
 * - Fallback to the module root key `moduleId` (default export).
 */
export function validateClientReference(
  moduleId: string,
  exportName: string,
  manifest: NormalizedClientManifest,
): ClientManifestEntry | null {
  const compositeKey = `${moduleId}#${exportName}`;

  if (manifest[compositeKey]) {
    return manifest[compositeKey];
  }

  // Fallback to module root lookup (default export or single export modules)
  if (manifest[moduleId]) {
    return manifest[moduleId];
  }

  return null;
}