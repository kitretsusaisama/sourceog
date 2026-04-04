// sourceog-renderer/src/core/hashing.ts
// Alibaba CTO 2027 Standard — Core Hashing Utilities
//
// This module intentionally re-exports the shared hashing primitives from
// @sourceog/genbook to ensure deterministic, collision-resistant keys across
// all packages (renderer, planner, platform, etc.).
//
// DO NOT introduce ad-hoc hashing helpers in this package.
// Always extend the shared Genbook utilities instead.

export {
  /**
   * Low-level SHA256 hashing helper.
   * Used primarily for long-lived cache keys and integrity checks.
   */
  sha256,

  /**
   * Short, URL-safe identifier derived from content.
   * Used for request IDs, span IDs, and short cache keys.
   */
  shortId,

  /**
   * Canonical key derivation from multiple string parts.
   * Prevents collisions like "a" + "bc" vs "ab" + "c".
   */
  deriveKey,

  /**
   * Stable, collision-resistant route identifier.
   * Used for manifest lookup and worker pool partitioning.
   */
  deriveCanonicalRouteId,

  /**
   * Stable key for render context (route + locale + query, etc.).
   * Used by the orchestrator for pooling and cache bucketing.
   */
  deriveRenderContextKey,

  /**
   * Deterministic object hashing for config and planning inputs.
   */
  hashObject,
} from '@sourceog/genbook';