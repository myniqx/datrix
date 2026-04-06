/**
 * Permission System Types
 *
 * Schema-based permission system with role validation, function-based checks,
 * and field-level access control.
 */

import { AuthUser } from "../api";
import { DatrixEntry } from "./schema";

/**
 * Permission actions for schema-level access
 */
export type PermissionAction = "create" | "read" | "update" | "delete";

/**
 * Permission actions for field-level access
 */
export type FieldPermissionAction = "read" | "write";

/**
 * Permission evaluation context
 *
 * @template TRecord - The record type for the schema
 */
export interface PermissionContext<TRecord extends DatrixEntry = DatrixEntry> {
	/** Current authenticated user (undefined if not authenticated) */
	readonly user: AuthUser | undefined;
	/** Current record (for update/delete operations) */
	readonly record?: TRecord;
	/** Input data (for create/update operations) */
	readonly input?: Partial<TRecord>;
	/** Current action being performed */
	readonly action: PermissionAction;

	readonly id?: number | string | null;
	/**
	 * Datrix instance for custom queries
	 * User can perform additional checks if needed
	 */
	readonly datrix: unknown; // Avoid circular dependency
}

/**
 * Permission function type
 * Returns boolean or Promise<boolean> for async checks
 *
 * @template TRecord - The record type for the schema
 */
export type PermissionFn<TRecord extends DatrixEntry = DatrixEntry> = (
	ctx: PermissionContext<TRecord>,
) => boolean | Promise<boolean>;

/**
 * Permission value type - supports multiple formats:
 * - `true` = everyone allowed
 * - `false` = no one allowed
 * - `['admin', 'editor']` = only these roles
 * - `(ctx) => boolean` = custom function
 * - `['admin', (ctx) => ctx.user?.id === ctx.record?.authorId]` = role OR function (OR logic)
 *
 * @template TRoles - Union type of valid role names
 * @template TRecord - The record type for the schema
 */
export type PermissionValue<
	TRoles extends string = string,
	TRecord extends DatrixEntry = DatrixEntry,
> =
	| boolean
	| readonly TRoles[]
	| PermissionFn<TRecord>
	| readonly (TRoles | PermissionFn<TRecord>)[];

/**
 * Schema-level permission configuration
 *
 * @template TRoles - Union type of valid role names
 * @template TRecord - The record type for the schema
 *
 * @example
 * ```ts
 * const permission: SchemaPermission<'admin' | 'editor' | 'user'> = {
 *   create: ['admin', 'editor'],
 *   read: true,
 *   update: ['admin', (ctx) => ctx.user?.id === ctx.record?.authorId],
 *   delete: ['admin'],
 * };
 * ```
 */
export interface SchemaPermission<
	TRoles extends string = string,
	TRecord extends DatrixEntry = DatrixEntry,
> {
	readonly create?: PermissionValue<TRoles, TRecord>;
	readonly read?: PermissionValue<TRoles, TRecord>;
	readonly update?: PermissionValue<TRoles, TRecord>;
	readonly delete?: PermissionValue<TRoles, TRecord>;
}

/**
 * Field-level permission configuration
 *
 * - `read`: If user doesn't have permission, field is removed from response
 * - `write`: If user doesn't have permission, returns 403 error
 *
 * @template TRoles - Union type of valid role names
 * @template TRecord - The record type for the schema
 *
 * @example
 * ```ts
 * const field = {
 *   type: 'string',
 *   permission: {
 *     read: ['admin', 'hr'],  // Only admin/hr can see this field
 *     write: ['admin'],       // Only admin can modify
 *   }
 * };
 * ```
 */
export interface FieldPermission<
	TRoles extends string = string,
	TRecord extends DatrixEntry = DatrixEntry,
> {
	readonly read?: PermissionValue<TRoles, TRecord>;
	readonly write?: PermissionValue<TRoles, TRecord>;
}

/**
 * Default permission configuration for API
 *
 * Applied to all schemas that don't have explicit permissions
 *
 * @template TRoles - Union type of valid role names
 */
export interface DefaultPermission<TRoles extends string = string> {
	readonly create?: PermissionValue<TRoles>;
	readonly read?: PermissionValue<TRoles>;
	readonly update?: PermissionValue<TRoles>;
	readonly delete?: PermissionValue<TRoles>;
}

/**
 * Permission check result
 */
export interface PermissionCheckResult {
	readonly allowed: boolean;
	readonly reason?: string | undefined;
}

/**
 * Field permission check result
 */
export interface FieldPermissionCheckResult {
	readonly allowed: boolean;
	readonly deniedFields?: readonly string[] | undefined;
}

/**
 * Type guard for PermissionFn
 */
export function isPermissionFn<TRecord extends DatrixEntry = DatrixEntry>(
	value: unknown,
): value is PermissionFn<TRecord> {
	return typeof value === "function";
}
