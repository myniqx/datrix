/**
 * Schema Differ Implementation (~300 LOC)
 *
 * Compares two schema versions and detects differences.
 * Produces structured diff objects for migration generation.
 */

import {
	MigrationSystemError,
	SchemaComparison,
	SchemaDiff,
	SchemaDiffer,
} from "forja-types/core/migration";
import { FieldDefinition, SchemaDefinition } from "forja-types/core/schema";
import { Result } from "forja-types/utils";

/**
 * Type guard for SchemaDefinition
 */
function isSchemaDefinition(value: unknown): value is SchemaDefinition {
	return (
		typeof value === "object" &&
		value !== null &&
		"name" in value &&
		typeof (value as Record<string, unknown>)["name"] === "string" &&
		"fields" in value &&
		typeof (value as Record<string, unknown>)["fields"] === "object"
	);
}

/**
 * Type guard for FieldDefinition
 */
function isFieldDefinition(value: unknown): value is FieldDefinition {
	return (
		typeof value === "object" &&
		value !== null &&
		"type" in value &&
		typeof (value as Record<string, unknown>)["type"] === "string"
	);
}

/**
 * Type guard for valid index types
 */
function isValidIndexType(
	type: string,
): type is "btree" | "hash" | "gist" | "gin" {
	return ["btree", "hash", "gist", "gin"].includes(type);
}

/**
 * Schema differ implementation
 */
export class ForgeSchemaDiffer implements SchemaDiffer {
	/**
	 * Compare two schema collections
	 */
	compare(
		oldSchemas: Record<string, SchemaDefinition>,
		newSchemas: Record<string, SchemaDefinition>,
	): Result<SchemaComparison, MigrationSystemError> {
		try {
			const differences: SchemaDiff[] = [];

			const oldTableNames = new Set(Object.keys(oldSchemas));
			const newTableNames = new Set(Object.keys(newSchemas));

			// Find added tables
			for (const tableName of newTableNames) {
				if (!oldTableNames.has(tableName)) {
					const schema = newSchemas[tableName];
					if (!isSchemaDefinition(schema)) {
						return {
							success: false,
							error: new MigrationSystemError(
								`Invalid schema definition for table '${tableName}'`,
								"DIFF_ERROR",
							),
						};
					}

					differences.push({
						type: "tableAdded",
						schema,
					});
				}
			}

			// Find removed tables
			for (const tableName of oldTableNames) {
				if (!newTableNames.has(tableName)) {
					differences.push({
						type: "tableRemoved",
						tableName,
					});
				}
			}

			// Find modified tables
			for (const tableName of newTableNames) {
				if (oldTableNames.has(tableName)) {
					const oldSchema = oldSchemas[tableName];
					const newSchema = newSchemas[tableName];

					if (
						!isSchemaDefinition(oldSchema) ||
						!isSchemaDefinition(newSchema)
					) {
						return {
							success: false,
							error: new MigrationSystemError(
								`Invalid schema definition for table '${tableName}'`,
								"DIFF_ERROR",
							),
						};
					}

					const tableDiffs = this.compareTable(oldSchema, newSchema);
					differences.push(...tableDiffs);
				}
			}

			const resolvedDifferences = this.resolveCrossSchemaNoOps(differences, oldSchemas, newSchemas);

			return {
				success: true,
				data: {
					differences: resolvedDifferences,
					hasChanges: resolvedDifferences.length > 0,
				},
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				success: false,
				error: new MigrationSystemError(
					`Failed to compare schemas: ${message}`,
					"DIFF_ERROR",
					error,
				),
			};
		}
	}

