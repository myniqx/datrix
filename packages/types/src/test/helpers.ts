/**
 * Test Helper Functions
 *
 * Utility functions to simplify test writing
 */

import { Result } from 'forja-types/utils';
import { expect } from 'vitest';


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
