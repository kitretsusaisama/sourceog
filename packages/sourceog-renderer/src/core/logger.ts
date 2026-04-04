// sourceog-renderer/src/core/logger.ts
// Alibaba CTO 2027 Standard — Structured Logging

import { isProduction, isDebug, isTest } from './env.js';
import type { SourceOGBaseError } from '@sourceog/genbook/errors';

type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'critical';

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  trace: -1,
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  critical: 4,
};

const CURRENT_LOG_LEVEL: LogLevel =
  isProduction ? 'warn' : isTest ? (isDebug ? 'debug' : 'error') : isDebug ? 'debug' : 'info';

/**
 * Formats a log entry for production (JSON) or development (human-readable).
 *
 * In production:
 *   { time, level, msg, ...meta }
 *
 * In development:
 *   [SOURCEOG] [LEVEL] 2024-01-01T00:00:00.000Z: message\n{meta}
 */
function formatEntry(
  level: LogLevel,
  message: string,
  meta?: Record<string, unknown>,
): string {
  const timestamp = new Date().toISOString();

  if (isProduction) {
    return JSON.stringify({
      time: timestamp,
      level,
      msg: message,
      ...meta,
    });
  }

  // Development: pretty print
  const prefix = `[SOURCEOG] [${level.toUpperCase()}]`;
  const metaStr = meta ? `\n${JSON.stringify(meta, null, 2)}` : '';
  return `${prefix} ${timestamp}: ${message}${metaStr}`;
}

/**
 * Extracts safe metadata from an error object.
 *
 * - If it is a SourceOG error, we rely on its toJSON() contract.
 * - Otherwise, we fall back to standard Error fields.
 */
function extractErrorMeta(error: unknown): Record<string, unknown> {
  if (typeof error === 'object' && error !== null) {
    const sgError = error as Partial<SourceOGBaseError>;
    if (sgError.isSourceOGError === true && typeof sgError.toJSON === 'function') {
      return sgError.toJSON() as Record<string, unknown>;
    }

    const err = error as Error;
    return {
      name: err.name,
      message: err.message,
      stack: err.stack,
    };
  }

  return { error: String(error) };
}

export const logger = {
  trace(message: string, meta?: Record<string, unknown>): void {
    if (LOG_LEVEL_PRIORITY.trace < LOG_LEVEL_PRIORITY[CURRENT_LOG_LEVEL]) return;
    console.debug(formatEntry('trace', message, meta));
  },

  debug(message: string, meta?: Record<string, unknown>): void {
    if (LOG_LEVEL_PRIORITY.debug < LOG_LEVEL_PRIORITY[CURRENT_LOG_LEVEL]) return;
    console.debug(formatEntry('debug', message, meta));
  },

  info(message: string, meta?: Record<string, unknown>): void {
    if (LOG_LEVEL_PRIORITY.info < LOG_LEVEL_PRIORITY[CURRENT_LOG_LEVEL]) return;
    console.info(formatEntry('info', message, meta));
  },

  warn(message: string, meta?: Record<string, unknown>): void {
    if (LOG_LEVEL_PRIORITY.warn < LOG_LEVEL_PRIORITY[CURRENT_LOG_LEVEL]) return;
    console.warn(formatEntry('warn', message, meta));
  },

  /**
   * Logs an error with optional structured metadata.
   *
   * The `error` argument is merged into `meta` so log consumers
   * always see a single flattened object.
   */
  error(
    message: string,
    error?: unknown,
    meta?: Record<string, unknown>,
  ): void {
    const errorMeta = error ? extractErrorMeta(error) : {};
    const combinedMeta = { ...meta, ...errorMeta };
    console.error(formatEntry('error', message, combinedMeta));
  },

  critical(
    message: string,
    error?: unknown,
    meta?: Record<string, unknown>,
  ): void {
    const errorMeta = error ? extractErrorMeta(error) : {};
    const combinedMeta = { ...meta, ...errorMeta };
    console.error(formatEntry('critical', message, combinedMeta));
  },
};
