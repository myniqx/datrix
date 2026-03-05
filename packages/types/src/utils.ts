/**
 * Global Utility Types for Forja
 *
 * This file contains reusable utility types used throughout the codebase.
 * All types must be strictly typed - NO `any` types allowed.
 */

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
export type DeepPartial<T> =
	T extends Record<string, unknown>
	? { [P in keyof T]?: DeepPartial<T[P]> }
	: T;

/**
 * Make all properties in T readonly recursively
 */
export type DeepReadonly<T> =
	T extends Record<string, unknown>
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
