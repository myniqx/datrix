import {
	ForjaEntry,
	ForeignKeyReference,
	SchemaDefinition,
} from "forja-types/core/schema";
import { QuerySelectObject } from "forja-types/core/query-builder";
import { ExecuteQueryOptions, JsonTableFile } from "./types";
import type { JsonAdapter } from "./adapter";
import {
	ForjaAdapterError,
	throwForeignKeyConstraint,
	throwMigrationError,
	throwUniqueConstraintField,
	throwUniqueConstraintIndex,
} from "forja-types/errors/adapter";
import { FORJA_META_MODEL } from "forja-types/core/constants";

/**
 * Validate table name for security (no null bytes, path separators, or parent refs)
 */
export function validateTableName(tableName: string): void {
	if (tableName.includes("\x00")) {
		throwMigrationError({
			adapter: "json",
			message: "Invalid table name: contains null byte",
			table: tableName,
		});
	}

	if (tableName.includes("/") || tableName.includes("\\")) {
		throwMigrationError({
			adapter: "json",
			message: "Invalid table name: contains path separators",
			table: tableName,
		});
	}

	if (tableName.includes("..")) {
		throwMigrationError({
			adapter: "json",
			message: "Invalid table name: contains parent directory reference",
			table: tableName,
		});
	}
}

/**
 * Bootstrap _forja metadata table for standalone mode.
 * Called during connect() when standalone: true is set in config.
 */
export async function createMetaTable(adapter: JsonAdapter): Promise<void> {
	const metaExists = await adapter.tableExists(FORJA_META_MODEL);
	if (metaExists) {
		return;
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

	await adapter.createTable(metaSchema);
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
			throwUniqueConstraintField({
				field: fieldName,
				value,
				adapter: "json",
				table: schema.tableName ?? "unknown",
			});
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
			throwUniqueConstraintIndex({
				fields: index.fields,
				table: schema.tableName ?? "unknown",
				adapter: "json",
			});
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
			throwForeignKeyConstraint({
				foreignKey,
				value: fkValue,
				targetModel: relationField.model,
				table: schema.tableName ?? "unknown",
				adapter: "json",
			});
		}
	}
}

type FkDependency = {
	tableName: string;
	fieldName: string;
	onDelete: NonNullable<ForeignKeyReference["onDelete"]>;
};

/**
 * Find all FK fields across all tables that reference the given table.
 */
async function findFkDependencies(
	targetTable: string,
	adapter: JsonAdapter,
): Promise<FkDependency[]> {
	const allTables = await adapter.getTables();
	const deps: FkDependency[] = [];

	for (const tableName of allTables) {
		const schema = await adapter.getSchemaByTableName(tableName);
		if (!schema?.fields) continue;

		for (const [fieldName, fieldDef] of Object.entries(schema.fields)) {
			if (fieldDef.type !== "number") continue;

			const numField = fieldDef as { references?: ForeignKeyReference };
			const ref = numField.references;
			if (!ref || ref.table !== targetTable) continue;

			const onDelete = ref.onDelete ?? "setNull";
			deps.push({ tableName, fieldName, onDelete });
		}
	}

	return deps;
}

/**
 * Apply ON DELETE actions for the JSON adapter before deleting rows.
 * Mimics SQL FK ON DELETE behavior: restrict, setNull, cascade.
 *
 * Must be called BEFORE the actual delete.
 * Uses adapter.executeQuery for transaction safety.
 */
export async function applyOnDeleteActions(
	targetTable: string,
	idsToDelete: ReadonlyArray<number>,
	adapter: JsonAdapter,
	queryOptions?: ExecuteQueryOptions,
): Promise<void> {
	if (idsToDelete.length === 0) return;

	const deps = await findFkDependencies(targetTable, adapter);
	if (deps.length === 0) return;

	// Pass 1: Check restrict constraints
	for (const dep of deps) {
		if (dep.onDelete !== "restrict") continue;

		const tableData = await adapter.getCachedTable(dep.tableName);
		if (!tableData) continue;

		const hasReference = tableData.data.some((row) =>
			idsToDelete.includes(row[dep.fieldName] as number),
		);

		if (hasReference) {
			throw new ForjaAdapterError(
				`Cannot delete from '${targetTable}': referenced by '${dep.tableName}.${dep.fieldName}' with ON DELETE RESTRICT`,
				{
					adapter: "json",
					code: "ADAPTER_FOREIGN_KEY_CONSTRAINT",
					operation: "query",
					context: {
						table: targetTable,
						referencedBy: `${dep.tableName}.${dep.fieldName}`,
					},
					suggestion: `Remove or update referencing rows in '${dep.tableName}' before deleting from '${targetTable}'`,
				},
			);
		}
	}

	// Pass 2: Apply setNull
	for (const dep of deps) {
		if (dep.onDelete !== "setNull") continue;

		await adapter.executeQueryWithOptions(
			{
				type: "update",
				table: dep.tableName,
				where: { [dep.fieldName]: { $in: idsToDelete } },
				data: { [dep.fieldName]: null },
			},
			queryOptions,
		);
	}

	// Pass 3: Apply cascade (recursive - child deletes trigger their own onDelete)
	for (const dep of deps) {
		if (dep.onDelete !== "cascade") continue;

		const tableData = await adapter.getCachedTable(dep.tableName);
		if (!tableData) continue;

		const childIds = tableData.data
			.filter((row) => idsToDelete.includes(row[dep.fieldName] as number))
			.map((row) => row["id"] as number);

		if (childIds.length === 0) continue;

		// Recursive: apply onDelete for children before deleting them
		await applyOnDeleteActions(dep.tableName, childIds, adapter, queryOptions);

		await adapter.executeQueryWithOptions(
			{
				type: "delete",
				table: dep.tableName,
				where: { id: { $in: childIds } },
			},
			queryOptions,
		);
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
		const fieldsToKeep = new Set(select as unknown as (keyof T)[]);

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
