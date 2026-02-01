/**
 * Test Helper Functions
 *
 * Utility functions to simplify test writing
 */

import { Result } from "../utils";
import { expect } from "vitest";
import { ForjaError } from "../errors/forja-error";
import { ResponseMultiData } from "../api";
import { ForjaEntry, ForjaRecord } from "forja-types/core/schema";

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
  if (result.success === false) {
    console.log("Error", JSON.stringify(result.error, null, 2));
  }
  expect(result.success).toBe(true);
  if (!result.success) {
    throw new Error(
      `Expected success but got error: ${JSON.stringify(result.error)}`,
    );
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
    throw new Error(
      `Expected failure but got success with data: ${JSON.stringify(result.data)}`,
    );
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
  maxMs: number,
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
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  return Array.from({ length }, () =>
    chars.charAt(Math.floor(Math.random() * chars.length)),
  ).join("");
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
      throw new Error("Use expectForjaErrorAsync for async functions");
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
  if (typeof messagePattern === "string") {
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
    if (typeof suggestionPattern === "string") {
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

// ============================================================================
// HTTP API Test Helpers (for Response-based API testing)
// ============================================================================

import type { SerializedForjaError } from "../errors/forja-error";
import type { PaginationMeta } from "../api";

/**
 * Single record API response
 */
export interface ResponseSingleData<T extends ForjaEntry> {
  readonly data: Partial<T>;
}

/**
 * Multiple records API response (with pagination)
 */
export interface ResponseMultiData<T extends ForjaEntry> {
  readonly data: Partial<T>[];
  readonly meta: PaginationMeta;
}

/**
 * API error response with full ForjaError serialization
 */
export interface ApiErrorResponse {
  error: SerializedForjaError;
}

/**
 * Assert API success for single record and return data
 *
 * @example
 * const user = await expectApiSingle<User>(response);
 * expect(user.name).toBe('John');
 *
 * @example
 * const user = await expectApiSingle<User>(response, 201); // For POST
 */
export async function expectApiSingle<T extends ForjaEntry = ForjaRecord>(
  response: Response,
  expectedStatus = 200,
): Promise<Partial<T>> {
  // Debug: Log response if status doesn't match
  if (response.status !== expectedStatus) {
    const clonedResponse = response.clone();
    const body = await clonedResponse.json();
    console.log("❌ Unexpected status!");
    console.log("Expected:", expectedStatus);
    console.log("Received:", response.status);
    console.log("Response body:", JSON.stringify(body, null, 2));
  }

  expect(response.status).toBe(expectedStatus);

  const json = (await response.json()) as ResponseSingleData<T>;
  expect(json.data).toBeDefined();
  expect(json.data).toBeTypeOf("object");
  expect(Array.isArray(json.data)).toBe(false);

  return json.data;
}

/**
 * Assert API success for multiple records with pagination meta
 *
 * @example
 * const { data, meta } = await expectApiMulti<User>(response);
 * expect(data).toHaveLength(10);
 * expect(meta.page).toBe(2);
 * expect(meta.totalPages).toBe(7);
 */
export async function expectApiMulti<T extends ForjaEntry = ForjaRecord>(
  response: Response,
  expectedStatus = 200,
): Promise<ResponseMultiData<T>> {
  // Debug: Log response if status doesn't match
  if (response.status !== expectedStatus) {
    const clonedResponse = response.clone();
    const body = await clonedResponse.json();
    console.log("❌ Unexpected status!");
    console.log("Expected:", expectedStatus);
    console.log("Received:", response.status);
    console.log("Response body:", JSON.stringify(body, null, 2));
  }

  expect(response.status).toBe(expectedStatus);

  const json = (await response.json()) as ResponseMultiData<T>;

  // Validate data array
  expect(json.data).toBeDefined();
  expect(Array.isArray(json.data)).toBe(true);

  // Validate pagination meta
  expect(json.meta).toBeDefined();
  expect(json.meta.total).toBeTypeOf("number");
  expect(json.meta.page).toBeTypeOf("number");
  expect(json.meta.pageSize).toBeTypeOf("number");
  expect(json.meta.totalPages).toBeTypeOf("number");

  return json;
}

/**
 * Validate pagination meta matches expected values
 *
 * @example
 * expectPaginationMeta(meta, {
 *   page: 2,
 *   pageSize: 25,
 *   total: 156
 * });
 */
export function expectPaginationMeta(
  meta: PaginationMeta,
  expected: Partial<PaginationMeta>,
): void {
  if (expected.total !== undefined) {
    expect(meta.total).toBe(expected.total);
  }
  if (expected.page !== undefined) {
    expect(meta.page).toBe(expected.page);
  }
  if (expected.pageSize !== undefined) {
    expect(meta.pageSize).toBe(expected.pageSize);
  }
  if (expected.totalPages !== undefined) {
    expect(meta.totalPages).toBe(expected.totalPages);
  }
}

/**
 * Validate ForjaError structure has all required fields
 *
 * Required fields: type, message, code, timestamp
 * Optional fields: operation, context, suggestion, expected, received, documentation, cause
 */
function validateForjaErrorStructure(error: SerializedForjaError): void {
  // Required fields
  expect(error.type).toBeDefined();
  expect(error.type).toBeTypeOf("string");

  expect(error.message).toBeDefined();
  expect(error.message).toBeTypeOf("string");
  expect(error.message.length).toBeGreaterThan(0);

  expect(error.code).toBeDefined();
  expect(error.code).toBeTypeOf("string");
  expect(error.code.length).toBeGreaterThan(0);

  expect(error.timestamp).toBeDefined();
  expect(error.timestamp).toBeTypeOf("string");
  // Validate ISO 8601 date format
  expect(error.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);

  // Optional fields validation (if present)
  if (error.operation !== undefined) {
    expect(error.operation).toBeTypeOf("string");
  }

  if (error.context !== undefined) {
    expect(error.context).toBeTypeOf("object");
  }

  if (error.suggestion !== undefined) {
    expect(error.suggestion).toBeTypeOf("string");
  }

  if (error.expected !== undefined) {
    expect(error.expected).toBeTypeOf("string");
  }

  if (error.documentation !== undefined) {
    expect(error.documentation).toBeTypeOf("string");
  }

  if (error.cause !== undefined) {
    expect(error.cause).toBeTypeOf("object");
    expect(error.cause.message).toBeDefined();
    expect(error.cause.name).toBeDefined();
  }
}

/**
 * Assert API error response and return validated error details
 *
 * Validates ALL required ForjaError fields and returns the error object.
 *
 * @example
 * const error = await expectApiError(response, 404);
 * expect(error.code).toBe('RECORD_NOT_FOUND');
 *
 * @example
 * const error = await expectApiError(response, 403, 'PERMISSION_DENIED');
 * expect(error.suggestion).toBeDefined();
 */
export async function expectApiError(
  response: Response,
  expectedStatus: number,
  expectedCode?: string,
): Promise<SerializedForjaError> {
  // Debug: Log response if status doesn't match
  if (response.status !== expectedStatus) {
    const clonedResponse = response.clone();
    const body = await clonedResponse.json();
    console.log("❌ Unexpected error status!");
    console.log("Expected:", expectedStatus);
    console.log("Received:", response.status);
    console.log("Error body:", JSON.stringify(body, null, 2));
  }

  expect(response.status).toBe(expectedStatus);

  const json = (await response.json()) as ApiErrorResponse;
  expect(json.error).toBeDefined();

  // Validate ForjaError structure
  validateForjaErrorStructure(json.error);

  // Check expected code if provided
  if (expectedCode) {
    expect(json.error.code).toBe(expectedCode);
  }

  return json.error;
}

/**
 * Assert API unauthorized error (401)
 *
 * @example
 * const error = await expectApiUnauthorized(response);
 * expect(error.code).toBe('UNAUTHORIZED');
 */
export async function expectApiUnauthorized(
  response: Response,
): Promise<SerializedForjaError> {
  return expectApiError(response, 401, "UNAUTHORIZED");
}

/**
 * Assert API forbidden/permission denied error (403)
 *
 * @example
 * const error = await expectApiForbidden(response);
 * expect(error.code).toBe('FORBIDDEN');
 */
export async function expectApiForbidden(
  response: Response,
  expectedCode = "FORBIDDEN",
): Promise<SerializedForjaError> {
  return expectApiError(response, 403, expectedCode);
}

/**
 * Assert API not found error (404)
 *
 * @example
 * const error = await expectApiNotFound(response);
 * expect(error.message).toContain('not found');
 */
export async function expectApiNotFound(
  response: Response,
): Promise<SerializedForjaError> {
  return expectApiError(response, 404);
}

/**
 * Assert API validation error (400)
 *
 * @example
 * const error = await expectApiValidationError(response);
 * expect(error.code).toBe('VALIDATION_FAILED');
 */
export async function expectApiValidationError(
  response: Response,
): Promise<SerializedForjaError> {
  return expectApiError(response, 400);
}

/**
 * Complete API error assertion with all checks
 *
 * @example
 * await expectCompleteApiError(response, {
 *   status: 403,
 *   code: 'PERMISSION_DENIED',
 *   message: /permission denied/i,
 *   context: { schema: 'user', action: 'create' }
 * });
 */
export async function expectCompleteApiError(
  response: Response,
  options: {
    status: number;
    code?: string;
    message?: string | RegExp;
    suggestion?: string | RegExp;
    context?: Record<string, unknown>;
  },
): Promise<SerializedForjaError> {
  const error = await expectApiError(response, options.status, options.code);

  if (options.message) {
    if (typeof options.message === "string") {
      expect(error.message).toContain(options.message);
    } else {
      expect(error.message).toMatch(options.message);
    }
  }

  if (options.suggestion) {
    expect(error.suggestion).toBeDefined();
    if (typeof options.suggestion === "string") {
      expect(error.suggestion).toContain(options.suggestion);
    } else {
      expect(error.suggestion).toMatch(options.suggestion);
    }
  }

  if (options.context) {
    expect(error.context).toBeDefined();
    for (const [key, value] of Object.entries(options.context)) {
      expect(error.context).toHaveProperty(key);
      expect(error.context![key]).toEqual(value);
    }
  }

  return error;
}

// ============================================================================
// Query Builder Helper (uses serializer)
// ============================================================================

import type { ParsedQuery } from "../api/parser";

/**
 * Build query string from ParsedQuery object
 *
 * Converts structured query objects into URL query strings for API requests.
 * This makes tests more readable and maintainable.
 *
 * NOTE: To use this in tests, import queryToParams from '@forja/api/serializer'
 * This placeholder exists to document the pattern.
 *
 * @example
 * import { queryToParams } from '@forja/api/serializer';
 *
 * const queryString = queryToParams({
 *   where: { status: 'active', age: { $gte: 18 } },
 *   page: 2,
 *   pageSize: 25,
 *   orderBy: [{ field: 'name', direction: 'asc' }]
 * });
 *
 * const response = await fetch(`/api/users?${queryString}`);
 * // Result: /api/users?where[status]=active&where[age][$gte]=18&page=2&pageSize=25&sort=name
 *
 * @example
 * // Simple pagination
 * const queryString = queryToParams({
 *   page: 1,
 *   pageSize: 10
 * });
 * // Result: page=1&pageSize=10
 */
export function buildQueryString<T extends ForjaEntry = ForjaRecord>(
  query: ParsedQuery<T>,
): string {
  // This is a placeholder function for documentation purposes
  // In actual tests, use: import { queryToParams } from '@forja/api/serializer'
  throw new Error(
    "Use queryToParams from '@forja/api/serializer' instead of this placeholder"
  );
}