	/**
	 * Resolve cross-schema no-ops after all per-table diffs are produced.
	 *
	 * Cases eliminated:
	 * 1. hasOne/hasMany removed from table A  +  belongsTo added to table B
	 *    → same FK column on B, no DB change
	 * 2. belongsTo removed from table B  +  hasOne/hasMany added to table A
	 *    → same FK column on B, no DB change
	 * 3. manyToMany added to table B while table A already declares it
	 *    → junction table already exists, no DB change
	 * 4. manyToMany removed from one side while other side still declares it
	 *    → junction table still needed, suppress tableRemoved
	 */
	private resolveCrossSchemaNoOps(
		differences: SchemaDiff[],
		oldSchemas: Record<string, SchemaDefinition>,
		newSchemas: Record<string, SchemaDefinition>,
	): SchemaDiff[] {
		const toRemove = new Set<number>();

		// Index diffs for fast lookup
		const fieldAdded: Array<{ index: number; diff: SchemaDiff & { type: "fieldAdded" } }> = [];
		const fieldRemoved: Array<{ index: number; diff: SchemaDiff & { type: "fieldRemoved" } }> = [];
		const tableRemoved: Array<{ index: number; diff: SchemaDiff & { type: "tableRemoved" } }> = [];

		for (let i = 0; i < differences.length; i++) {
			const diff = differences[i];
			if (diff === undefined) continue;
			if (diff.type === "fieldAdded") {
				fieldAdded.push({ index: i, diff: diff as SchemaDiff & { type: "fieldAdded" } });
			} else if (diff.type === "fieldRemoved") {
				fieldRemoved.push({ index: i, diff: diff as SchemaDiff & { type: "fieldRemoved" } });
			} else if (diff.type === "tableRemoved") {
				tableRemoved.push({ index: i, diff: diff as SchemaDiff & { type: "tableRemoved" } });
			}
		}

		// Build lookup maps by table name for both old and new schemas
		const newSchemaByTable = new Map<string, SchemaDefinition>();
		for (const schema of Object.values(newSchemas)) {
			newSchemaByTable.set(schema.tableName ?? schema.name, schema);
		}

		const oldSchemaByTable = new Map<string, SchemaDefinition>();
		for (const schema of Object.values(oldSchemas)) {
			oldSchemaByTable.set(schema.tableName ?? schema.name, schema);
		}

		// Case 1 & 2: hasOne/hasMany ↔ belongsTo cross-table flip
		// The FK column lives on the target table in both cases.
		// We match a removed relation on one side with an added relation on
		// the other side that resolves to the same physical FK column.
		// Removed fields must be looked up in oldSchemas since they no longer
		// exist in newSchemas.
		for (const removed of fieldRemoved) {
			const removedField = this.getFieldFromSchemas(
				removed.diff.tableName,
				removed.diff.fieldName,
				oldSchemaByTable,
				oldSchemas,
			);

			if (!removedField || removedField.type !== "relation") continue;
			if (removedField.kind === "manyToMany") continue;

			for (const added of fieldAdded) {
				if (toRemove.has(added.index)) continue;

				const addedDef = added.diff.definition;
				if (addedDef.type !== "relation") continue;
				if (addedDef.kind === "manyToMany") continue;

				const match = this.isCrossSchemaFkNoOp(
					removed.diff.tableName,
					removedField,
					added.diff.tableName,
					addedDef,
					newSchemaByTable,
					newSchemas,
					oldSchemaByTable,
					oldSchemas,
				);

				if (match) {
					toRemove.add(removed.index);
					toRemove.add(added.index);
					break;
				}
			}
		}

		// Case 3: manyToMany added on second side — junction table already exists
		// If the junction table is not being created in this migration it means
		// it already exists in the DB → this fieldAdded is a no-op.
		for (const added of fieldAdded) {
			if (toRemove.has(added.index)) continue;

			const addedDef = added.diff.definition;
			if (addedDef.type !== "relation" || addedDef.kind !== "manyToMany") continue;

			const ownerSchema = newSchemaByTable.get(added.diff.tableName)
				?? newSchemas[added.diff.tableName];
			const ownerModelName = ownerSchema?.name ?? added.diff.tableName;

			const junctionName = this.resolveJunctionTableName(
				ownerModelName,
				addedDef.model,
				addedDef.through,
				newSchemaByTable,
				newSchemas,
			);

			if (junctionName === undefined) continue;

			const junctionBeingCreated = differences.some(
				(d) =>
					d.type === "tableAdded" &&
					(d.schema.tableName ?? d.schema.name) === junctionName,
			);

			if (!junctionBeingCreated) {
				toRemove.add(added.index);
			}
		}

		// Case 3b: hasOne/hasMany added — FK column already exists in DB
		// This happens when belongsTo already existed on the other side.
		// The FK column is already present so the fieldAdded is a no-op.
		for (const added of fieldAdded) {
			if (toRemove.has(added.index)) continue;

			const addedDef = added.diff.definition;
			if (addedDef.type !== "relation") continue;
			if (addedDef.kind !== "hasOne" && addedDef.kind !== "hasMany") continue;

			const ownerSchema = newSchemaByTable.get(added.diff.tableName)
				?? newSchemas[added.diff.tableName];
			const ownerModelName = ownerSchema?.name ?? added.diff.tableName;

			const fkTable = this.resolveModelTableName(addedDef.model, newSchemaByTable, newSchemas);
			const fkColumn = addedDef.foreignKey ?? `${ownerModelName}Id`;

			if (fkTable === undefined) continue;

			// Check if this FK column already exists in old schemas (already in DB)
			const fkTableOldSchema = oldSchemaByTable.get(fkTable) ?? oldSchemas[fkTable];
			if (fkTableOldSchema && fkColumn in fkTableOldSchema.fields) {
				toRemove.add(added.index);
			}
		}

		// Case 4: manyToMany removed from one side — other side still declares it
		// Suppress tableRemoved for the junction table if it is still referenced.
		for (const removed of tableRemoved) {
			if (toRemove.has(removed.index)) continue;

			const junctionName = removed.diff.tableName;

			const stillReferenced = this.isJunctionTableStillReferenced(
				junctionName,
				newSchemas,
				newSchemaByTable,
			);

			if (stillReferenced) {
				toRemove.add(removed.index);
			}
		}

		// Case 4b: manyToMany fieldRemoved on one side — other side still declares it
		// The junction table still exists so this fieldRemoved is a no-op.
		for (const removed of fieldRemoved) {
			if (toRemove.has(removed.index)) continue;

			const removedField = this.getFieldFromSchemas(
				removed.diff.tableName,
				removed.diff.fieldName,
				oldSchemaByTable,
				oldSchemas,
			);

			if (!removedField || removedField.type !== "relation" || removedField.kind !== "manyToMany") continue;

			const ownerSchema = oldSchemaByTable.get(removed.diff.tableName)
				?? oldSchemas[removed.diff.tableName];
			const ownerModelName = ownerSchema?.name ?? removed.diff.tableName;

			const junctionName = this.resolveJunctionTableName(
				ownerModelName,
				removedField.model,
				removedField.through,
				newSchemaByTable,
				newSchemas,
			);

			if (junctionName === undefined) continue;

			const stillReferenced = this.isJunctionTableStillReferenced(
				junctionName,
				newSchemas,
				newSchemaByTable,
			);

			if (stillReferenced) {
				toRemove.add(removed.index);
			}
		}

		return differences.filter((_, i) => !toRemove.has(i));
	}

