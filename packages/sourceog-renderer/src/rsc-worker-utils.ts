// sourceog-renderer/src/rsc-worker-utils.ts
// Alibaba CTO 2027 Standard — Legacy Utility Compatibility Layer (DEPRECATED)
//
// **MIGRATION CRITICAL**: Maintained solely for v1→v2 backward compatibility.
// All functionality migrated to canonical locations with production-grade
// implementations (caching, error domains, path resolution).
//
// MAPPING TABLE:
// ┌──────────────────────┬─────────────────────────────────────┐
// │ DEPRECATED            │ REPLACEMENT (v2)                   │
// ├──────────────────────┼─────────────────────────────────────┤
// │ loadManifestFromPath  │ manifestContentCache (manifests/)  │
// │ normalizeClientManifest│ client-reference-manifest.ts      │
// │ toError              │ core/errors.ts                      │
// │ toSearchParamsObject │ core/urls.ts                        │
// └──────────────────────┴─────────────────────────────────────┘

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { logger } from './core/logger.js';
import type { ClientManifestEntry } from '@sourceog/genbook';

export type ClientManifestRecord = Record<string, ClientManifestEntry | unknown>;

/**
 * @deprecated Use `manifestContentCache.get()` from `./manifests/manifest-cache.ts`
 * 
 * Legacy synchronous manifest loader. Bypasses v2 LRU caching.
 * Included for compatibility only; does not respect cache eviction.
 */
export function loadManifestFromPath(manifestPath: string): Record<string, unknown> {
  if (!manifestPath) {
    return {};
  }

  const resolvedPath = manifestPath.startsWith('file://')
    ? fileURLToPath(manifestPath)
    : manifestPath;

  try {
    const raw = readFileSync(resolvedPath, 'utf-8');
    const parsed = JSON.parse(raw);
    
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
    
    return {};
  } catch {
    return {};
  }
}

/**
 * @deprecated Use `normalizeClientManifest()` from `./manifests/client-reference-manifest.ts`
 * 
 * Re-export for legacy consumers. Delegates to canonical v2 normalizer.
 */
export { normalizeClientManifest } from './manifests/client-reference-manifest.js';

/**
 * @deprecated Use `toError()` from `./core/errors.ts`
 * 
 * Re-export for legacy error normalization.
 */
export { toError } from './core/errors.js';

/**
 * @deprecated Use `toSearchParamsObject()` from `./core/urls.ts`
 * 
 * Legacy URLSearchParams conversion. Preserved signature for compatibility.
 */
export function toSearchParamsObject(
  query: [string, string][] | undefined
): Record<string, string> {
  if (!query || !Array.isArray(query)) {
    logger.warn('Legacy toSearchParamsObject: invalid input', { type: typeof query });
    return {};
  }

  try {
    return Object.fromEntries(query);
  } catch (error) {
    logger.error('Legacy toSearchParamsObject failed', { 
      queryLength: query.length, 
      error 
    });
    return {};
  }
}

// ---------------------------------------------------------------------------
// BACKWARD COMPATIBILITY EXPORTS
// ---------------------------------------------------------------------------

/** @deprecated Use from '@sourceog/genbook' directly */
export type { ClientManifestEntry };

/**
 * @deprecated Remove direct usage. All v2 code uses canonical imports.
 */
export const LEGACY_MIGRATION_NOTICE = {
  since: 'v2.0.0 (2026-01)',
  removalTarget: 'v3.0.0 (2026-Q4)',
  docs: 'https://sourceog.dev/renderer/v2/migration#rsc-worker-utils',
  replacementSummary: `
    🔄 loadManifestFromPath → manifestContentCache.get()
    🔄 normalizeClientManifest → ./manifests/client-reference-manifest.ts
    🔄 toError → ./core/errors.ts::toError()
    🔄 toSearchParamsObject → ./core/urls.ts::toSearchParamsObject()
  `,
} as const;
