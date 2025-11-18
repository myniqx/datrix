/**
 * Utilities Module
 *
 * Exports global utility types and functions used throughout Forja.
 * Note: Primitive, ValidationError, and ValidationErrorCode are exported from core modules.
 */

// Export all utility types and functions
export type {
  Result,
  JsonValue,
  DeepPartial,
  DeepReadonly,
  KeysOfType,
  RequireKeys,
  OptionalKeys,
  Prettify,
  NonNullable,
  ArrayElement,
  Awaited,
  AnyFunction,
  Constructor,
  Merge,
  Mutable,
  Brand,
  Opaque,
  TypeGuard,
  Validator,
} from './types';

export {
  ForjaError,
  isResult,
  unwrap,
  unwrapOr,
  mapResult,
  mapResultAsync,
  combineResults,
  objectKeys,
  objectEntries,
  objectFromEntries,
  assertDefined,
  assertNever,
} from './types';
