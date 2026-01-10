# Validator Module API Reference

> Complete API reference for validator module.

---

## Validation Functions

```typescript
// Field validation
function validateField<T = unknown>(
  value: unknown,
  field: FieldDefinition,
  fieldName: string,
  depth?: number
): FieldValidationResult<T>

// Schema validation
function validateSchema<T = Record<string, unknown>>(
  data: unknown,
  schema: SchemaDefinition,
  options?: ValidatorOptions
): SchemaValidationResult<T>

// Partial validation (for updates)
function validatePartial<T = Record<string, unknown>>(
  data: unknown,
  schema: SchemaDefinition,
  options?: ValidatorOptions
): SchemaValidationResult<Partial<T>>

// Array validation
function validateMany<T = Record<string, unknown>>(
  dataArray: unknown,
  schema: SchemaDefinition,
  options?: ValidatorOptions
): SchemaValidationResult<readonly T[]>

// Helpers
function isValid(
  data: unknown,
  schema: SchemaDefinition,
  options?: ValidatorOptions
): boolean

function validateOrThrow<T = Record<string, unknown>>(
  data: unknown,
  schema: SchemaDefinition,
  options?: ValidatorOptions
): T

function assertSchema<T>(
  data: unknown,
  schema: SchemaDefinition,
  options?: ValidatorOptions
): asserts data is T
```

---

## Error Creation

```typescript
function createValidationError(
  field: string,
  code: ValidationErrorCode,
  message: string,
  options?: {
    value?: unknown
    expected?: unknown
  }
): ValidationError
```

---

## Classes

### ValidationErrorCollection

```typescript
class ValidationErrorCollection {
  constructor(errors?: readonly ValidationError[])

  add(error: ValidationError): ValidationErrorCollection
  addMany(errors: readonly ValidationError[]): ValidationErrorCollection
  getAll(): readonly ValidationError[]
  getByField(field: string): readonly ValidationError[]
  getByCode(code: ValidationErrorCode): readonly ValidationError[]
  hasErrors(): boolean
  count(): number
  toString(): string
  toJSON(): readonly ValidationError[]
  groupByField(): Record<string, readonly ValidationError[]>
  getFirstPerField(): Record<string, ValidationError>
}
```

---

## Error Utilities

```typescript
function formatErrorMessage(
  code: ValidationErrorCode,
  field: string,
  options?: { value?: unknown; expected?: unknown }
): string

function combineErrors(
  ...errorArrays: readonly (readonly ValidationError[])[]
): readonly ValidationError[]

function groupErrorsByField(
  errors: readonly ValidationError[]
): Record<string, readonly ValidationError[]>

function getFirstErrorPerField(
  errors: readonly ValidationError[]
): Record<string, ValidationError>

function filterErrorsByCode(
  errors: readonly ValidationError[],
  code: ValidationErrorCode
): readonly ValidationError[]

function filterErrorsByField(
  errors: readonly ValidationError[],
  field: string
): readonly ValidationError[]

function hasErrorCode(
  errors: readonly ValidationError[],
  code: ValidationErrorCode
): boolean

function hasErrorForField(
  errors: readonly ValidationError[],
  field: string
): boolean

function formatErrors(
  errors: readonly ValidationError[]
): string

function formatErrorsAsJSON(
  errors: readonly ValidationError[]
): string

function errorsToPlainObject(
  errors: readonly ValidationError[]
): Record<string, string[]>
```

---

## Types

```typescript
type ValidationErrorCode =
  | 'REQUIRED'
  | 'TYPE_MISMATCH'
  | 'MIN_LENGTH'
  | 'MAX_LENGTH'
  | 'MIN_VALUE'
  | 'MAX_VALUE'
  | 'MIN_ITEMS'
  | 'MAX_ITEMS'
  | 'PATTERN'
  | 'UNIQUE'
  | 'INVALID_ENUM'
  | 'INVALID_FORMAT'
  | 'INVALID_DATE'
  | 'CUSTOM'
  | 'UNKNOWN'

interface ValidationError {
  readonly field: string
  readonly code: ValidationErrorCode
  readonly message: string
  readonly value?: unknown
  readonly expected?: unknown
}

type FieldValidationResult<T = unknown> = Result<T, ValidationError[]>
type SchemaValidationResult<T = Record<string, unknown>> = Result<T, ValidationError[]>

interface ValidatorOptions {
  readonly strict?: boolean        // Default: true
  readonly coerce?: boolean        // Default: false (not implemented)
  readonly stripUnknown?: boolean  // Default: false
  readonly abortEarly?: boolean    // Default: false
}
```

---

## Constants

```typescript
const MAX_VALIDATION_DEPTH = 10
```

---

## Source

- Field validation - `packages/core/src/validator/field.ts`
- Schema validation - `packages/core/src/validator/schema.ts`
- Error collection - `packages/core/src/validator/errors.ts`
- Validator types - `packages/types/src/validator.ts`
