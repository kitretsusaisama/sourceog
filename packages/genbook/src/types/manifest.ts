// packages/genbook/src/types/manifest.ts
// Alibaba CTO 2027 Standard — Manifest Type Contracts

/**
 * Describes a single client reference entry within the manifest.
 * This maps a server-facing module reference to its client-side chunk.
 */
export interface ClientManifestEntry {
  /** The unique module identifier (e.g., "app/page.tsx"). */
  id: string;

  /** The export name used to access the component (e.g., "default", "Header"). */
  name: string;

  /** List of chunk files required to load this component on the client. */
  chunks: string[];

  /** Indicates if the component is asynchronously loaded. */
  async?: boolean;

  /** Optional path to the source file for debugging or source maps. */
  filepath?: string;
}

/**
 * The raw structure of the client-reference-manifest.json file.
 * This can be a flat map or a nested object containing a registry.
 */
export type ClientReferenceManifestInput = 
  | Record<string, ClientManifestEntry | unknown>
  | {
      registry?: Record<string, ClientManifestEntry | unknown>;
      [key: string]: unknown;
    };

/**
 * The normalized, validated manifest structure used internally by the renderer.
 * Keys are composite identifiers: `${id}#${name}`.
 */
export type NormalizedClientManifest = Record<string, ClientManifestEntry>;

/**
 * Describes server action references (React Server Actions).
 * Used for mapping action IDs to server-side functions.
 */
export interface ServerManifestEntry {
  id: string;
  chunks: string[];
  name: string;
  async?: boolean;
}

export type ServerReferenceManifest = Record<string, ServerManifestEntry>;

/**
 * Describes a static asset (CSS, Font, Image) associated with a route.
 */
export interface AssetManifestEntry {
  /** The logical module path. */
  module?: string;
  
  /** The resolved public URL path. */
  href: string;

  /** Type of asset for preload/preload hints. */
  type: 'style' | 'script' | 'font' | 'image';
}

/**
 * The composite manifest structure passed to the render context.
 */
export interface RouteManifests {
  clientReference: NormalizedClientManifest;
  serverReference?: ServerReferenceManifest;
  assets?: AssetManifestEntry[];
}