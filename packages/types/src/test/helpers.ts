/**
 * Test Helper Functions
 *
 * Utility functions to simplify test writing
 */

import { Result } from 'forja-types/utils';
import { expect } from 'vitest';
import { ForjaError } from '../errors/forja-error';


/**
 * Assert Result success and return data (RECOMMENDED)
 *
 * This helper asserts success AND returns typed data, preventing lint errors.
 *
 * @example
 * const data = expectSuccessData(parseWhere({ name: 'John' }));
 * expect(data.operator).toBe('$eq'); // ✅ No lint error
 */
export function expectSuccessData<T, E = unknown>(result: Result<T, E>): T {
  expect(result.success).toBe(true);
  if (!result.success) {
    throw new Error(`Expected success but got error: ${JSON.stringify(result.error)}`);
  }
  return result.data;
}

/**
 * Assert Result failure and return error (RECOMMENDED)
 *
 * This helper asserts failure AND returns typed error, preventing lint errors.
 *
 * @example
 * const error = expectFailureError(parseWhere({ invalid: true }));
 * expect(error.code).toBe('INVALID_OPERATOR'); // ✅ No lint error
 */
export function expectFailureError<T, E = unknown>(result: Result<T, E>): E {
  expect(result.success).toBe(false);
  if (result.success) {
    throw new Error(`Expected failure but got success with data: ${JSON.stringify(result.data)}`);
  }
  return result.error;
}

/**
 * Assert that a function executes within a time limit
 *
 * @example
 * await expectWithinTimeLimit(() => parseWhere({ name: 'John' }), 1);
 */
export async function expectWithinTimeLimit<T>(
  fn: () => T | Promise<T>,
  maxMs: number
): Promise<T> {
  const start = performance.now();
  const result = await fn();
  const end = performance.now();
  const duration = end - start;

  expect(duration).toBeLessThan(maxMs);
  return result;
}

/**
 * Generate random string for testing
 *
 * @example
 * const randomName = randomString(10);
 */
export function randomString(length: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return Array.from({ length }, () => chars.charAt(Math.floor(Math.random() * chars.length))).join('');
}

/**
 * Generate random email for testing
 *
 * @example
 * const randomUserEmail = randomEmail();
 */
export function randomEmail(): string {
  return `${randomString(8)}@example.com`;
}

// ============================================================================
// ForjaError Test Helpers (for throw pattern)
// ============================================================================

/**
 * Expect function to throw a ForjaError with specific code
 *
 * @example
 * expectForjaError(
 *   () => throwInvalidCredentials(),
 *   'AUTH_INVALID_CREDENTIALS'
 * );
 */
export function expectForjaError(
  fn: () => void | Promise<void>,
  expectedCode: string,
): ForjaError {
  let caughtError: unknown;

  try {
    const result = fn();
    if (result instanceof Promise) {
      throw new Error('Use expectForjaErrorAsync for async functions');
    }
  } catch (error) {
    caughtError = error;
  }

  expect(caughtError).toBeInstanceOf(ForjaError);
  const forjaError = caughtError as ForjaError;
  expect(forjaError.code).toBe(expectedCode);

  return forjaError;
}

/**
 * Expect async function to throw a ForjaError with specific code
 *
 * @example
 * await expectForjaErrorAsync(
 *   async () => await someAsyncFunction(),
 *   'ADAPTER_LOCK_TIMEOUT'
 * );
 */
export async function expectForjaErrorAsync(
  fn: () => Promise<void>,
  expectedCode: string,
): Promise<ForjaError> {
  let caughtError: unknown;

  try {
    await fn();
  } catch (error) {
    caughtError = error;
  }

  expect(caughtError).toBeInstanceOf(ForjaError);
  const forjaError = caughtError as ForjaError;
  expect(forjaError.code).toBe(expectedCode);

  return forjaError;
}

/**
 * Expect ForjaError to have specific message pattern
 *
 * @example
 * const error = expectForjaError(() => throwError(), 'ERROR_CODE');
 * expectErrorMessage(error, /invalid/i);
 */
export function expectErrorMessage(
  error: ForjaError,
  messagePattern: string | RegExp,
): void {
  if (typeof messagePattern === 'string') {
    expect(error.message).toContain(messagePattern);
  } else {
    expect(error.message).toMatch(messagePattern);
  }
}

