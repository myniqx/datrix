/**
 * Permission Middleware
 *
 * Schema-based permission checking with support for:
 * - Boolean permissions (true = everyone, false = no one)
 * - Role arrays (['admin', 'editor'])
 * - Permission functions ((ctx) => boolean)
 * - Mixed arrays with OR logic (['admin', (ctx) => ctx.user?.id === ctx.record?.authorId])
 */

import type { DatrixEntry, SchemaDefinition } from "@datrix/core";
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
} from "@datrix/core";
import { isPermissionFn } from "@datrix/core";
import type { RequestContext } from "./types";

/**
 * Build PermissionContext from RequestContext
 * Internal helper to satisfy PermissionFn signature
 */
function buildPermCtx<T extends DatrixEntry>(
	ctx: RequestContext,
): PermissionContext<T> {
	const permCtx: PermissionContext<T> = {
		user: ctx.user ?? undefined,
		id: ctx.id,
		action: ctx.action,
		datrix: ctx.datrix,
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

	// Default (D2): with no explicit permission, `read` is open to everyone;
	// create/update/delete require an authenticated user.
	// Field-level semantics (undefined = allow) are unchanged.
	const allowed =
		permissionValue === undefined
			? action === "read" || ctx.user !== null
			: await evaluatePermissionValue(permissionValue, ctx);

	return {
		allowed,
		reason: allowed
			? undefined
			: `Permission denied for ${action} on ${schema.name}`,
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
	TRecord extends DatrixEntry,
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

		// Evaluate permission (no permission defined = allow)
		if (fieldPermission && fieldPermission.read !== undefined) {
			const allowed = await evaluatePermissionValue(fieldPermission.read, ctx);
			if (!allowed) {
				deniedFields.push(fieldName);
				continue;
			}
		}

		// Populated relations carry records of the target schema — apply the
		// target schema's own field permissions recursively. Depth is bounded
		// by the populate depth limit.
		(filtered as Record<string, unknown>)[fieldName] =
			await filterPopulatedValue(fieldDef, fieldValue, ctx);
	}

	return { data: filtered, deniedFields };
}

/**
 * Recursively filter a populated relation value with the target schema's
 * field-level read permissions. Non-relation fields and unpopulated values
 * (ids, null) pass through unchanged.
 */
async function filterPopulatedValue(
	fieldDef: SchemaDefinition["fields"][string],
	value: unknown,
	ctx: RequestContext,
): Promise<unknown> {
	if (fieldDef.type !== "relation" || value === null || value === undefined) {
		return value;
	}

	const targetSchema = ctx.datrix.getSchema(fieldDef.model);
	if (!targetSchema) {
		return value;
	}

	if (Array.isArray(value)) {
		const filtered: unknown[] = [];
		for (const item of value) {
			if (item !== null && typeof item === "object") {
				const { data } = await filterFieldsForRead(
					targetSchema,
					item as DatrixEntry,
					ctx,
				);
				filtered.push(data);
			} else {
				filtered.push(item);
			}
		}
		return filtered;
	}

	if (typeof value === "object") {
		const { data } = await filterFieldsForRead(
			targetSchema,
			value as DatrixEntry,
			ctx,
		);
		return data;
	}

	return value;
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
	const deniedFields = await collectDeniedWriteFields(
		schema,
		(ctx.body ?? {}) as Record<string, unknown>,
		ctx,
		"",
	);

	return {
		allowed: deniedFields.length === 0,
		deniedFields: deniedFields.length > 0 ? deniedFields : undefined,
	};
}

/**
 * Collect write-denied fields for an input object, recursing into nested
 * relation create/update payloads so related schemas' field permissions
 * apply too. Denied nested fields are reported with a dotted path
 * (e.g. "posts.secretField").
 */
async function collectDeniedWriteFields(
	schema: SchemaDefinition,
	input: Record<string, unknown>,
	ctx: RequestContext,
	prefix: string,
): Promise<string[]> {
	const deniedFields: string[] = [];

	for (const [fieldName, value] of Object.entries(input)) {
		const fieldDef = schema.fields[fieldName];

		// If field not in schema, skip (validator will handle)
		if (!fieldDef) {
			continue;
		}

		const fieldPermission = fieldDef.permission as FieldPermission | undefined;

		// Evaluate this field's own write permission (undefined = allow)
		if (fieldPermission && fieldPermission.write !== undefined) {
			const allowed = await evaluatePermissionValue(fieldPermission.write, ctx);
			if (!allowed) {
				deniedFields.push(`${prefix}${fieldName}`);
				continue;
			}
		}

		// Recurse into nested relation create/update payloads
		if (
			fieldDef.type === "relation" &&
			value !== null &&
			typeof value === "object" &&
			!Array.isArray(value)
		) {
			const targetSchema = ctx.datrix.getSchema(fieldDef.model);
			if (!targetSchema) {
				continue;
			}

			const relationInput = value as {
				create?: Record<string, unknown> | Record<string, unknown>[];
				update?:
					| { data?: Record<string, unknown> }
					| { data?: Record<string, unknown> }[];
			};

			const nestedPayloads: Record<string, unknown>[] = [];

			const createOps = relationInput.create;
			if (createOps) {
				nestedPayloads.push(
					...(Array.isArray(createOps) ? createOps : [createOps]),
				);
			}

			const updateOps = relationInput.update;
			if (updateOps) {
				for (const op of Array.isArray(updateOps) ? updateOps : [updateOps]) {
					if (op && typeof op === "object" && op.data) {
						nestedPayloads.push(op.data);
					}
				}
			}

			for (const payload of nestedPayloads) {
				if (payload && typeof payload === "object") {
					deniedFields.push(
						...(await collectDeniedWriteFields(
							targetSchema,
							payload,
							ctx,
							`${prefix}${fieldName}.`,
						)),
					);
				}
			}
		}
	}

	return deniedFields;
}

/**
 * Map HTTP method to permission action
 */
export function methodToAction(method: string): PermissionAction {
	switch (method.toUpperCase()) {
		case "GET":
		case "QUERY":
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
	TRecord extends DatrixEntry,
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
