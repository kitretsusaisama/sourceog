// sourceog-renderer/src/utils/import-path.ts
// Alibaba CTO 2027 Standard — Import Specifier Utilities

import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Regular expression to match specifiers that are already valid URL protocols.
 * Matches: node:*, data:*, file:*
 */
const PROTOCOL_PATTERN = /^(node:|data:|file:)/i;

/**
 * Converts a file path or specifier to a valid ESM import specifier.
 * 
 * Handles:
 * 1. Protocol URLs (node:, data:, file:) -> Returned as-is.
 * 2. Absolute file paths -> Converted to file:// URL.
 * 3. Relative paths (./, ../) and bare specifiers -> Returned as-is.
 * 
 * @param specifier - The file path or import specifier.
 * @returns A string compatible with dynamic `import()`.
 */
export function toImportSpecifier(specifier: string): string {
  // 1. Protocol URLs are already valid for import()
  if (PROTOCOL_PATTERN.test(specifier)) {
    return specifier;
  }

  // 2. Absolute file paths need strict file:// URL conversion
  // This is critical for Windows paths (C:\...) which 'import()' cannot handle natively.
  if (path.isAbsolute(specifier)) {
    return pathToFileURL(specifier).href;
  }

  // 3. Relative or bare specifiers (e.g., 'lodash', './lib')
  // These are valid import targets and should be returned unchanged.
  return specifier;
}

/**
 * Safely imports a module from a given path or specifier.
 * 
 * This function abstracts the complexity of handling different path formats
 * (Windows absolute paths, file URLs, etc.) when using dynamic imports.
 * 
 * @typeParam T - The expected type of the module exports. Defaults to `unknown`.
 * @param specifier - The file path or import specifier.
 * @returns A Promise resolving to the module exports.
 * @throws {Error} If the import fails (e.g., module not found).
 */
export async function importFromPath<T = unknown>(specifier: string): Promise<T> {
  const url = toImportSpecifier(specifier);
  return import(url) as Promise<T>;
}