/**
 * Expect ForjaError to have suggestion
 *
 * @example
 * const error = expectForjaError(() => throwError(), 'ERROR_CODE');
 * expectErrorSuggestion(error, 'Check your configuration');
 */
export function expectErrorSuggestion(
  error: ForjaError,
  suggestionPattern?: string | RegExp,
): void {
  expect(error.suggestion).toBeDefined();

  if (suggestionPattern) {
    if (typeof suggestionPattern === 'string') {
      expect(error.suggestion).toContain(suggestionPattern);
    } else {
      expect(error.suggestion).toMatch(suggestionPattern);
    }
  }
}

/**
 * Expect ForjaError to have specific context properties
 *
 * @example
 * const error = expectForjaError(() => throwError(), 'ERROR_CODE');
 * expectErrorContext(error, { field: 'email', value: 'test@test.com' });
 */
export function expectErrorContext(
  error: ForjaError,
  expectedContext: Record<string, unknown>,
): void {
  expect(error.context).toBeDefined();

  for (const [key, value] of Object.entries(expectedContext)) {
    expect(error.context).toHaveProperty(key);
    expect(error.context![key]).toEqual(value);
  }
}

/**
 * Expect ForjaError to have expected/received values
 *
 * @example
 * const error = expectForjaError(() => throwError(), 'ERROR_CODE');
 * expectErrorValues(error, 'valid email', 'invalid-email');
 */
export function expectErrorValues(
  error: ForjaError,
  expected?: string,
  received?: unknown,
): void {
  if (expected !== undefined) {
    expect(error.expected).toBe(expected);
  }

  if (received !== undefined) {
    expect(error.received).toEqual(received);
  }
}

/**
 * Expect ForjaError to have cause (error chaining)
 *
 * @example
 * const error = expectForjaError(() => throwError(), 'ERROR_CODE');
 * expectErrorCause(error);
 */
export function expectErrorCause(error: ForjaError): void {
  expect(error.cause).toBeDefined();
  expect(error.cause).toBeInstanceOf(Error);
}

/**
 * Complete ForjaError assertion with all checks
 *
 * @example
 * expectCompleteError({
 *   fn: () => throwInvalidCredentials(),
 *   code: 'AUTH_INVALID_CREDENTIALS',
 *   message: /invalid email or password/i,
 *   suggestion: 'Check your email and password',
 *   context: { attemptedEmail: 'test@test.com' }
 * });
 */
export function expectCompleteError(options: {
  fn: () => void | Promise<void>;
  code: string;
  message?: string | RegExp;
  suggestion?: string | RegExp;
  context?: Record<string, unknown>;
  expected?: string;
  received?: unknown;
  hasCause?: boolean;
}): ForjaError {
  const error = expectForjaError(options.fn, options.code);

  if (options.message) {
    expectErrorMessage(error, options.message);
  }

  if (options.suggestion) {
    expectErrorSuggestion(error, options.suggestion);
  }

  if (options.context) {
    expectErrorContext(error, options.context);
  }

  if (options.expected !== undefined || options.received !== undefined) {
    expectErrorValues(error, options.expected, options.received);
  }

  if (options.hasCause) {
    expectErrorCause(error);
  }

  return error;
}

/**
 * Complete async ForjaError assertion with all checks
 *
 * @example
 * await expectCompleteErrorAsync({
 *   fn: async () => await someAsyncOp(),
 *   code: 'ADAPTER_LOCK_TIMEOUT',
 *   message: 'Could not acquire lock',
 *   context: { lockTimeout: 5000 }
 * });
 */
export async function expectCompleteErrorAsync(options: {
  fn: () => Promise<void>;
  code: string;
  message?: string | RegExp;
  suggestion?: string | RegExp;
  context?: Record<string, unknown>;
  expected?: string;
  received?: unknown;
  hasCause?: boolean;
}): Promise<ForjaError> {
  const error = await expectForjaErrorAsync(options.fn, options.code);

  if (options.message) {
    expectErrorMessage(error, options.message);
  }

  if (options.suggestion) {
    expectErrorSuggestion(error, options.suggestion);
  }

  if (options.context) {
    expectErrorContext(error, options.context);
  }

  if (options.expected !== undefined || options.received !== undefined) {
    expectErrorValues(error, options.expected, options.received);
  }

  if (options.hasCause) {
    expectErrorCause(error);
  }

  return error;
}
