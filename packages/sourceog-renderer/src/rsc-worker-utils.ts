 /**
 * sourceog-renderer/src/rsc-worker-utils.ts
 *
 * Pure utility functions for RSC worker that don't depend on React or worker threads.
 * These can be safely tested in any environment.
 */

import { readFileSync, existsSync } from "node:fs";

export type ClientManifestEntry = {
  id?: string;
  name?: string;
  chunks?: string[];
  async?: boolean;
  [key: string]: unknown;
};

export type ClientManifestRecord = Record<string, ClientManifestEntry | unknown>;

export function loadManifestFromPath(manifestPath: string): ClientManifestRecord {
  if (!manifestPath || !existsSync(manifestPath)) {
    return {};
  }

  try {
    const raw = readFileSync(manifestPath, "utf8");
    const parsed = JSON.parse(raw) as ClientManifestRecord;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Normalize the manifest into the map expected by React Flight.
 *
 * Supported inputs:
 * 1. Already-normalized manifest keyed by module reference IDs.
 * 2. A wrapper with `registry`.
 * 3. A path-keyed registry where values contain `id` and `name`.
 *
 * Output keys:
 * - Prefer `entry.id#entry.name`
 * - Also expose `entry.id` for lookups that resolve module root first
 */
export function normalizeClientManifest(input: ClientManifestRecord): Record<string, unknown> {
  const registry =
    input && typeof input.registry === "object" && input.registry
      ? (input.registry as ClientManifestRecord)
      : input;

  const normalized: Record<string, unknown> = {};

  for (const [sourceKey, rawEntry] of Object.entries(registry ?? {})) {
    if (!rawEntry || typeof rawEntry !== "object") continue;

    const entry = rawEntry as ClientManifestEntry;
    const entryId = typeof entry.id === "string" ? entry.id : undefined;
    const entryName =
      typeof entry.name === "string"
        ? entry.name
        : sourceKey.includes("#")
          ? sourceKey.slice(sourceKey.lastIndexOf("#") + 1)
          : "default";

    if (!entryId) continue;

    const normalizedEntry: ClientManifestEntry = {
      ...entry,
      id: entryId,
      name: entryName,
    };

    const compositeKey = `${entryId}#${entryName}`;

    normalized[compositeKey] = normalizedEntry;

    if (!(entryId in normalized)) {
      normalized[entryId] = normalizedEntry;
    }
  }

  return normalized;
}

export function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

export function toSearchParamsObject(query: [string, string][] | undefined): Record<string, string> {
  return Object.fromEntries(query ?? []);
}