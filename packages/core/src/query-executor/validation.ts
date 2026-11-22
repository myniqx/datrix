/**
 * Data Validation and Timestamp Management
 *
 * Handles:
 * 1. Reserved field checks
 * 2. Timestamp injection (before validation)
 * 3. Schema default injection for creates (before validation)
 * 4. Schema validation (min/max/regex/type/required)
 */

import {
	DatrixEntry,
	SchemaDefinition,
	RESERVED_FIELDS,
} from "../types/core/schema";
import { getDefaultValue } from "../schema/inference";
import { validatePartial, validateSchema } from "../validator";
import { throwReservedFieldError } from "./error-helper";
import { QueryRelations } from "../types/core/query-builder";
import { assignIds } from "../schema/id";

/**
 * Validation options
 */
export interface ValidationOptions {
	/** If true, use partial validation (for updates) */
	partial: boolean;
	/** If true, this is a create operation (affects timestamp handling) */
	isCreate: boolean;
	/** If true, allow user to override timestamps (raw mode) */
	isRawMode: boolean;
}

/**
 * Check for reserved fields in user data
 *
 * Reserved fields (id, createdAt, updatedAt) are automatically managed
 * and cannot be set manually in normal mode.
 *
 * @param data - Data to check
 * @param isRawMode - If true, skip the check
 * @throws {DatrixError} If reserved field is found in normal mode
 *
 * @example
 * ```ts
 * // Normal mode
 * checkReservedFields({ id: 1, name: 'John' }, false);
 * // Throws: Cannot manually set reserved field 'id'
 *
 * // Raw mode
 * checkReservedFields({ id: 1, name: 'John' }, true);
 * // OK (raw mode allows override)
 * ```
 */
function checkReservedFields<T extends DatrixEntry>(
	data: Partial<T> | undefined,
	isRawMode: boolean,
): void {
	if (isRawMode || !data) {
		return;
	}

	for (const field of RESERVED_FIELDS) {
		if (field in data) {
			throwReservedFieldError(field, "unknown");
		}
	}
}

/**
 * Add timestamps to data before validation
 *
 * **Timestamp Rules:**
 *
 * **CREATE:**
 * - Normal mode: Always add createdAt + updatedAt (override user values)
 * - Raw mode: Add only if not provided (user can override)
 *
 * **UPDATE:**
 * - Normal mode: Always add updatedAt (override user value)
 * - Raw mode: Add only if not provided (user can override)
 *
 * @param data - Input data
 * @param options - Validation options
 * @returns Data with timestamps
 *
 * @example
 * ```ts
 * // CREATE (normal mode)
 * addTimestamps({ name: 'John' }, { isCreate: true, isRawMode: false });
 * // { name: 'John', createdAt: Date, updatedAt: Date }
 *
 * // CREATE (raw mode, user override)
 * addTimestamps(
 *   { name: 'John', createdAt: new Date('2020-01-01') },
 *   { isCreate: true, isRawMode: true }
 * );
 * // { name: 'John', createdAt: Date('2020-01-01'), updatedAt: Date('2020-01-01') }
 *
 * // UPDATE (normal mode)
 * addTimestamps({ name: 'Jane' }, { isCreate: false, isRawMode: false });
 * // { name: 'Jane', updatedAt: Date }
 * ```
 */
function addTimestamps<T extends DatrixEntry>(
	data: Partial<T> | undefined,
	options: Pick<ValidationOptions, "isCreate" | "isRawMode">,
): Partial<T> {
	const { isCreate, isRawMode } = options;
	const now = new Date();
	const result: Partial<T> = !!data ? { ...data } : ({} as Partial<T>);

	if (isCreate) {
		if (isRawMode) {
			// Raw mode: Smart defaults (only if not provided)
			if (!result.createdAt) {
				result.createdAt = now;
			}
			if (!result.updatedAt) {
				result.updatedAt = result.createdAt;
			}
		} else {
			// Normal mode: Always add timestamps (override)
			result.createdAt = now;
			result.updatedAt = now;
		}
	} else {
		// Update operation
		if (isRawMode) {
			// Raw mode: Add updatedAt only if not provided
			if (!result.updatedAt) {
				result.updatedAt = now;
			}
		} else {
			// Normal mode: Always update timestamp (override)
			result.updatedAt = now;
		}
	}

	return result;
}

