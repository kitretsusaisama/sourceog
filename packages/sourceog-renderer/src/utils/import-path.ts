// packages/sourceog-renderer/src/utils/import-path.ts
import path from "node:path";
import { pathToFileURL } from "node:url";

export function toImportSpecifier(specifier: string): string {
  if (/^(node:|data:|file:)/.test(specifier)) {
    return specifier;
  }

  if (path.isAbsolute(specifier)) {
    return pathToFileURL(specifier).href;
  }

  return specifier;
}

export async function importFromPath<T = unknown>(
  specifier: string
): Promise<T> {
  return import(toImportSpecifier(specifier)) as Promise<T>;
} 