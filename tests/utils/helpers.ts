/**
 * Test Helper Functions
 *
 * Utility functions to simplify test writing
 */

import { expect } from 'vitest';
import type { ValidationError } from '@core/validator/types';
import type { Result } from '@utils/types';

/**
 * Assert that a validation result is successful
 */
export function expectSuccess<T>(result: Result<T, ValidationError[]>): asserts result is { success: true; data: T } {
  expect(result.success).toBe(true);
  if (!result.success) {
    throw new Error(`Expected success but got errors: ${JSON.stringify(result.error)}`);
  }
}

/**
 * Assert that a validation result is a failure
 */
export function expectFailure<T>(result: Result<T, ValidationError[]>): asserts result is { success: false; error: ValidationError[] } {
  expect(result.success).toBe(false);
  if (result.success) {
    throw new Error(`Expected failure but got success with data: ${JSON.stringify(result.data)}`);
  }
}

/**
 * Assert that validation errors contain a specific error code
 */
export function expectErrorCode(
  errors: ValidationError[],
  code: ValidationError['code']
): void {
  const hasCode = errors.some((err) => err.code === code);
  expect(hasCode).toBe(true);
  if (!hasCode) {
    const codes = errors.map((err) => err.code).join(', ');
    throw new Error(`Expected error code '${code}' but got: ${codes}`);
  }
}

/**
 * Assert that validation errors contain a specific field error
 */
export function expectFieldError(
  errors: ValidationError[],
  field: string,
  code?: ValidationError['code']
): void {
  const fieldError = errors.find((err) => err.field === field);
  expect(fieldError).toBeDefined();

  if (code) {
    expect(fieldError?.code).toBe(code);
  }
}

/**
 * Assert that there are exactly N errors
 */
export function expectErrorCount(
  errors: ValidationError[],
  count: number
): void {
  expect(errors).toHaveLength(count);
}

/**
 * Create a mock date for consistent testing
 */
export function createMockDate(dateString?: string): Date {
  return new Date(dateString || '2024-01-01T00:00:00.000Z');
}

/**
 * Assert deep equality for objects (useful for complex types)
 */
export function expectDeepEqual<T>(actual: T, expected: T): void {
  expect(JSON.stringify(actual)).toBe(JSON.stringify(expected));
}

/**
 * Measure function execution time (for performance tests)
 */
export async function measureExecutionTime<T>(
  fn: () => T | Promise<T>
): Promise<{ result: T; duration: number }> {
  const start = performance.now();
  const result = await fn();
  const end = performance.now();
  const duration = end - start;
  return { result, duration };
}

/**
 * Assert that a function executes within a time limit
 */
export async function expectWithinTimeLimit<T>(
  fn: () => T | Promise<T>,
  maxMs: number
): Promise<T> {
  const { result, duration } = await measureExecutionTime(fn);
  expect(duration).toBeLessThan(maxMs);
  return result;
}

/**
 * Create a range of numbers for testing (useful for boundary tests)
 */
export function range(start: number, end: number): number[] {
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

/**
 * Generate random string for testing
 */
export function randomString(length: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return Array.from({ length }, () => chars.charAt(Math.floor(Math.random() * chars.length))).join('');
}

/**
 * Generate random email for testing
 */
export function randomEmail(): string {
  return `${randomString(8)}@example.com`;
}

/**
 * Assert that an object has specific keys
 */
export function expectKeys<T extends Record<string, unknown>>(
  obj: T,
  keys: (keyof T)[]
): void {
  const objKeys = Object.keys(obj);
  expect(objKeys.sort()).toEqual([...keys].sort());
}

/**
 * Assert that a value is of a specific type
 */
export function expectType<T>(
  value: unknown,
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'date' | 'null' | 'undefined'
): asserts value is T {
  if (type === 'array') {
    expect(Array.isArray(value)).toBe(true);
  } else if (type === 'date') {
    expect(value instanceof Date).toBe(true);
  } else if (type === 'null') {
    expect(value).toBeNull();
  } else if (type === 'undefined') {
    expect(value).toBeUndefined();
  } else {
    expect(typeof value).toBe(type);
  }
}