	/**
	 * Get a field definition from schemas, trying by table name then schema name.
	 */
	private getFieldFromSchemas(
		tableName: string,
		fieldName: string,
		schemaByTable: Map<string, SchemaDefinition>,
		schemas: Record<string, SchemaDefinition>,
	): FieldDefinition | undefined {
		const byTable = schemaByTable.get(tableName);
		if (byTable) {
			const field = byTable.fields[fieldName];
			if (isFieldDefinition(field)) return field;
		}
		const byName = schemas[tableName];
		if (byName) {
			const field = byName.fields[fieldName];
			if (isFieldDefinition(field)) return field;
		}
		return undefined;
	}

	/**
	 * Determine if a removed relation on tableA and an added relation on tableB
	 * resolve to the same physical FK column — making both diffs a no-op.
	 *
	 * Removed fields are resolved against oldSchemas (they no longer exist in new).
	 * Added fields are resolved against newSchemas.
	 */
	private isCrossSchemaFkNoOp(
		removedTableName: string,
		removedField: FieldDefinition & { type: "relation" },
		addedTableName: string,
		addedField: FieldDefinition & { type: "relation" },
		newSchemaByTable: Map<string, SchemaDefinition>,
		newSchemas: Record<string, SchemaDefinition>,
		oldSchemaByTable: Map<string, SchemaDefinition>,
		oldSchemas: Record<string, SchemaDefinition>,
	): boolean {
		// Resolve FK location for the removed side using old schema context
		const removedFkTable = this.resolveFkTable(
			removedTableName, removedField, oldSchemaByTable, oldSchemas,
		);
		const removedFkColumn = this.resolveFkColumn(
			removedTableName, removedField, oldSchemaByTable, oldSchemas,
		);

		// Resolve FK location for the added side using new schema context
		const addedFkTable = this.resolveFkTable(
			addedTableName, addedField, newSchemaByTable, newSchemas,
		);
		const addedFkColumn = this.resolveFkColumn(
			addedTableName, addedField, newSchemaByTable, newSchemas,
		);

		if (removedFkTable === undefined || addedFkTable === undefined) return false;
		if (removedFkColumn === undefined || addedFkColumn === undefined) return false;

		return removedFkTable === addedFkTable && removedFkColumn === addedFkColumn;
	}

