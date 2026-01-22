/**
 * Permission Middleware
 *
 * Schema-based permission checking with support for:
 * - Boolean permissions (true = everyone, false = no one)
 * - Role arrays (['admin', 'editor'])
 * - Permission functions ((ctx) => boolean)
 * - Mixed arrays with OR logic (['admin', (ctx) => ctx.user?.id === ctx.record?.authorId])
 */

import type { ForjaEntry, SchemaDefinition } from "forja-types/core/schema";
import type {
  PermissionAction,
  PermissionValue,
  PermissionContext,
  PermissionFn,
  SchemaPermission,
  DefaultPermission,
  PermissionCheckResult,
  FieldPermission,
  FieldPermissionCheckResult,
} from "forja-types/core/permission";
import { isPermissionFn } from "forja-types/core/permission";
import type { RequestContext } from "./types";

/**
 * Build PermissionContext from RequestContext
 * Internal helper to satisfy PermissionFn signature
 */
function buildPermCtx<T extends ForjaEntry>(
  ctx: RequestContext,
): PermissionContext<T> {
  const permCtx: PermissionContext<T> = {
    user: ctx.user ?? undefined,
    id: ctx.id,
    action: ctx.action,
    forja: ctx.forja,
  };

  // Only add input if body exists (for exactOptionalPropertyTypes)
  if (ctx.body) {
    (permCtx as { input?: Record<string, unknown> }).input = ctx.body;
  }

  return permCtx;
}

/**
 * Evaluate a single permission value
 *
 * @param value - Permission value to evaluate
 * @param ctx - Request context
 * @returns true if allowed, false otherwise
 */
export async function evaluatePermissionValue<TRoles extends string>(
  value: PermissionValue<TRoles> | undefined,
  ctx: RequestContext,
): Promise<boolean> {
  // Undefined means no restriction (allow)
  if (value === undefined) {
    return true;
  }

  // Boolean: direct allow/deny
  if (typeof value === "boolean") {
    return value;
  }

  // Function: evaluate with context
  if (isPermissionFn(value)) {
    // Create minimal context for permission function
    const permCtx = buildPermCtx(ctx);
    return await (value as PermissionFn)(permCtx);
  }

  // Array: check roles and/or functions (OR logic)
  if (Array.isArray(value)) {
    // No user means no role to check
    if (!ctx.user) {
      // But we still need to check if there are functions that might allow
      for (const item of value) {
        if (isPermissionFn(item)) {
          const permCtx = buildPermCtx(ctx);
          const result = await (item as PermissionFn)(permCtx);
          if (result) return true;
        }
      }
      return false;
    }

    // Check each item with OR logic
    for (const item of value) {
      if (typeof item === "string") {
        // Role check
        if (ctx.user.role === item) {
          return true;
        }
      } else if (isPermissionFn(item)) {
        // Function check
        const permCtx = buildPermCtx(ctx);
        const result = await (item as PermissionFn)(permCtx);
        if (result) return true;
      }
    }
    return false;
  }

  // Unknown type, deny by default
  return false;
}

/**
 * Check schema-level permission
 *
 * @param schema - Schema definition
 * @param ctx - Request context (contains action)
 * @param defaultPermission - Default permission if schema has no explicit permission
 * @returns Permission check result
 */
export async function checkSchemaPermission<TRoles extends string>(
  schema: SchemaDefinition<TRoles>,
  ctx: RequestContext,
  defaultPermission?: DefaultPermission<TRoles>,
): Promise<PermissionCheckResult> {
  const { action } = ctx;

  // Get permission value from schema or default
  const schemaPermission = schema.permission as
    | SchemaPermission<TRoles>
    | undefined;
  let permissionValue: PermissionValue<TRoles> | undefined;

  if (schemaPermission && schemaPermission[action] !== undefined) {
    permissionValue = schemaPermission[action];
  } else if (defaultPermission && defaultPermission[action] !== undefined) {
    permissionValue = defaultPermission[action];
  }

  const allowed = await evaluatePermissionValue(permissionValue, ctx);

  return {
    allowed,
    reason:
      allowed ? undefined : `Permission denied for ${action} on ${schema.name}`,
  };
}

