// sourceog-renderer/src/manifests/manifest-resolver.ts
// Alibaba CTO 2027 Standard — Manifest Path Resolution

import path from 'node:path';
import { existsSync } from 'node:fs';
import { CompilerError } from '../core/errors.js';
import { PROJECT_ROOT, MANIFEST_CACHE_MAX } from '../core/constants.js';
import { logger } from '../core/logger.js';

/**
 * Simple LRU cache implementation for manifest paths.
 * Bounded to prevent unbounded memory growth in projects with thousands of routes.
 */
class ManifestPathCache {
  private cache = new Map<string, string | null>();
  private readonly max: number;

  constructor(max: number) {
    this.max = max;
  }

  get(key: string): string | null | undefined {
    if (!this.cache.has(key)) return undefined;

    const value = this.cache.get(key) ?? null;

    // Re-insert to mark as recently used (LRU logic)
    this.cache.delete(key);
    this.cache.set(key, value);

    return value;
  }

  set(key: string, value: string | null): void {
    if (this.cache.has(key)) this.cache.delete(key);

    this.cache.set(key, value);

    if (this.cache.size > this.max) {
      // Evict oldest (first item in Map iterator)
      const oldest = this.cache.keys().next().value;
      if (oldest) this.cache.delete(oldest);
    }
  }

  clear(): void {
    this.cache.clear();
  }
}

const manifestPathCache = new ManifestPathCache(MANIFEST_CACHE_MAX);

/**
 * Resolves the client-reference manifest path for a specific route file.
 *
 * Search Strategy:
 * 1. Check cache.
 * 2. Walk up directory tree from route file to project root.
 * 3. Look for:
 *    - `.sourceog/manifests/client-reference-manifest.json`
 *    - `.sourceog/client-reference-manifest.json`
 * 4. Fallback to project root manifests.
 *
 * Security:
 * - Enforces strict boundary checks to prevent path traversal outside PROJECT_ROOT.
 *
 * @param routeFile - Absolute or relative path to the route file.
 * @returns The resolved absolute path to the manifest, or undefined if not found.
 */
export function resolveManifestPathForRouteFile(
  routeFile: string,
): string | undefined {
  // 1. Check Cache
  const cached = manifestPathCache.get(routeFile);
  if (cached !== undefined) return cached ?? undefined;

  const normalizedRoot = PROJECT_ROOT + path.sep;
  const resolvedRouteFile = path.resolve(routeFile);

  // 2. Security Boundary Check
  if (
    path.isAbsolute(routeFile) &&
    !resolvedRouteFile.startsWith(normalizedRoot) &&
    resolvedRouteFile !== PROJECT_ROOT
  ) {
    throw new CompilerError(
      "MANIFEST_PATH_TRAVERSAL",
      `Manifest path resolution rejected for "${routeFile}" outside project root "${PROJECT_ROOT}".`,
      { routeFile, projectRoot: PROJECT_ROOT },
    );
  }

  // 3. Walk Up Directory Tree
  let currentDir = path.dirname(resolvedRouteFile);
  let previousDir = '';

  while (
    currentDir &&
    currentDir !== previousDir &&
    (currentDir.startsWith(normalizedRoot) || currentDir === PROJECT_ROOT)
  ) {
    const candidates = [
      path.join(
        currentDir,
        '.sourceog',
        'manifests',
        'client-reference-manifest.json',
      ),
      path.join(currentDir, '.sourceog', 'client-reference-manifest.json'),
    ];

    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        logger.debug('Manifest resolved for route file', {
          routeFile,
          manifestPath: candidate,
        });
        manifestPathCache.set(routeFile, candidate);
        return candidate;
      }
    }

    previousDir = currentDir;
    currentDir = path.dirname(currentDir);
  }

  // 4. Fallback to Project Root
  const rootCandidates = [
    path.join(
      PROJECT_ROOT,
      '.sourceog',
      'manifests',
      'client-reference-manifest.json',
    ),
    path.join(PROJECT_ROOT, '.sourceog', 'client-reference-manifest.json'),
  ];

  for (const candidate of rootCandidates) {
    if (existsSync(candidate)) {
      manifestPathCache.set(routeFile, candidate);
      return candidate;
    }
  }

  // Not found
  manifestPathCache.set(routeFile, null);
  return undefined;
}

/**
 * Clears the manifest path cache.
 * Useful for hot-reloading or testing.
 */
export function clearManifestCache(): void {
  const cache = manifestPathCache as unknown;
  if (cache && typeof (cache as { clear: unknown }).clear === 'function') {
    (cache as { clear(): void }).clear();
  }
}
