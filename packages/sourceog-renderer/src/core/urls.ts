// sourceog-renderer/src/core/urls.ts
// Alibaba CTO 2027 Standard — URL & Path Normalization

import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

/**
 * Normalizes a filesystem path to a `file://` URL.
 * Safe for Windows and Unix paths.
 *
 * @param filepath - Absolute or relative filesystem path.
 * @returns A `file://` URL string.
 */
export function toFileUrl(filepath: string): string {
  if (filepath.startsWith('file://')) return filepath;
  return pathToFileURL(path.resolve(filepath)).href;
}

/**
 * Converts a `file://` URL back to an absolute filesystem path.
 *
 * @param url - A `file://` URL string or plain path.
 * @returns An absolute filesystem path.
 */
export function toFsPath(url: string): string {
  if (!url.startsWith('file://')) return path.resolve(url);
  return fileURLToPath(url);
}

/**
 * Checks if a string is a `file://` URL.
 */
export function isFileUrl(value: string): boolean {
  return typeof value === 'string' && value.startsWith('file://');
}

/**
 * Normalizes a manifest path to a URL suitable for worker communication.
 * Handles absolute paths and ensures a `file://` scheme.
 *
 * @param manifestPath - Filesystem path to the manifest file.
 * @returns A normalized URL string or empty string if no path.
 */
export function toWorkerManifestUrl(manifestPath?: string): string {
  if (!manifestPath) return '';
  return toFileUrl(manifestPath);
}

/**
 * Resolves a relative import specifier against a parent path or URL.
 *
 * - Preserves `file://` and `node:` specifiers as-is.
 * - Handles absolute filesystem paths.
 * - Resolves relative paths against the parent directory.
 *
 * @param specifier - Import specifier (relative path, absolute path, or URL).
 * @param parentPath - Parent file path or `file://` URL.
 * @returns A resolved `file://` URL.
 */
export function resolveImportUrl(specifier: string, parentPath: string): string {
  if (specifier.startsWith('file://') || specifier.startsWith('node:')) {
    return specifier;
  }

  const parentUrl = isFileUrl(parentPath) ? parentPath : toFileUrl(parentPath);
  const parentDir = path.dirname(toFsPath(parentUrl));

  if (path.isAbsolute(specifier)) {
    return toFileUrl(specifier);
  }

  // Relative paths
  return toFileUrl(path.resolve(parentDir, specifier));
}