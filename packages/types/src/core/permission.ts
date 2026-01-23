/**
 * Permission System Types
 *
 * Schema-based permission system with role validation, function-based checks,
 * and field-level access control.
 */

import { AuthUser } from "../api";
import { ForjaEntry } from "./schema";

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
export interface PermissionContext<TRecord extends ForjaEntry = ForjaEntry> {
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
   * Forja instance for custom queries
   * User can perform additional checks if needed
   */
  readonly forja: unknown; // Avoid circular dependency
}

/**
 * Permission function type
 * Returns boolean or Promise<boolean> for async checks
 *
 * @template TRecord - The record type for the schema
 */
export type PermissionFn<TRecord extends ForjaEntry = ForjaEntry> = (
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
  TRecord extends ForjaEntry = ForjaEntry,
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
  TRecord extends ForjaEntry = ForjaEntry,
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
 * - `'owner'`: Special keyword for owner-based access (TODO: implement)
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
  TRecord extends ForjaEntry = ForjaEntry,
> {
  /**
   * Read permission - if denied, field is stripped from response
   * 'owner' is a placeholder for future owner-based access
   */
  readonly read?: PermissionValue<TRoles, TRecord> | "owner";
  /**
   * Write permission - if denied, returns 403 error
   * 'owner' is a placeholder for future owner-based access
   */
  readonly write?: PermissionValue<TRoles, TRecord> | "owner";
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
export function isPermissionFn<TRecord extends ForjaEntry = ForjaEntry>(
  value: unknown,
): value is PermissionFn<TRecord> {
  return typeof value === "function";
}

/**
 * Type guard for checking if permission value is a role array
 */
export function isRoleArray<TRoles extends string>(
  value: PermissionValue<TRoles>,
): value is readonly TRoles[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === "string")
  );
}

/**
 * Type guard for checking if permission value is a mixed array (roles + functions)
 */
export function isMixedPermissionArray<
  TRoles extends string,
  TRecord extends ForjaEntry = ForjaEntry,
>(
  value: PermissionValue<TRoles, TRecord>,
): value is readonly (TRoles | PermissionFn<TRecord>)[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.some((item) => typeof item === "string") &&
    value.some((item) => typeof item === "function")
  );
}

/**
 * Validate that all roles in permission config exist in roles array
 *
 * @param permission - Permission configuration to validate
 * @param validRoles - Array of valid role names
 * @returns Validation result with invalid roles if any
 */
export function validatePermissionRoles<TRoles extends string>(
  permission: SchemaPermission<TRoles> | undefined,
  validRoles: readonly TRoles[],
): { valid: boolean; invalidRoles: string[] } {
  if (!permission) {
    return { valid: true, invalidRoles: [] };
  }

  const invalidRoles: string[] = [];
  const roleSet = new Set(validRoles);

  const checkValue = (value: PermissionValue<TRoles> | undefined): void => {
    if (!value || typeof value === "boolean" || typeof value === "function") {
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string" && !roleSet.has(item as TRoles)) {
          invalidRoles.push(item);
        }
      }
    }
  };

  checkValue(permission.create);
  checkValue(permission.read);
  checkValue(permission.update);
  checkValue(permission.delete);

  return {
    valid: invalidRoles.length === 0,
    invalidRoles: [...new Set(invalidRoles)], // Remove duplicates
  };
}

/**
 * Validate field permission roles
 */
export function validateFieldPermissionRoles<TRoles extends string>(
  permission: FieldPermission<TRoles> | undefined,
  validRoles: readonly TRoles[],
): { valid: boolean; invalidRoles: string[] } {
  if (!permission) {
    return { valid: true, invalidRoles: [] };
  }

  const invalidRoles: string[] = [];
  const roleSet = new Set(validRoles);

  const checkValue = (
    value: PermissionValue<TRoles> | "owner" | undefined,
  ): void => {
    if (
      !value ||
      typeof value === "boolean" ||
      typeof value === "function" ||
      value === "owner"
    ) {
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string" && !roleSet.has(item as TRoles)) {
          invalidRoles.push(item);
        }
      }
    }
  };

  checkValue(permission.read);
  checkValue(permission.write);

  return {
    valid: invalidRoles.length === 0,
    invalidRoles: [...new Set(invalidRoles)],
  };
}