/**
 * Concrete value for one row: function defaults are called per row (adapters
 * cannot express them in DDL), object/array defaults are cloned so rows never
 * share — and mutate — the schema's default value.
 */
function resolveDefault(defaultValue: unknown): unknown {
	if (typeof defaultValue === "function") {
		return (defaultValue as () => unknown)();
	}
	return typeof defaultValue === "object" && defaultValue !== null
		? structuredClone(defaultValue)
		: defaultValue;
}

/**
 * Fill schema defaults for fields the caller did not provide (creates only)
 *
 * Runs before validation so a `required` field with a `default` passes and
 * the default itself is validated. Only `undefined` is filled — an explicit
 * `null` is the caller's choice and is left for the validator to judge.
 * Relation and reserved fields are never defaulted.
 */
function applyDefaults<T extends DatrixEntry>(
	data: Partial<T> | undefined,
	schema: SchemaDefinition,
): Partial<T> | undefined {
	let result: Record<string, unknown> | undefined;
	for (const [fieldName, field] of Object.entries(schema.fields)) {
		if (
			field.type === "relation" ||
			(RESERVED_FIELDS as readonly string[]).includes(fieldName)
		) {
			continue;
		}
		const defaultValue = getDefaultValue(field);
		if (defaultValue === undefined) continue;
		const current = (result ?? data) as Record<string, unknown> | undefined;
		if (current?.[fieldName] !== undefined) continue;
		result ??= { ...(data ?? {}) };
		result[fieldName] = resolveDefault(defaultValue);
	}
	return (result ?? data) as Partial<T> | undefined;
}

/**
 * Validate data against schema with timestamp handling
 *
 * **Flow:**
 * 1. Check reserved fields (only in normal mode)
 * 2. Add timestamps BEFORE validation (so required fields pass)
 * 3. Fill schema defaults for missing fields (creates only)
 * 4. Schema validation (min/max/regex/type/required)
 *
 * @param data - Data to validate
 * @param schema - Schema definition
 * @param options - Validation options
 * @returns Validated data with timestamps
 * @throws {DatrixError} If validation fails or reserved field found
 *
 * @example
 * ```ts
 * // CREATE (normal mode)
 * validateData(
 *   { name: 'John', age: 25 },
 *   userSchema,
 *   { partial: false, isCreate: true, isRawMode: false }
 * );
 * // { name: 'John', age: 25, createdAt: Date, updatedAt: Date }
 *
 * // UPDATE (partial)
 * validateData(
 *   { age: 26 },
 *   userSchema,
 *   { partial: true, isCreate: false, isRawMode: false }
 * );
 * // { age: 26, updatedAt: Date }
 * ```
 */
export function validateData<
	T extends DatrixEntry = DatrixEntry,
	P extends boolean = false,
>(
	data: Partial<T> | undefined,
	relations: QueryRelations<T> | undefined,
	schema: SchemaDefinition,
	options: ValidationOptions,
): P extends true ? Partial<T> : T {
	const { partial, isCreate, isRawMode } = options;

	// 1. Check for reserved fields (only in normal mode)
	checkReservedFields(data, isRawMode);

	// 2. Add timestamps BEFORE validation (so required fields like createdAt pass)
	const withTimestamps = schema._isJunctionTable
		? data
		: addTimestamps(data, { isCreate, isRawMode });

	// 2b. Fill schema defaults BEFORE validation (creates only — an update
	// must never reset fields the caller left out)
	const withDefaults = isCreate
		? applyDefaults(withTimestamps, schema)
		: withTimestamps;

	// 2c. Assign core-generated ids (uuid schemas only) for creates
	const dataWithTimestamps =
		isCreate && withDefaults !== undefined
			? assignIds([withDefaults as Record<string, unknown>], schema)[0]
			: withDefaults;

	// 3. Schema validation (with timestamps already present).
	// With strict: true and stripUnknown: false the validator is check-only
	// (it throws on failure, never transforms), so returning
	// dataWithTimestamps below is the validated payload.
	const validationOptions = {
		strict: true,
		stripUnknown: false,
		abortEarly: false,
	};

	const combined = { ...(dataWithTimestamps ?? {}), ...(relations ?? {}) };

	if (partial) {
		validatePartial(combined, schema, validationOptions);
	} else {
		validateSchema(combined, schema, validationOptions);
	}

	return dataWithTimestamps as P extends true ? Partial<T> : T;
}
