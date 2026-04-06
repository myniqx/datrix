/**
 * MongoDB ON DELETE Actions
 *
 * MongoDB has no FK constraints, so we manually apply
 * ON DELETE behavior (restrict, setNull, cascade) before deleting rows.
 *
 * Mirrors the JSON adapter's applyOnDeleteActions logic.
 */

import type {
	ForeignKeyReference,
	ForjaEntry,
	ISchemaRegistry,
} from "@forja/core/types";
import type { MongoClient } from "./mongo-client";
import { ForjaAdapterError } from "@forja/core/types/errors";

interface FkDependency {
	readonly tableName: string;
	readonly fieldName: string;
	readonly onDelete: NonNullable<ForeignKeyReference["onDelete"]>;
}

/**
 * Find all FK fields across all schemas that reference the given table.
 */
function findFkDependencies(
	targetTable: string,
	schemaRegistry: ISchemaRegistry,
): readonly FkDependency[] {
	const deps: FkDependency[] = [];

	for (const schema of schemaRegistry.getAll()) {
		const tableName = schema.tableName ?? schema.name.toLowerCase();

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
 * Apply ON DELETE actions before deleting rows from a MongoDB collection.
 * Mimics SQL FK ON DELETE behavior: restrict, setNull, cascade.
 *
 * Must be called BEFORE the actual delete.
 */
export async function applyOnDeleteActions<T extends ForjaEntry>(
	targetTable: string,
	idsToDelete: readonly number[],
	client: MongoClient<T>,
	schemaRegistry: ISchemaRegistry,
): Promise<void> {
	if (idsToDelete.length === 0) return;

	const deps = findFkDependencies(targetTable, schemaRegistry);
	if (deps.length === 0) return;

	const sessionOpts = client.sessionOptions();

	// Pass 1: Check restrict constraints
	for (const dep of deps) {
		if (dep.onDelete !== "restrict") continue;

		const col = client.getCollection(dep.tableName);
		const count = await client.execute(
			`onDelete:restrict:${dep.tableName}`,
			() =>
				col.countDocuments(
					{ [dep.fieldName]: { $in: idsToDelete } },
					sessionOpts,
				),
		);

		if (count > 0) {
			throw new ForjaAdapterError(
				`Cannot delete from '${targetTable}': referenced by '${dep.tableName}.${dep.fieldName}' with ON DELETE RESTRICT`,
				{
					adapter: "mongodb",
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

		const col = client.getCollection(dep.tableName);
		await client.execute(`onDelete:setNull:${dep.tableName}`, () =>
			col.updateMany(
				{ [dep.fieldName]: { $in: idsToDelete } },
				{ $set: { [dep.fieldName]: null } },
				sessionOpts,
			),
		);
	}

	// Pass 3: Apply cascade (recursive — child deletes trigger their own onDelete)
	for (const dep of deps) {
		if (dep.onDelete !== "cascade") continue;

		const col = client.getCollection(dep.tableName);
		const childDocs = await client.execute(
			`onDelete:cascade:find:${dep.tableName}`,
			() =>
				col
					.find(
						{ [dep.fieldName]: { $in: idsToDelete } },
						{ ...sessionOpts, projection: { _id: 0, id: 1 } },
					)
					.toArray(),
		);

		const childIds = childDocs.map((d) => d["id"] as number);
		if (childIds.length === 0) continue;

		// Recursive: apply onDelete for children before deleting them
		await applyOnDeleteActions(dep.tableName, childIds, client, schemaRegistry);

		await client.execute(`onDelete:cascade:delete:${dep.tableName}`, () =>
			col.deleteMany({ id: { $in: childIds } }, sessionOpts),
		);
	}
}
