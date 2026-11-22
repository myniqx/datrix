/**
 * Base entry types for all Datrix records.
 * Kept in a separate file to avoid circular dependencies.
 */

/**
 * Type registry for project-wide Datrix type settings.
 *
 * Augment it (the CLI type generator does this automatically) to tell the
 * type system which `idType` the project's config uses:
 *
 * @example
 * ```ts
 * declare module "@datrix/core" {
 *   interface DatrixRegister {
 *     idType: "uuid";
 *   }
 * }
 * ```
 */
export interface DatrixRegister {}

/**
 * Primary key strategy configured via `DatrixConfig.idType`.
 */
export type IdType = "int" | "uuid";

/**
 * Record ID type — `number` by default, `string` when `DatrixRegister`
 * declares `idType: "uuid"`.
 */
export type DatrixId = DatrixRegister extends { idType: "uuid" }
	? string
	: number;

/**
 * Runtime ID value as seen by core internals and adapters.
 *
 * `DatrixId` is resolved per project via `DatrixRegister`; core and adapters
 * are compiled without that augmentation, so they work with the union of both
 * strategies. Public APIs expose `DatrixId`, internals use `IdValue`.
 */
export type IdValue = string | number;

/**
 * Reserved fields automatically managed by Datrix.
 * Every schema record has these fields — they cannot be set manually.
 */
export interface DatrixEntry {
	readonly id: DatrixId;
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
 * Combines DatrixEntry with Record<string, unknown>-like flexibility.
 */
export type DatrixRecord = DatrixEntry & FallbackValue;
