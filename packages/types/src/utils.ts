/**
 * Global Utility Types for Forja
 *
 * This file contains reusable utility types used throughout the codebase.
 * All types must be strictly typed - NO `any` types allowed.
 */

/**
 * Result pattern for error handling
 * Use this instead of throwing exceptions
 */
export type Result<T, E = Error> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly error: E };

/**
 * Primitive types
 */
export type Primitive = string | number | boolean | null | undefined;

/**
 * JSON-serializable value
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | { readonly [key: string]: JsonValue }
  | readonly JsonValue[];

/**
 * Make all properties in T optional recursively
 */
export type DeepPartial<T> = T extends Record<string, unknown>
  ? { [P in keyof T]?: DeepPartial<T[P]> }
  : T;

/**
 * Make all properties in T readonly recursively
 */
export type DeepReadonly<T> = T extends Record<string, unknown>
  ? { readonly [P in keyof T]: DeepReadonly<T[P]> }
  : T;

/**
 * Extract keys from T that have values of type V
 */
export type KeysOfType<T, V> = {
  [K in keyof T]: T[K] extends V ? K : never;
}[keyof T];

/**
 * Make specific properties K in T required
 */
export type RequireKeys<T, K extends keyof T> = T & Required<Pick<T, K>>;

/**
 * Make specific properties K in T optional
 */
export type OptionalKeys<T, K extends keyof T> = Omit<T, K> &
  Partial<Pick<T, K>>;

/**
 * Prettify type for better IDE hints
 */
export type Prettify<T> = { [K in keyof T]: T[K] } & Record<string, never>;

/**
 * Extract non-nullable type
 */
export type NonNullable<T> = T extends null | undefined ? never : T;

/**
 * Get value type from array
 */
export type ArrayElement<T> = T extends readonly (infer U)[] ? U : never;

/**
 * Awaited type (unwrap Promise)
 */
export type Awaited<T> = T extends Promise<infer U> ? U : T;

/**
 * Function type
 */
export type AnyFunction = (...args: readonly unknown[]) => unknown;

/**
 * Constructor type
 */
export type Constructor<T = Record<string, never>> = new (
  ...args: readonly unknown[]
) => T;

/**
 * Merge two types
 */
export type Merge<T, U> = Omit<T, keyof U> & U;

/**
 * Make properties mutable (remove readonly)
 */
export type Mutable<T> = {
  -readonly [P in keyof T]: T[P];
};

/**
 * Branded type for nominal typing
 */
export type Brand<T, B> = T & { readonly __brand: B };

/**
 * Opaque type alias
 */
export type Opaque<T, K> = T & { readonly __opaque: K };

/**
 * Type guard function type
 */
export type TypeGuard<T> = (value: unknown) => value is T;

/**
 * Validator function type
 * Note: ValidationError is defined in core/validator
 */
export type Validator<T> = (value: unknown) => Result<T, unknown>;

/**
 * Base error class
 */
export class ForjaError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(message: string, options?: { code?: string; details?: unknown }) {
    super(message);
    this.name = 'ForjaError';
    this.code = options?.code ?? 'UNKNOWN';
    this.details = options?.details;
  }
}

/**
 * Check if value is Result type
 */
export function isResult<T, E>(value: unknown): value is Result<T, E> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'success' in value &&
    typeof (value as { success: unknown }).success === 'boolean'
  );
}

/**
 * Unwrap Result or throw error
 */
export function unwrap<T, E extends Error>(result: Result<T, E>): T {
  if (result.success) {
    return result.data;
  }
  throw result.error;
}

/**
 * Unwrap Result or return default value
 */
export function unwrapOr<T, E>(result: Result<T, E>, defaultValue: T): T {
  return result.success ? result.data : defaultValue;
}

/**
 * Map Result success value
 */
export function mapResult<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => U
): Result<U, E> {
  return result.success
    ? { success: true, data: fn(result.data) }
    : result;
}

/**
 * Async version of map
 */
export async function mapResultAsync<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => Promise<U>
): Promise<Result<U, E>> {
  return result.success
    ? { success: true, data: await fn(result.data) }
    : result;
}

/**
 * Combine multiple Results
 */
export function combineResults<T extends readonly unknown[], E>(
  results: readonly [...{ [K in keyof T]: Result<T[K], E> }]
): Result<T, E> {
  const data: unknown[] = [];

  for (const result of results) {
    if (!result.success) {
      return result;
    }
    data.push(result.data);
  }

  return { success: true, data: data as unknown as T };
}

/**
 * Type-safe Object.keys
 */
export function objectKeys<T extends Record<string, unknown>>(
  obj: T
): readonly (keyof T)[] {
  return Object.keys(obj) as (keyof T)[];
}

/**
 * Type-safe Object.entries
 */
export function objectEntries<T extends Record<string, unknown>>(
  obj: T
): readonly [keyof T, T[keyof T]][] {
  return Object.entries(obj) as [keyof T, T[keyof T]][];
}

/**
 * Type-safe Object.fromEntries
 */
export function objectFromEntries<K extends string, V>(
  entries: readonly (readonly [K, V])[]
): Record<K, V> {
  return Object.fromEntries(entries) as Record<K, V>;
}

/**
 * Assert value is defined (not null or undefined)
 */
export function assertDefined<T>(
  value: T,
  message = 'Value is not defined'
): asserts value is NonNullable<T> {
  if (value === null || value === undefined) {
    throw new ForjaError(message, { code: 'ASSERTION_FAILED' });
  }
}

/**
 * Assert never (exhaustiveness check)
 */
export function assertNever(value: never, message?: string): never {
  throw new ForjaError(
    message ?? `Unexpected value: ${JSON.stringify(value)}`,
    { code: 'EXHAUSTIVE_CHECK_FAILED' }
  );
}