	/**
	 * Resolve which table the FK column physically lives on.
	 * - belongsTo: FK is on the owner table (tableName itself)
	 * - hasOne/hasMany: FK is on the target (model) table
	 */
	private resolveFkTable(
		tableName: string,
		field: FieldDefinition & { type: "relation" },
		schemaByTable: Map<string, SchemaDefinition>,
		schemas: Record<string, SchemaDefinition>,
	): string | undefined {
		if (field.kind === "belongsTo") {
			return tableName;
		}
		return this.resolveModelTableName(field.model, schemaByTable, schemas);
	}

	/**
	 * Resolve the FK column name for a relation field.
	 * - belongsTo: foreignKey ?? model + "Id"
	 * - hasOne/hasMany: foreignKey ?? ownerModelName + "Id"
	 */
	private resolveFkColumn(
		tableName: string,
		field: FieldDefinition & { type: "relation" },
		schemaByTable: Map<string, SchemaDefinition>,
		schemas: Record<string, SchemaDefinition>,
	): string | undefined {
		if (field.foreignKey !== undefined) {
			return field.foreignKey;
		}
		if (field.kind === "belongsTo") {
			return `${field.model}Id`;
		}
		// hasOne / hasMany: default FK is ownerModelName + "Id"
		const ownerSchema = schemaByTable.get(tableName) ?? schemas[tableName];
		const ownerModelName = ownerSchema?.name ?? tableName;
		return `${ownerModelName}Id`;
	}

	/**
	 * Resolve a model name to its table name.
	 */
	private resolveModelTableName(
		modelName: string,
		schemaByTable: Map<string, SchemaDefinition>,
		schemas: Record<string, SchemaDefinition>,
	): string | undefined {
		const byName = schemas[modelName];
		if (byName) return byName.tableName ?? byName.name;

		for (const schema of Object.values(schemas)) {
			if (schema.name === modelName) return schema.tableName ?? schema.name;
		}

		// Also check by table name directly
		if (schemaByTable.has(modelName)) return modelName;

		return undefined;
	}

	/**
	 * Resolve the junction table name for a manyToMany relation.
	 * ownerModelName is the schema name (not table name), same as registry logic.
	 */
	private resolveJunctionTableName(
		ownerModelName: string,
		targetModelName: string,
		through: string | undefined,
		_newSchemaByTable: Map<string, SchemaDefinition>,
		_newSchemas: Record<string, SchemaDefinition>,
	): string | undefined {
		if (through !== undefined) return through;

		// Alphabetical order by model name, same as registry
		const parts = [ownerModelName, targetModelName].sort();
		return `${parts[0]}_${parts[1]}`;
	}

	/**
	 * Check if a junction table is still referenced by any manyToMany
	 * relation in the new schemas.
	 */
	private isJunctionTableStillReferenced(
		junctionName: string,
		newSchemas: Record<string, SchemaDefinition>,
		newSchemaByTable: Map<string, SchemaDefinition>,
	): boolean {
		for (const schema of Object.values(newSchemas)) {
			const ownerModelName = schema.name;
			for (const field of Object.values(schema.fields)) {
				if (!isFieldDefinition(field)) continue;
				if (field.type !== "relation" || field.kind !== "manyToMany") continue;

				const resolved = this.resolveJunctionTableName(
					ownerModelName,
					field.model,
					field.through,
					newSchemaByTable,
					newSchemas,
				);

				if (resolved === junctionName) return true;
			}
		}
		return false;
	}

