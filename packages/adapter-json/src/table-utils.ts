import { ForjaEntry, SchemaDefinition } from "forja-types/core/schema";
import { QuerySelectObject } from "forja-types/core/query-builder";
import { JsonTableFile } from "./types";
import type { JsonAdapter } from "./adapter";
import {
	throwForeignKeyConstraint,
	throwUniqueConstraintField,
	throwUniqueConstraintIndex,
} from "./error-helper";
import { ConnectionError, MigrationError } from "forja-types/adapter";
import { Result } from "forja-types/utils";
import { FORJA_META_MODEL } from "forja-types/core/constants";

/**
 * Validate table name for security (no null bytes, path separators, or parent refs)
 */
export function validateTableName(
	tableName: string,
): Result<void, MigrationError> {
	if (tableName.includes("\x00")) {
		return {
			success: false,
			error: new MigrationError("Invalid table name: contains null byte"),
		};
	}

	if (tableName.includes("/") || tableName.includes("\\")) {
		return {
			success: false,
			error: new MigrationError("Invalid table name: contains path separators"),
		};
	}

	if (tableName.includes("..")) {
		return {
			success: false,
			error: new MigrationError(
				"Invalid table name: contains parent directory reference",
			),
		};
	}

	return { success: true, data: undefined };
}

/**
 * Bootstrap _forja metadata table for standalone mode.
 * Called during connect() when standalone: true is set in config.
 */
export async function createMetaTable(
	adapter: JsonAdapter,
): Promise<Result<void, ConnectionError>> {
	const metaExists = await adapter.tableExists(FORJA_META_MODEL);
	if (metaExists) {
		return { success: true, data: undefined };
	}

	const metaSchema: SchemaDefinition = {
		name: FORJA_META_MODEL,
		tableName: FORJA_META_MODEL,
		fields: {
			id: { type: "number", autoIncrement: true },
			key: { type: "string", required: true, unique: true, maxLength: 255 },
			value: { type: "string", required: true },
			createdAt: { type: "date" },
			updatedAt: { type: "date" },
		},
	};

	const createResult = await adapter.createTable(metaSchema);
	if (!createResult.success) {
		return {
			success: false,
			error: new ConnectionError(
				`Failed to create '${FORJA_META_MODEL}' table in standalone mode: ${createResult.error.message}`,
				createResult.error,
			),
		};
	}

	return { success: true, data: undefined };
}

/**
 * Apply default values from schema for fields not provided.
 * Mimics SQL DEFAULT behavior.
 */
export function applyDefaultValues(
	schema: SchemaDefinition | undefined,
	data: Record<string, unknown>,
): void {
	if (!schema?.fields) return;

	for (const [fieldName, fieldDef] of Object.entries(schema.fields)) {
		if (fieldName in data) continue;

		const defaultValue = (fieldDef as { default?: unknown }).default;
		if (defaultValue !== undefined) {
			data[fieldName] = defaultValue;
		}
	}
}

/**
 * Check unique constraints before insert/update.
 * Validates field-level unique and composite unique indexes.
 */
export function checkUniqueConstraints(
	tableData: JsonTableFile,
	schema: SchemaDefinition | undefined,
	newData: Record<string, unknown>,
	excludeId?: number | string,
): void {
	if (!schema?.fields) return;

	const existingData = tableData.data;

	// 1. Check unique fields (field.unique === true)
	for (const [fieldName, fieldDef] of Object.entries(schema.fields)) {
		if (!(fieldDef as { unique: boolean }).unique) continue;

		const value = newData[fieldName];
		if (value === undefined || value === null) continue;

		const duplicate = existingData.find(
			(row) => row[fieldName] === value && row["id"] !== excludeId,
		);

		if (duplicate) {
			throwUniqueConstraintField(
				fieldName,
				value,
				schema.tableName ?? "unknown",
			);
		}
	}

	// 2. Check unique indexes
	if (!schema.indexes) return;

	for (const index of schema.indexes) {
		if (!index.unique) continue;

		const indexValues = index.fields.map((f) => newData[f]);

		if (indexValues.some((v) => v === undefined || v === null)) continue;

		const duplicate = existingData.find(
			(row) =>
				index.fields.every((f) => row[f] === newData[f]) &&
				row["id"] !== excludeId,
		);

		if (duplicate) {
			throwUniqueConstraintIndex(index.fields, schema.tableName ?? "unknown");
		}
	}
}

/**
 * Check foreign key constraints before insert/update.
 * Validates that FK values reference existing records in target tables.
 */
export async function checkForeignKeyConstraints(
	schema: SchemaDefinition | undefined,
	data: Record<string, unknown>,
	adapter: JsonAdapter,
): Promise<void> {
	if (!schema?.fields) return;

	for (const [fieldName, fieldDef] of Object.entries(schema.fields)) {
		if (fieldDef.type !== "relation") continue;

		const relationField = fieldDef as {
			type: "relation";
			model: string;
			foreignKey?: string;
			kind?: string;
		};

		if (relationField.kind !== "belongsTo" && relationField.kind !== "hasOne") {
			continue;
		}

		const foreignKey = relationField.foreignKey ?? `${fieldName}Id`;
		const fkValue = data[foreignKey];

		if (fkValue === undefined || fkValue === null) continue;

		const targetSchema = await adapter.getSchemaByModelName(
			relationField.model,
		);
		if (!targetSchema) continue;

		const targetTable =
			targetSchema.tableName ?? relationField.model.toLowerCase();
		const targetData = await adapter.getCachedTable(targetTable);

		if (!targetData) continue;

		const exists = targetData.data.some((row) => row["id"] === fkValue);

		if (!exists) {
			throwForeignKeyConstraint(
				foreignKey,
				fkValue,
				relationField.model,
				schema.tableName ?? "unknown",
			);
		}
	}
}

/**
 * Apply SELECT recursively (preserves populated fields).
 * Ensures nested populate selects are applied to related data.
 */
export function applySelectRecursive<T extends ForjaEntry>(
	rows: T[],
	select?: QuerySelectObject<T>["select"],
	populate?: QuerySelectObject<T>["populate"],
): Partial<T>[] {
	if (!rows || rows.length === 0) {
		return rows;
	}

	let result = rows as Partial<T>[];

	if (select && (select as unknown as string) !== "*") {
		const fieldsToKeep = new Set(select);

		if (populate) {
			for (const relationName of Object.keys(populate)) {
				fieldsToKeep.add(relationName as keyof T);
			}
		}

		result = rows.map((row) => {
			const projected: Partial<T> = {};
			for (const field of fieldsToKeep) {
				if (field in row) {
					projected[field] = row[field];
				}
			}
			return projected;
		});
	}

	if (populate) {
		for (const [relationName, options] of Object.entries(populate)) {
			if (typeof options === "boolean") continue;

			const nestedSelect = options === "*" ? "*" : options.select;
			const nestedPopulate = options === "*" ? undefined : options.populate;

			for (const row of result) {
				const relationValue = row[relationName as keyof T] as T;
				if (!relationValue) continue;

				if (Array.isArray(relationValue)) {
					row[relationName as keyof T] = applySelectRecursive<T>(
						relationValue,
						nestedSelect,
						nestedPopulate,
					) as T[keyof T];
				} else {
					row[relationName as keyof T] = applySelectRecursive<T>(
						[relationValue],
						nestedSelect,
						nestedPopulate,
					)[0] as T[keyof T];
				}
			}
		}
	}

	return result;
}
