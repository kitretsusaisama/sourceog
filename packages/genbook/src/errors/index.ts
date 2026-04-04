// packages/genbook/src/errors/index.ts
// Alibaba CTO 2027 Standard — Error Aggregator

export { SourceOGBaseError } from './base.js';
export type { ErrorCategory, ErrorSeverity } from './base.js';

export * from './core.errors.js';
export * from './render.errors.js';
export * from './transpile.errors.js';
export * from './manifest.errors.js';
export * from './worker.errors.js';