	/**
	 * Check if two relation fields have the same DB structure.
	 * hasOne and hasMany both place the FK on the target table,
	 * so switching between them requires no DB change.
	 */
	private isSameRelationDbStructure(
		oldField: FieldDefinition,
		newField: FieldDefinition,
	): boolean {
		if (oldField.type !== "relation" || newField.type !== "relation") {
			return false;
		}

		const sameModel = oldField.model === newField.model;
		const sameForeignKey = oldField.foreignKey === newField.foreignKey;

		const oldKind = oldField.kind;
		const newKind = newField.kind;
		const isHasOneHasManySwap =
			(oldKind === "hasOne" && newKind === "hasMany") ||
			(oldKind === "hasMany" && newKind === "hasOne");

		// hasOne <-> hasMany: FK stays on target table, no DB change
		if (isHasOneHasManySwap && sameModel && sameForeignKey) {
			return true;
		}

		return false;
	}

	/**
	 * Compare two versions of the same table
	 */
	private compareTable(
		oldSchema: SchemaDefinition,
		newSchema: SchemaDefinition,
	): SchemaDiff[] {
		const differences: SchemaDiff[] = [];
		const tableName = newSchema.tableName ?? newSchema.name;

		const oldFieldNames = new Set(Object.keys(oldSchema.fields));
		const newFieldNames = new Set(Object.keys(newSchema.fields));

		// For relation fields not present by name: check if a same-DB-structure
		// relation exists under a different name (e.g. hasOne->hasMany rename).
		// If so, skip both the removed and added diff for those fields.
		const skippedOldFields = new Set<string>();
		const skippedNewFields = new Set<string>();

		for (const newFieldName of newFieldNames) {
			if (oldFieldNames.has(newFieldName)) continue;

			const newField = newSchema.fields[newFieldName];
			if (!isFieldDefinition(newField) || newField.type !== "relation") continue;

			for (const oldFieldName of oldFieldNames) {
				if (newFieldNames.has(oldFieldName)) continue;
				if (skippedOldFields.has(oldFieldName)) continue;

				const oldField = oldSchema.fields[oldFieldName];
				if (!isFieldDefinition(oldField) || oldField.type !== "relation") continue;

				if (this.isSameRelationDbStructure(oldField, newField)) {
					skippedOldFields.add(oldFieldName);
					skippedNewFields.add(newFieldName);
					break;
				}
			}
		}

		// Find added fields
		for (const fieldName of newFieldNames) {
			if (oldFieldNames.has(fieldName)) continue;
			if (skippedNewFields.has(fieldName)) continue;

			const definition = newSchema.fields[fieldName];
			if (!isFieldDefinition(definition)) {
				// Skip invalid field definitions
				continue;
			}

			differences.push({
				type: "fieldAdded",
				tableName,
				fieldName,
				definition,
			});
		}

		// Find removed fields
		for (const fieldName of oldFieldNames) {
			if (newFieldNames.has(fieldName)) continue;
			if (skippedOldFields.has(fieldName)) continue;

			differences.push({
				type: "fieldRemoved",
				tableName,
				fieldName,
			});
		}

		// Find modified fields
		for (const fieldName of newFieldNames) {
			if (oldFieldNames.has(fieldName)) {
				const oldField = oldSchema.fields[fieldName];
				const newField = newSchema.fields[fieldName];

				if (!isFieldDefinition(oldField) || !isFieldDefinition(newField)) {
					// Skip invalid field definitions
					continue;
				}

				if (this.isFieldModified(oldField, newField)) {
					differences.push({
						type: "fieldModified",
						tableName,
						fieldName,
						oldDefinition: oldField,
						newDefinition: newField,
					});
				}
			}
		}

		// Compare indexes if present
		if (oldSchema.indexes || newSchema.indexes) {
			const indexDiffs = this.compareIndexes(
				tableName,
				oldSchema.indexes ?? [],
				newSchema.indexes ?? [],
			);
			differences.push(...indexDiffs);
		}

		return differences;
	}

