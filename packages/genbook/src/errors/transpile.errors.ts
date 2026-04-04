// packages/genbook/src/errors/transpile.errors.ts
// Alibaba CTO 2027 Standard — Transpilation & Module Loading Errors

import { SourceOGBaseError, ErrorCategory, ErrorSeverity } from './base.js';

/**
 * Base class for errors occurring during the transformation or loading of modules.
 * These errors indicate a build-time or runtime transpilation failure.
 */
export abstract class TranspileBaseError extends SourceOGBaseError {
  public readonly category: ErrorCategory = 'transpile';
  public readonly severity: ErrorSeverity = 'high';
  public readonly isFatal: boolean = false;
}

/**
 * Thrown when a specific transpiler strategy (e.g., esbuild, swc, sucrase) fails
 * to transform a file.
 */
export class TransformStrategyError extends TranspileBaseError {
  public readonly code = 'TRANSFORM_STRATEGY_FAILED';

  constructor(
    public readonly strategy: string,
    public readonly filepath: string,
    cause: unknown
  ) {
    const errorMessage = cause instanceof Error ? cause.message : String(cause);
    super(
      `Strategy "${strategy}" failed to transform "${filepath}": ${errorMessage}`,
      { cause, metadata: { strategy, filepath } }
    );
  }

  public override get resolutionHint(): string {
    const hints: Record<string, string> = {
      esbuild: 'Check for unsupported syntax or ensure "esbuild" is installed correctly.',
      swc: 'Check for malformed decorators or ensure "@swc/core" bindings are not missing.',
      sucrase: 'Check for ambiguous syntax or ensure "sucrase" is installed.',
      typescript: 'Check for type errors or unsupported TypeScript version features.',
    };
    return hints[this.strategy] ?? `Verify the source file "${this.filepath}" for syntax errors.`;
  }
}

/**
 * Thrown when a module cannot be loaded, typically due to missing files or
 * unresolved imports after transpilation.
 */
export class ModuleLoadError extends TranspileBaseError {
  public readonly code = 'MODULE_LOAD_FAILED';

  constructor(
    public readonly specifier: string,
    public readonly filepath: string,
    cause: unknown
  ) {
    const errorMessage = cause instanceof Error ? cause.message : String(cause);
    super(
      `Failed to load module "${specifier}" from "${filepath}": ${errorMessage}`,
      { cause, metadata: { specifier, filepath } }
    );
  }

  public override get resolutionHint(): string {
    return `Verify that the file exists at "${this.filepath}" and exports are correct. Check for circular dependencies.`;
  }
}

/**
 * Thrown when an import specifier cannot be resolved to a file path
 * (e.g., bare specifiers without a package.json or invalid relative paths).
 */
export class ResolverError extends TranspileBaseError {
  public readonly code = 'MODULE_RESOLVE_FAILED';
  public readonly isFatal = true; // Resolution failures usually block execution entirely

  constructor(
    public readonly specifier: string,
    public readonly contextPath: string
  ) {
    super(
      `Cannot resolve module "${specifier}" from "${contextPath}".`,
      { metadata: { specifier, contextPath } }
    );
  }

  public override get resolutionHint(): string {
    if (this.specifier.startsWith('.')) {
      return 'Verify the relative path is correct. Did you miss a file extension (e.g., .js, .tsx)?';
    }
    return `Ensure the package "${this.specifier}" is installed in "node_modules" and has valid "exports" in package.json.`;
  }
}

/**
 * Thrown when the system cannot find a suitable transpiler for a given file extension
 * or environment configuration.
 */
export class NoTranspilerError extends TranspileBaseError {
  public readonly code = 'NO_TRANSPILER_AVAILABLE';
  public readonly severity: ErrorSeverity = 'critical';

  constructor(
    public readonly extension: string,
    public readonly attemptedStrategies: string[]
  ) {
    super(
      `No transpiler available for extension "${extension}". Attempted strategies: [${attemptedStrategies.join(', ')}].`,
      { metadata: { extension, attemptedStrategies } }
    );
  }

  public override get resolutionHint(): string {
    return 'Install a transformer like "tsx", "esbuild", or "sucrase". Alternatively, use Node.js v22+ with "--experimental-transform-types".';
  }
}

/**
 * Alias for TranspileBaseError for consumers expecting a concrete `TranspileError`.
 */
export class TranspileError extends TranspileBaseError {
  public readonly code: string;

  constructor(code: string, message: string, metadata?: Record<string, unknown>) {
    super(message, { metadata });
    this.code = code;
  }
}