/**
 * idType migration (int ↔ uuid)
 *
 * Switching `DatrixConfig.idType` on a database with data cannot be done with
 * ALTER TABLE: every primary key, foreign key and junction column changes
 * type, and the values themselves must be rewritten consistently. Instead the
 * migration goes through the adapter's export/import pipeline:
 *
 *   export (backup) → rewrite ids/FKs while reading → import with new schemas
 *
 * New ids keep the original creation order:
 * - int → uuid: UUID v7 generated from each row's `createdAt`
 * - uuid → int: sequential integers ordered by `createdAt`
 */

import type { ExportMeta, ImportReader } from "../types/adapter";
import type { FieldDefinition, SchemaDefinition } from "../types/core/schema";
import type { IdType, IdValue } from "../types/core/entry";
import {
	DATRIX_META_MODEL,
	DATRIX_META_KEY_PREFIX,
} from "../types/core/constants";
import { MigrationSystemError, SchemaDiff } from "../types/core/migration";
import { generateUuidV7 } from "../schema/id";

/**
 * Detected idType switch between database and config
 */
export interface IdTypeChange {
	readonly from: IdType;
	readonly to: IdType;
}

/**
 * old id → new id, per table (keys are the stringified old ids)
 */
export type IdMapping = Record<string, Record<string, IdValue>>;

/**
 * Outcome of an idType migration
 */
export interface IdTypeMigrationResult {
	readonly change: IdTypeChange;
	readonly mapping: IdMapping;
	/** Foreign keys that pointed at missing rows (set to null) */
	readonly nulledReferences: number;
	/** Junction rows that pointed at missing rows (dropped) */
	readonly droppedJunctionRows: number;
}

function isUserTable(tableName: string): boolean {
	return !tableName.startsWith("_datrix");
}

function isIdColumn(field: FieldDefinition | undefined): boolean {
	return field?.type === "number" || field?.type === "uuid";
}

function getReferencedTable(field: FieldDefinition): string | undefined {
	if (!isIdColumn(field)) return undefined;
	const references = (field as { references?: { table?: string } }).references;
	return references?.table;
}

/**
 * Derive the idType a database was created with from its stored schema
 * snapshots. Returns `null` when there are no user tables (nothing to convert).
 */
export function detectStoredIdType(
	schemas: ReadonlyMap<string, SchemaDefinition>,
): IdType | null {
	const kinds = new Set<IdType>();
	for (const [tableName, schema] of schemas) {
		if (!isUserTable(tableName)) continue;
		const idField = schema.fields["id"];
		if (!idField) continue;
		kinds.add(idField.type === "uuid" ? "uuid" : "int");
	}

	if (kinds.size > 1) {
		throw new MigrationSystemError(
			"Database contains both integer and uuid primary keys; cannot determine its idType",
			"MIGRATION_ERROR",
		);
	}
	const [kind] = kinds;
	return kind ?? null;
}

/**
 * Canonical JSON (sorted keys) for structural comparison
 */
function canonical(value: unknown): string {
	return JSON.stringify(value, (_key, val: unknown) => {
		if (val && typeof val === "object" && !Array.isArray(val)) {
			const sorted: Record<string, unknown> = {};
			for (const k of Object.keys(val as object).sort()) {
				sorted[k] = (val as Record<string, unknown>)[k];
			}
			return sorted;
		}
		return val;
	});
}

function stripIdKind(field: FieldDefinition): Record<string, unknown> {
	const {
		type: _type,
		autoIncrement: _autoIncrement,
		primary: _primary,
		...rest
	} = field as FieldDefinition & {
		autoIncrement?: unknown;
		primary?: unknown;
	};
	return rest;
}

/**
 * Whether a diff is purely the consequence of an idType switch: an id / FK /
 * junction column whose only change is number ↔ uuid (plus the PK flags that
 * come with it).
 */
export function isIdTypeOnlyDiff(diff: SchemaDiff): boolean {
	if (diff.type !== "fieldModified") return false;
	const { oldDefinition, newDefinition, fieldName } = diff;
	if (!isIdColumn(oldDefinition) || !isIdColumn(newDefinition)) return false;
	if (oldDefinition.type === newDefinition.type) return false;

	const isKey =
		fieldName === "id" ||
		getReferencedTable(oldDefinition) !== undefined ||
		getReferencedTable(newDefinition) !== undefined;
	if (!isKey) return false;

	return (
		canonical(stripIdKind(oldDefinition)) ===
		canonical(stripIdKind(newDefinition))
	);
}

function toTimestamp(value: unknown): number | undefined {
	if (value instanceof Date) return value.getTime();
	if (typeof value === "string" || typeof value === "number") {
		const time = new Date(value).getTime();
		return Number.isNaN(time) ? undefined : time;
	}
	return undefined;
}

function idKey(value: unknown): string {
	return typeof value === "string" ? value.toLowerCase() : String(value);
}

function compareOldIds(a: unknown, b: unknown): number {
	if (typeof a === "number" && typeof b === "number") return a - b;
	const sa = idKey(a);
	const sb = idKey(b);
	return sa < sb ? -1 : sa > sb ? 1 : 0;
}

interface RowRef {
	readonly oldId: unknown;
	readonly time: number | undefined;
}

/**
 * Assign new ids for one table, preserving creation order.
 */