	/**
	 * Check if a field has been modified
	 */
	isFieldModified(
		oldField: FieldDefinition,
		newField: FieldDefinition,
	): boolean {
		// Check type change
		if (oldField.type !== newField.type) {
			return true;
		}

		// Check required change
		if (oldField.required !== newField.required) {
			return true;
		}

		// Check unique constraint change
		const oldUnique =
			"unique" in oldField
				? (oldField as { unique?: boolean }).unique
				: undefined;
		const newUnique =
			"unique" in newField
				? (newField as { unique?: boolean }).unique
				: undefined;
		if (oldUnique !== newUnique) {
			return true;
		}

		// Check default value change
		if (oldField.default !== newField.default) {
			return true;
		}

		// Type-specific checks with proper type narrowing
		switch (oldField.type) {
			case "string":
				// Type narrowing
				if (newField.type !== "string") {
					return true;
				}
				if (
					oldField.maxLength !== newField.maxLength ||
					oldField.minLength !== newField.minLength ||
					oldField.pattern !== newField.pattern
				) {
					return true;
				}
				break;

			case "number":
				// Type narrowing
				if (newField.type !== "number") {
					return true;
				}
				if (oldField.min !== newField.min || oldField.max !== newField.max) {
					return true;
				}
				break;

			case "array":
				// Type narrowing
				if (newField.type !== "array") {
					return true;
				}
				if (
					oldField.items !== newField.items ||
					oldField.minItems !== newField.minItems ||
					oldField.maxItems !== newField.maxItems ||
					("unique" in oldField &&
						"unique" in newField &&
						oldField.unique !== newField.unique)
				) {
					return true;
				}
				break;

			case "enum":
				// Type narrowing
				if (newField.type !== "enum") {
					return true;
				}
				// Check if enum values changed
				if (oldField.values && newField.values) {
					const oldValues = new Set(oldField.values);
					const newValues = new Set(newField.values);

					if (oldValues.size !== newValues.size) {
						return true;
					}

					for (const value of oldValues) {
						if (!newValues.has(value)) {
							return true;
						}
					}
				}
				break;

			case "relation":
				// Type narrowing
				if (newField.type !== "relation") {
					return true;
				}
				if (
					oldField.model !== newField.model ||
					oldField.foreignKey !== newField.foreignKey ||
					oldField.through !== newField.through ||
					oldField.onDelete !== newField.onDelete ||
					oldField.onUpdate !== newField.onUpdate
				) {
					return true;
				}
				// hasOne <-> hasMany does not change DB structure
				if (oldField.kind !== newField.kind) {
					const isHasOneHasManySwap =
						(oldField.kind === "hasOne" && newField.kind === "hasMany") ||
						(oldField.kind === "hasMany" && newField.kind === "hasOne");
					if (!isHasOneHasManySwap) {
						return true;
					}
				}
				break;
		}

		return false;
	}

	/**
	 * Compare indexes between two schema versions
	 */
	private compareIndexes(
		tableName: string,
		oldIndexes: readonly {
			readonly name?: string;
			readonly fields: readonly string[];
			readonly unique?: boolean;
			readonly type?: string;
		}[],
		newIndexes: readonly {
			readonly name?: string;
			readonly fields: readonly string[];
			readonly unique?: boolean;
			readonly type?: string;
		}[],
	): SchemaDiff[] {
		const differences: SchemaDiff[] = [];

		// Create index maps keyed by normalized signature
		const oldIndexMap = new Map(
			oldIndexes.map((idx) => [this.getIndexSignature(idx), idx]),
		);
		const newIndexMap = new Map(
			newIndexes.map((idx) => [this.getIndexSignature(idx), idx]),
		);

		// Find added indexes
		for (const [signature, index] of newIndexMap) {
			if (!oldIndexMap.has(signature)) {
				differences.push({
					type: "indexAdded",
					tableName,
					index: {
						...(index.name !== undefined && { name: index.name }),
						fields: index.fields,
						...(index.unique !== undefined && { unique: index.unique }),
						...(index.type !== undefined &&
							isValidIndexType(index.type) && { type: index.type }),
					},
				});
			}
		}

		// Find removed indexes
		for (const [signature, index] of oldIndexMap) {
			if (!newIndexMap.has(signature)) {
				const indexName =
					index.name ?? `idx_${tableName}_${index.fields.join("_")}`;
				differences.push({
					type: "indexRemoved",
					tableName,
					indexName,
				});
			}
		}

		return differences;
	}

	/**
	 * Get index signature for comparison
	 */
	private getIndexSignature(index: {
		readonly fields: readonly string[];
		readonly unique?: boolean;
		readonly type?: string;
	}): string {
		const fields = [...index.fields].sort().join(",");
		const unique = index.unique ? "unique" : "normal";
		const type = index.type ?? "btree";
		return `${fields}:${unique}:${type}`;
	}
}

/**
 * Create schema differ instance
 */
export function createSchemaDiffer(): SchemaDiffer {
	return new ForgeSchemaDiffer();
}
