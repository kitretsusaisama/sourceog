// packages/genbook/src/index.ts
// Alibaba CTO 2027 Standard — Public API Surface

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------
export { SourceOGBaseError } from './errors/base.js';
export type { ErrorCategory, ErrorSeverity } from './errors/base.js';

export * from './errors/core.errors.js';
export * from './errors/render.errors.js';
export * from './errors/transpile.errors.js';
export * from './errors/manifest.errors.js';
export * from './errors/worker.errors.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export * from './types/index.js';

// ---------------------------------------------------------------------------
// ADOSF-X Domains
// ---------------------------------------------------------------------------
export * from './policy/index.js';
export * from './graph/index.js';
export * from './optimistic/index.js';
export * from './resilience/index.js';
export * from './observability/index.js';

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
export * from './utils/index.js';
