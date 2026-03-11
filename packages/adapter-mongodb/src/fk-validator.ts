/**
 * MongoDB Foreign Key Validator
 *
 * MongoDB has no FK constraints, so we validate referential integrity
 * manually before insert/update operations.
 *
 * Checks that referenced IDs exist in the target collection.
 */

import type {
	SchemaDefinition,
	FieldDefinition,
} from "forja-types/core/schema";
import type { SchemaRegistry } from "forja-core/schema";
import type { MongoClient } from "./mongo-client";
import { throwQueryError } from "forja-types/errors/adapter";

/**
 * Validate FK references in documents before insert.
 * Throws if any referenced ID does not exist.
 */
export async function validateFkReferences(
	collection: string,
	documents: readonly Record<string, unknown>[],
	client: MongoClient,
	schemaRegistry: SchemaRegistry,
): Promise<void> {
	const modelName = schemaRegistry.findModelByTableName(collection);
	if (!modelName) return;
	const schema = schemaRegistry.get(modelName);
	if (!schema) return;

	const fkChecks = collectFkChecks(schema, documents);
	await runFkChecks(fkChecks, client);
}

/**
 * Validate FK references in update data.
 * Only checks fields present in the update $set.
 */
export async function validateFkReferencesForUpdate(
	collection: string,
	updateData: Record<string, unknown>,
	client: MongoClient,
	schemaRegistry: SchemaRegistry,
): Promise<void> {
	const modelName = schemaRegistry.findModelByTableName(collection);
	if (!modelName) return;
	const schema = schemaRegistry.get(modelName);
	if (!schema) return;

	const fkChecks = collectFkChecks(schema, [updateData]);
	await runFkChecks(fkChecks, client);
}

/**
 * Collected FK check: targetTable + set of IDs to verify
 */
interface FkCheck {
	readonly targetTable: string;
	readonly fieldName: string;
	readonly ids: Set<number>;
}

/**
 * Collect all FK fields and their referenced IDs from documents
 */
function collectFkChecks(
	schema: SchemaDefinition,
	documents: readonly Record<string, unknown>[],
): readonly FkCheck[] {
	const checksMap = new Map<string, FkCheck>();

	for (const [fieldName, fieldDef] of Object.entries(schema.fields)) {
		if (!hasReferences(fieldDef)) continue;

		const refs = fieldDef.references!;
		const targetTable = refs.table;
		const key = `${targetTable}:${fieldName}`;

		for (const doc of documents) {
			const value = doc[fieldName];
			if (value == null || typeof value !== "number") continue;

			if (!checksMap.has(key)) {
				checksMap.set(key, { targetTable, fieldName, ids: new Set() });
			}
			checksMap.get(key)!.ids.add(value);
		}
	}

	return [...checksMap.values()];
}

/**
 * Run FK checks: verify all referenced IDs exist
 */
async function runFkChecks(
	checks: readonly FkCheck[],
	client: MongoClient,
): Promise<void> {
	for (const check of checks) {
		if (check.ids.size === 0) continue;

		const idsArray = [...check.ids];
		const col = client.getCollection(check.targetTable);
		const sessionOpts = client.sessionOptions();

		const existingDocs = await client.execute(
			`fkCheck:${check.targetTable}`,
			() =>
				col
					.find(
						{ id: { $in: idsArray } },
						{ ...sessionOpts, projection: { _id: 0, id: 1 } },
					)
					.toArray(),
		);

		const existingIds = new Set(existingDocs.map((d) => d["id"] as number));
		const missingIds = idsArray.filter((id) => !existingIds.has(id));

		if (missingIds.length > 0) {
			throwQueryError({
				adapter: "mongodb",
				message: `Foreign key constraint failed: referenced id(s) [${missingIds.join(", ")}] not found in '${check.targetTable}' (field: '${check.fieldName}')`,
			});
		}
	}
}

/**
 * Type guard for fields with references
 */
function hasReferences(
	field: FieldDefinition,
): field is FieldDefinition & {
	references: { table: string; column?: string };
} {
	return (
		"references" in field &&
		field.references != null &&
		typeof field.references === "object" &&
		"table" in field.references
	);
}
