/**
 * Base entry types for all Forja records.
 * Kept in a separate file to avoid circular dependencies.
 */

/**
 * Reserved fields automatically managed by Forja.
 * Every schema record has these fields — they cannot be set manually.
 */
export interface ForjaEntry {
	readonly id: number;
	createdAt: Date;
	updatedAt: Date;
}

/**
 * Flexible fallback value type for untyped fields.
 */
export type FallbackValue = {
	[key: string]:
		| string
		| number
		| boolean
		| Date
		| null
		| FallbackValue
		| FallbackValue[];
};

/**
 * Flexible record type for type-safe queries.
 * Combines ForjaEntry with Record<string, unknown>-like flexibility.
 */
export type ForjaRecord = ForjaEntry & FallbackValue;
