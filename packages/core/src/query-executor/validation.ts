/**
 * Data Validation and Timestamp Management
 *
 * Handles:
 * 1. Reserved field checks
 * 2. Timestamp injection (before validation)
 * 3. Schema validation (min/max/regex/type/required)
 */

import {
	ForjaEntry,
	SchemaDefinition,
	RESERVED_FIELDS,
} from "@forja/core/types/core/schema";
import { validatePartial, validateSchema } from "../validator";
import { throwReservedFieldError } from "./error-helper";
import { QueryRelations } from "@forja/core/types/core/query-builder";

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
 * @throws {ForjaError} If reserved field is found in normal mode
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
function checkReservedFields<T extends ForjaEntry>(
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
function addTimestamps<T extends ForjaEntry>(
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
 * Validate data against schema with timestamp handling
 *
 * **Flow:**
 * 1. Check reserved fields (only in normal mode)
 * 2. Add timestamps BEFORE validation (so required fields pass)
 * 3. Schema validation (min/max/regex/type/required)
 *
 * @param data - Data to validate
 * @param schema - Schema definition
 * @param options - Validation options
 * @returns Validated data with timestamps
 * @throws {ForjaError} If validation fails or reserved field found
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
	T extends ForjaEntry = ForjaEntry,
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
	const dataWithTimestamps = schema._isJunctionTable
		? data
		: addTimestamps(data, { isCreate, isRawMode });

	// 3. Schema validation (with timestamps already present)
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