/**
 * Check field-level read permissions and filter response
 *
 * @param schema - Schema definition
 * @param record - Record to filter
 * @param ctx - Request context
 * @returns Filtered record with denied fields removed
 */
export async function filterFieldsForRead<
  TRoles extends string,
  TRecord extends ForjaEntry,
>(
  schema: SchemaDefinition<TRoles>,
  record: TRecord,
  ctx: RequestContext,
): Promise<{ data: Partial<TRecord>; deniedFields: string[] }> {
  const deniedFields: string[] = [];
  const filtered: Partial<TRecord> = {};

  for (const [fieldName, fieldValue] of Object.entries(record)) {
    const fieldDef = schema.fields[fieldName];

    // If field not in schema, include it (system fields like id, createdAt)
    if (!fieldDef) {
      (filtered as Record<string, unknown>)[fieldName] = fieldValue;
      continue;
    }

    const fieldPermission = fieldDef.permission as
      | FieldPermission<TRoles>
      | undefined;

    // No permission defined = allow
    if (!fieldPermission || fieldPermission.read === undefined) {
      (filtered as Record<string, unknown>)[fieldName] = fieldValue;
      continue;
    }

    // Handle 'owner' keyword (TODO: implement owner check)
    if (fieldPermission.read === "owner") {
      // TODO: Implement owner-based permission
      // For now, allow if user exists
      if (ctx.user) {
        (filtered as Record<string, unknown>)[fieldName] = fieldValue;
      } else {
        deniedFields.push(fieldName);
      }
      continue;
    }

    // Evaluate permission
    const allowed = await evaluatePermissionValue(fieldPermission.read, ctx);
    if (allowed) {
      (filtered as Record<string, unknown>)[fieldName] = fieldValue;
    } else {
      deniedFields.push(fieldName);
    }
  }

  return { data: filtered, deniedFields };
}

/**
 * Check field-level write permissions
 *
 * @param schema - Schema definition
 * @param ctx - Request context (contains body as input)
 * @returns Result with denied fields (if any, should return 403)
 */
export async function checkFieldsForWrite<TRoles extends string>(
  schema: SchemaDefinition<TRoles>,
  ctx: RequestContext,
): Promise<FieldPermissionCheckResult> {
  const deniedFields: string[] = [];
  const input = ctx.body ?? {};

  for (const fieldName of Object.keys(input)) {
    const fieldDef = schema.fields[fieldName];

    // If field not in schema, skip (validator will handle)
    if (!fieldDef) {
      continue;
    }

    const fieldPermission = fieldDef.permission as
      | FieldPermission<TRoles>
      | undefined;

    // No permission defined = allow
    if (!fieldPermission || fieldPermission.write === undefined) {
      continue;
    }

    // Handle 'owner' keyword (TODO: implement owner check)
    if (fieldPermission.write === "owner") {
      // TODO: Implement owner-based permission
      if (!ctx.user) {
        deniedFields.push(fieldName);
      }
      continue;
    }

    // Evaluate permission
    const allowed = await evaluatePermissionValue(fieldPermission.write, ctx);
    if (!allowed) {
      deniedFields.push(fieldName);
    }
  }

  return {
    allowed: deniedFields.length === 0,
    deniedFields: deniedFields.length > 0 ? deniedFields : undefined,
  };
}

/**
 * Map HTTP method to permission action
 */
export function methodToAction(method: string): PermissionAction {
  switch (method.toUpperCase()) {
    case "GET":
      return "read";
    case "POST":
      return "create";
    case "PATCH":
    case "PUT":
      return "update";
    case "DELETE":
      return "delete";
    default:
      return "read";
  }
}

/**
 * Filter array of records for read permission (used for list endpoints)
 */
export async function filterRecordsForRead<
  TRoles extends string,
  TRecord extends ForjaEntry,
>(
  schema: SchemaDefinition<TRoles>,
  records: readonly TRecord[],
  ctx: RequestContext,
): Promise<Partial<TRecord>[]> {
  const filtered: Partial<TRecord>[] = [];

  for (const record of records) {
    const { data } = await filterFieldsForRead(schema, record, ctx);
    filtered.push(data);
  }

  return filtered;
}
