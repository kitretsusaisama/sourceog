// packages/genbook/src/errors/core.errors.ts
// Alibaba CTO 2027 Standard — Core Infrastructure Errors

import { SourceOGBaseError, ErrorCategory, ErrorSeverity } from './base.js';

/**
 * Base class for all core infrastructure errors.
 * These are generally fatal and indicate a misconfiguration or 
 * environment setup failure.
 */
export abstract class CoreBaseError extends SourceOGBaseError {
  public readonly category: ErrorCategory = 'core';
  public readonly severity: ErrorSeverity = 'critical';
  public readonly isFatal = true;
}

/**
 * Thrown when a required environment variable is missing or invalid.
 * 
 * @example
 * if (!process.env.DATABASE_URL) {
 *   throw new EnvError('DATABASE_URL', 'required for connection');
 * }
 */
export class EnvError extends CoreBaseError {
  public readonly code = 'ENV_INVALID';

  constructor(
    public readonly key: string,
    reason: string = 'is missing or invalid'
  ) {
    super(`Environment Error: "${key}" ${reason}.`, {
      metadata: { key, reason },
    });
  }

  public override get resolutionHint(): string {
    return `Verify the environment variable "${this.key}" is set in your .env file or deployment environment.`;
  }
}

/**
 * Thrown when a configuration file (e.g., sourceog.config.ts) fails to parse
 * or contains invalid schema values.
 */
export class ConfigError extends CoreBaseError {
  public readonly code = 'CONFIG_INVALID';

  constructor(
    public readonly configPath: string,
    message: string,
    public readonly invalidKey?: string
  ) {
    super(`Configuration Error in "${configPath}": ${message}`, {
      metadata: { configPath, invalidKey },
    });
  }

  public override get resolutionHint(): string {
    return `Check the syntax and values in "${this.configPath}".` + 
           (this.invalidKey ? ` Focus on the key "${this.invalidKey}".` : '');
  }
}

/**
 * Thrown when an internal invariant is violated.
 * This usually indicates a logic error in the codebase or an 
 * "impossible" state being reached.
 * 
 * Ideally should never be caught in production; use for dev-time assertions.
 */
export class InvariantError extends CoreBaseError {
  public readonly code = 'INVARIANT_VIOLATION';

  constructor(message: string, details?: Record<string, unknown>) {
    super(`Invariant Violation: ${message}`, {
      metadata: details,
    });
  }

  public override get resolutionHint(): string {
    return 'This is likely an internal bug. Please report this issue to the SourceOG team.';
  }
}

/**
 * Generic core error for infrastructure failures not covered by specific types.
 */
export class CoreError extends CoreBaseError {
  public readonly code = 'CORE_FAILURE';

  constructor(
    codeOverride: string,
    message: string,
    metadata?: Record<string, unknown>
  ) {
    super(message, { metadata });
    this.code = codeOverride;
  }
}