function buildTableMapping(
	rows: readonly RowRef[],
	to: IdType,
): Record<string, IdValue> {
	const ordered = [...rows].sort((a, b) => {
		if (a.time !== undefined && b.time !== undefined && a.time !== b.time) {
			return a.time - b.time;
		}
		return compareOldIds(a.oldId, b.oldId);
	});

	const mapping: Record<string, IdValue> = {};

	if (to === "int") {
		ordered.forEach((row, index) => {
			mapping[idKey(row.oldId)] = index + 1;
		});
		return mapping;
	}

	// Rows created in the same millisecond get random-suffixed v7 ids; sorting
	// the generated ids and handing them out in row order keeps id order equal
	// to creation order without shifting any timestamp.
	const fallback = Date.now();
	const ids = ordered.map((row) => generateUuidV7(row.time ?? fallback));
	const sortedIds = [...ids].sort();
	ordered.forEach((row, index) => {
		mapping[idKey(row.oldId)] = sortedIds[index]!;
	});
	return mapping;
}

/**
 * Wrap a backup reader so that it yields the target schemas and rows with
 * rewritten ids. Pass 1 (here) reads every table once to build the mapping;
 * the rewrite itself happens lazily while the adapter imports.
 *
 * @param source - Reader over the backup taken before the switch
 * @param targetSchemas - Current registry schemas keyed by table name
 * @param change - Detected idType switch
 */
export async function createIdTypeTransform(
	source: ImportReader,
	targetSchemas: ReadonlyMap<string, SchemaDefinition>,
	change: IdTypeChange,
): Promise<{
	reader: ImportReader;
	result: () => IdTypeMigrationResult;
}> {
	const sourceSchemas = new Map<string, SchemaDefinition>();
	for await (const schema of source.readSchemas()) {
		sourceSchemas.set(schema.tableName ?? schema.name, schema);
	}

	const tables = await source.getTables();

	for (const tableName of tables) {
		if (isUserTable(tableName) && !targetSchemas.has(tableName)) {
			throw new MigrationSystemError(
				`Table '${tableName}' has no schema in the current config; apply other schema changes before switching idType`,
				"MIGRATION_ERROR",
			);
		}
	}

	// Pass 1: old id → new id for every user table
	const mapping: IdMapping = {};
	for (const tableName of tables) {
		if (!isUserTable(tableName)) continue;
		const refs: RowRef[] = [];
		for await (const chunk of source.readChunks(tableName)) {
			for (const row of chunk) {
				if (row["id"] == null) continue;
				refs.push({ oldId: row["id"], time: toTimestamp(row["createdAt"]) });
			}
		}
		mapping[tableName] = buildTableMapping(refs, change.to);
	}

	let nulledReferences = 0;
	let droppedJunctionRows = 0;

	const rewriteRow = (
		tableName: string,
		row: Record<string, unknown>,
		sourceSchema: SchemaDefinition | undefined,
	): Record<string, unknown> | null => {
		const tableMap = mapping[tableName]!;
		const next: Record<string, unknown> = { ...row };

		if (row["id"] != null) {
			next["id"] = tableMap[idKey(row["id"])];
		}

		if (!sourceSchema) return next;

		for (const [fieldName, field] of Object.entries(sourceSchema.fields)) {
			if (fieldName === "id") continue;
			const refTable = getReferencedTable(field);
			if (!refTable) continue;
			const value = row[fieldName];
			if (value == null) continue;

			const mapped = mapping[refTable]?.[idKey(value)];
			if (mapped !== undefined) {
				next[fieldName] = mapped;
				continue;
			}

			// Dangling reference: junction rows are meaningless without both
			// ends, plain FKs fall back to null.
			if (sourceSchema._isJunctionTable) {
				droppedJunctionRows++;
				return null;
			}
			nulledReferences++;
			next[fieldName] = null;
		}

		return next;
	};

	const rewriteMetaRow = (
		row: Record<string, unknown>,
	): Record<string, unknown> => {
		const key = row["key"];
		if (typeof key !== "string" || !key.startsWith(DATRIX_META_KEY_PREFIX)) {
			return row;
		}
		const table = key.slice(DATRIX_META_KEY_PREFIX.length);
		const target = targetSchemas.get(table);
		if (!target || !isUserTable(table)) return row;
		return { ...row, value: JSON.stringify(target) };
	};

	const reader: ImportReader = {
		readMeta(): Promise<ExportMeta> {
			return source.readMeta();
		},
		async *readSchemas(): AsyncIterable<SchemaDefinition> {
			for (const [tableName, schema] of sourceSchemas) {
				yield isUserTable(tableName)
					? (targetSchemas.get(tableName) ?? schema)
					: schema;
			}
		},
		getTables(): Promise<readonly string[]> {
			return source.getTables();
		},
		async *readChunks(
			tableName: string,
		): AsyncIterable<Record<string, unknown>[]> {
			const sourceSchema = sourceSchemas.get(tableName);
			for await (const chunk of source.readChunks(tableName)) {
				if (tableName === DATRIX_META_MODEL) {
					yield chunk.map(rewriteMetaRow);
				} else if (!isUserTable(tableName)) {
					yield chunk;
				} else {
					const rows: Record<string, unknown>[] = [];
					for (const row of chunk) {
						const next = rewriteRow(tableName, row, sourceSchema);
						if (next) rows.push(next);
					}
					yield rows;
				}
			}
		},
	};

	return {
		reader,
		result: () => ({
			change,
			mapping,
			nulledReferences,
			droppedJunctionRows,
		}),
	};
}
