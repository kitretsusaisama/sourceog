// sourceog-renderer/src/manifests/client-reference-manifest.ts
// Alibaba CTO 2027 Standard — Client Manifest Normalization

import type {
  ClientReferenceManifestInput,
  NormalizedClientManifest,
  ClientManifestEntry,
} from '@sourceog/genbook';

/**
 * Normalizes the raw manifest input into a consistent key-value record.
 *
 * Input formats supported:
 * 1. `{ "registry": { ... } }` wrapper.
 * 2. Flat key-value map.
 * 3. Path-keyed entries where the entry itself contains `id` and `name`.
 *
 * Output keys:
 * - `${id}#${name}` (Composite key for exact lookup)
 * - `${id}` (Module root lookup)
 */
export function normalizeClientManifest(
  input: ClientReferenceManifestInput,
): NormalizedClientManifest {
  const registry =
    input &&
    typeof input === 'object' &&
    'registry' in input &&
    (input as { registry?: unknown }).registry
      ? (input as { registry: Record<string, unknown> }).registry
      : (input as Record<string, unknown>);

  const normalized: NormalizedClientManifest = {};

  if (!registry || typeof registry !== 'object') return normalized;

  for (const sourceKey in registry) {
    if (!Object.prototype.hasOwnProperty.call(registry, sourceKey)) continue;

    const rawEntry = (registry as Record<string, unknown>)[sourceKey];
    if (!rawEntry || typeof rawEntry !== 'object') continue;

    const entry = rawEntry as Partial<ClientManifestEntry>;
    const id = entry.id;
    if (!id) continue;

    // indexOf instead of split — no intermediate array allocation
    let name = entry.name;
    if (!name) {
      const hashIdx = sourceKey.indexOf('#');
      name = hashIdx !== -1 ? sourceKey.slice(hashIdx + 1) : 'default';
    }

    const normalizedEntry: ClientManifestEntry = {
      id,
      name,
      chunks: entry.chunks ?? [],
      async: entry.async ?? false,
      filepath: entry.filepath,
    };

    normalized[`${id}#${name}`] = normalizedEntry;
    normalized[id] = normalizedEntry;
  }

  return normalized;
}