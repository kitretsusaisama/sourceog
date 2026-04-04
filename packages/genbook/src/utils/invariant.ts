// packages/genbook/src/utils/invariant.ts
// Alibaba CTO 2027 Standard — Invariant & Assertion Helpers

import { InvariantError } from '../errors/index.js';
import { isProduction } from './env.js';

/**
 * Asserts that a condition is truthy.
 * If the condition is falsy, throws an `InvariantError`.
 * 
 * This function is **always active**, even in production.
 * Use for critical invariants where a violation indicates a logic bug or 
 * unrecoverable state.
 * 
 * @param condition - The condition to check.
 * @param message - The error message (or a function returning the message).
 * @param details - Optional structured metadata to attach to the error.
 * @throws {InvariantError}
 * 
 * @example
 * invariant(user.id, 'User ID is required for this operation');
 * // If user.id is falsy, throws InvariantError.
 */
export function invariant(
  condition: unknown,
  message: string | (() => string),
  details?: Record<string, unknown>
): asserts condition {
  if (condition) return;

  const resolvedMessage = typeof message === 'function' ? message() : message;
  throw new InvariantError(resolvedMessage, details);
}

/**
 * Asserts that a condition is truthy, but only in development or test environments.
 * In production, this function is a no-op (compiled out).
 * 
 * Useful for expensive checks or assumptions that should be validated during
 * development but are too costly for production hot paths.
 * 
 * @param condition - The condition to check.
 * @param message - The error message.
 * @param details - Optional structured metadata.
 * 
 * @example
 * // Validates complex state shape only in dev
 * devInvariant(
 *   state.items.length === state.total, 
 *   'State mismatch: items length must equal total'
 * );
 */
export function devInvariant(
  condition: unknown,
  message: string | (() => string),
  details?: Record<string, unknown>
): asserts condition {
  if (isProduction) return;
  if (condition) return;

  const resolvedMessage = typeof message === 'function' ? message() : message;
  throw new InvariantError(resolvedMessage, details);
}

/**
 * Enforces exhaustiveness checking in switch statements.
 * Ensures that all possible cases are handled at compile time.
 * At runtime, throws an error if an unhandled case slips through.
 * 
 * @param value - The value that should have been handled.
 * @throws {InvariantError}
 * 
 * @example
 * type Action = 'create' | 'update' | 'delete';
 * switch (action) {
 *   case 'create': ...
 *   case 'update': ...
 *   case 'delete': ...
 *   default: exhaustiveCheck(action);
 * }
 */
export function exhaustiveCheck(value: never, details?: Record<string, unknown>): never {
  throw new InvariantError(`Unhandled case: ${JSON.stringify(value)}`, details);
}

/**
 * Asserts that a value is never `null` or `undefined`.
 * Useful for refining types after a loose check.
 * 
 * @param value - The value to check.
 * @param message - The error message if null/undefined.
 * @throws {InvariantError}
 * 
 * @example
 * const user = users.find(u => u.id === id);
 * assertDefined(user, 'User not found'); // user is now typed as User, not User | undefined
 */
export function assertDefined<T>(
  value: T | null | undefined,
  message: string | (() => string)
): asserts value is T {
  if (value !== null && value !== undefined) return;
  
  const resolvedMessage = typeof message === 'function' ? message() : message;
  throw new InvariantError(resolvedMessage);
}