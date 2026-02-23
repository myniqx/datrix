/**
 * Migration Session
 *
 * Provides a fluent API for managing database migrations.
 * Entry point: forja.beginMigrate()
 *
 * Features:
 * - Compares current schemas with database state
 * - Detects ambiguous changes (rename vs drop+add)
 * - Interactive resolution for ambiguous cases
 * - Preview and apply migrations
 */

import { DatabaseAdapter, QueryRunner } from "forja-types/adapter";
import { SchemaDefinition, FieldDefinition } from "forja-types/core/schema";
import {
	Migration,
	MigrationOperation,
	DataTransferOperation,
	MigrationSystemError,
	SchemaDiff,
	MigrationResult,
} from "forja-types/core/migration";
import { Result } from "forja-types/utils";
import { IForja } from "forja-types/forja";
import { ForgeSchemaDiffer } from "./differ";
import { ForgeMigrationGenerator } from "./generator";
import { ForgeMigrationHistory } from "./history";
import { ForgeMigrationRunner } from "./runner";

/**
 * Ambiguous change types
 */
export type AmbiguousChangeType =
	| "column_rename_or_replace"
	| "table_rename_or_replace"
	| "fk_column_drop"
	| "junction_table_drop"
	| "junction_table_rename_or_replace"
	| "relation_upgrade_single_to_many"
	| "relation_downgrade_many_to_single"
	| "fk_model_change"
	| "relation_direction_flip";

/**
 * Ambiguous action types
 */
export type AmbiguousActionType =
	| "rename"
	| "drop_and_add"
	| "confirm_drop"
	| "migrate_to_junction"
	| "migrate_first"
	| "fresh_start"
	| "keep_column"
	| "drop_and_recreate";

/**
 * Ambiguous change that requires user input
 */
export interface AmbiguousChange {
	readonly id: string;
	readonly tableName: string;
	readonly type: AmbiguousChangeType;
	readonly removedName: string;
	readonly addedName: string;
	readonly removedDefinition?: FieldDefinition;
	readonly addedDefinition?: FieldDefinition;
	readonly possibleActions: readonly AmbiguousAction[];
	readonly warning?: string;
	readonly affectedRows?: number;
	resolved: boolean;
	resolvedAction?: AmbiguousAction;
}

/**
 * Possible action for ambiguous change
 */
export interface AmbiguousAction {
	readonly type: AmbiguousActionType;
	readonly description: string;
}

/**
 * Migration plan summary
 */
export interface MigrationPlan {
	readonly tablesToCreate: readonly SchemaDefinition[];
	readonly tablesToDrop: readonly string[];
	readonly tablesToAlter: readonly {
		readonly tableName: string;
		readonly changes: readonly SchemaDiff[];
	}[];
	readonly operations: readonly MigrationOperation[];
	readonly hasChanges: boolean;
}

/**
 * Migration Session class
 *
 * Created by forja.beginMigrate()
 */
export class MigrationSession {
	private readonly forja: IForja;
	private readonly adapter: DatabaseAdapter;
	private readonly differ: ForgeSchemaDiffer;
	private readonly generator: ForgeMigrationGenerator;
	private readonly history: ForgeMigrationHistory;

	private currentSchemas: Map<string, SchemaDefinition> = new Map();
	private databaseSchemas: Map<string, SchemaDefinition> = new Map();
	private differences: SchemaDiff[] = [];
	private _ambiguous: AmbiguousChange[] = [];
	private initialized = false;

	constructor(forja: IForja) {
		this.forja = forja;
		this.adapter = forja.getAdapter();
		this.differ = new ForgeSchemaDiffer();
		this.generator = new ForgeMigrationGenerator();

		const migrationConfig = forja.getMigrationConfig();
		this.history = new ForgeMigrationHistory(forja, migrationConfig.modelName);
	}

	/**
	 * Initialize session - load current state from database
	 */
	async initialize(): Promise<Result<void, MigrationSystemError>> {
		if (this.initialized) {
			return { success: true, data: undefined };
		}

		try {
			// Initialize history table
			const historyInit = await this.history.initialize();
			if (!historyInit.success) {
				return historyInit;
			}

			// Load current schemas from Forja
			const registry = this.forja.getSchemas();
			for (const schema of registry.getAll()) {
				// Skip internal migration schema
				if (schema.name.startsWith("_forja_")) {
					continue;
				}
				this.currentSchemas.set(schema.name, schema);
			}

			// Load existing schemas from database
			const tablesResult = await this.adapter.getTables();
			if (!tablesResult.success) {
				return {
					success: false,
					error: new MigrationSystemError(
						`Failed to get tables: ${tablesResult.error.message}`,
						"MIGRATION_ERROR",
						tablesResult.error,
					),
				};
			}

			for (const tableName of tablesResult.data) {
				// Skip internal tables
				if (tableName.startsWith("_forja_")) {
					continue;
				}

				const schemaResult = await this.adapter.getTableSchema(tableName);
				if (schemaResult.success) {
					this.databaseSchemas.set(tableName, schemaResult.data);
				}
			}

			// Compare schemas
			const oldSchemas: Record<string, SchemaDefinition> = {};
			for (const [name, schema] of this.databaseSchemas) {
				oldSchemas[name] = schema;
			}

			const newSchemas: Record<string, SchemaDefinition> = {};
			for (const [name, schema] of this.currentSchemas) {
				newSchemas[schema.tableName ?? name] = schema;
			}

			const comparison = this.differ.compare(oldSchemas, newSchemas);
			if (!comparison.success) {
				return {
					success: false,
					error: comparison.error,
				};
			}

			this.differences = [...comparison.data.differences];

			// Detect ambiguous changes
			this.detectAmbiguousChanges();

			this.initialized = true;
			return { success: true, data: undefined };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				success: false,
				error: new MigrationSystemError(
					`Failed to initialize migration session: ${message}`,
					"MIGRATION_ERROR",
					error,
				),
			};
		}
	}

	/**
	 * Detect ambiguous changes (potential renames, relation changes, etc.)
	 */
	private detectAmbiguousChanges(): void {
		// Group diffs by type and table
		const removedFields = new Map<string, SchemaDiff[]>();
		const addedFields = new Map<string, SchemaDiff[]>();
		const removedTables: SchemaDiff[] = [];
		const addedTables: SchemaDiff[] = [];

		for (const diff of this.differences) {
			if (diff.type === "fieldRemoved") {
				const key = diff.tableName;
				if (!removedFields.has(key)) {
					removedFields.set(key, []);
				}
				removedFields.get(key)!.push(diff);
			} else if (diff.type === "fieldAdded") {
				const key = diff.tableName;
				if (!addedFields.has(key)) {
					addedFields.set(key, []);
				}
				addedFields.get(key)!.push(diff);
			} else if (diff.type === "tableRemoved") {
				removedTables.push(diff);
			} else if (diff.type === "tableAdded") {
				addedTables.push(diff);
			}
		}

		// Collect fieldModified diffs for relation-specific detection
		const modifiedFields = new Map<string, SchemaDiff[]>();
		for (const diff of this.differences) {
			if (diff.type === "fieldModified") {
				const key = diff.tableName;
				if (!modifiedFields.has(key)) {
					modifiedFields.set(key, []);
				}
				modifiedFields.get(key)!.push(diff);
			}
		}

		// Track which diffs are handled by relation detection
		const handledDiffs = new Set<string>();

		// 1. Detect relation type changes (belongsTo ↔ manyToMany)
		this.detectRelationTypeChanges(
			removedFields,
			addedFields,
			removedTables,
			addedTables,
			handledDiffs,
		);

		// 2. Detect junction table renames (through name change) - must run before drops
		this.detectJunctionTableRenames(removedTables, addedTables, handledDiffs);

		// 3. Detect junction table drops (manyToMany removal)
		this.detectJunctionTableDrops(removedTables, handledDiffs);

		// 4. Detect relation direction flips (FK moves from one table to another) - before FK drop detection
		this.detectRelationDirectionFlips(removedFields, addedFields, handledDiffs);

		// 5. Detect FK column changes (rename or drop)
		this.detectFkColumnChanges(removedFields, addedFields, handledDiffs);

		// 6. Detect column renames (generic, non-FK columns)
		this.detectColumnRenames(removedFields, addedFields, handledDiffs);

		// 7. Detect table renames
		this.detectTableRenames(removedTables, addedTables, handledDiffs);

		// 8. Detect FK model changes (belongsTo pointing to different model)
		this.detectFkModelChanges(modifiedFields, handledDiffs);
	}

	/**
	 * Detect relation type changes (belongsTo ↔ manyToMany)
	 */
	private detectRelationTypeChanges(
		removedFields: Map<string, SchemaDiff[]>,
		addedFields: Map<string, SchemaDiff[]>,
		removedTables: SchemaDiff[],
		addedTables: SchemaDiff[],
		handledDiffs: Set<string>,
	): void {
		// belongsTo → manyToMany: FK column removed + junction table added
		for (const [tableName, removed] of removedFields) {
			for (const removedDiff of removed) {
				if (removedDiff.type !== "fieldRemoved") continue;

				// Check if this looks like a FK column (ends with 'Id')
				if (!removedDiff.fieldName.endsWith("Id")) continue;

				const relationName = removedDiff.fieldName.slice(0, -2); // remove 'Id'

				// Look for a new junction table that involves this table
				for (const addedTable of addedTables) {
					if (addedTable.type !== "tableAdded") continue;

					const junctionName = addedTable.schema.tableName ?? addedTable.schema.name;

					// Check if junction table name contains both table names
					if (this.isJunctionTableFor(junctionName, tableName, relationName)) {
						const diffKey = `${tableName}.${removedDiff.fieldName}`;
						handledDiffs.add(diffKey);
						handledDiffs.add(`table:${junctionName}`);

						this._ambiguous.push({
							id: `relation_upgrade:${tableName}.${relationName}`,
							tableName,
							type: "relation_upgrade_single_to_many",
							removedName: removedDiff.fieldName,
							addedName: junctionName,
							warning: "Existing single relations can be migrated to junction table.",
							possibleActions: [
								{
									type: "migrate_to_junction",
									description: `Migrate existing ${removedDiff.fieldName} values to junction table '${junctionName}' (preserves data)`,
								},
								{
									type: "fresh_start",
									description: `Drop '${removedDiff.fieldName}' and create empty junction table (data loss)`,
								},
							],
							resolved: false,
						});
					}
				}
			}
		}

		// manyToMany → belongsTo: junction table removed + FK column added
		for (const removedTable of removedTables) {
			if (removedTable.type !== "tableRemoved") continue;

			const junctionName = removedTable.tableName;

			// Check if this looks like a junction table
			if (!this.looksLikeJunctionTable(junctionName)) continue;

			// Look for a new FK column on one of the related tables
			for (const [tableName, added] of addedFields) {
				for (const addedDiff of added) {
					if (addedDiff.type !== "fieldAdded") continue;

					// Check if this looks like a FK column
					if (!addedDiff.fieldName.endsWith("Id")) continue;

					const relationName = addedDiff.fieldName.slice(0, -2);

					// Check if junction table relates these
					if (this.isJunctionTableFor(junctionName, tableName, relationName)) {
						const diffKey = `table:${junctionName}`;
						handledDiffs.add(diffKey);
						handledDiffs.add(`${tableName}.${addedDiff.fieldName}`);

						this._ambiguous.push({
							id: `relation_downgrade:${tableName}.${relationName}`,
							tableName,
							type: "relation_downgrade_many_to_single",
							removedName: junctionName,
							addedName: addedDiff.fieldName,
							warning: "Records with multiple relations will lose data! Only first relation will be kept.",
							possibleActions: [
								{
									type: "migrate_first",
									description: `Migrate first relation from '${junctionName}' to '${addedDiff.fieldName}' (partial data loss)`,
								},
								{
									type: "fresh_start",
									description: `Drop junction table and create empty '${addedDiff.fieldName}' column (full data loss)`,
								},
							],
							resolved: false,
						});
					}
				}
			}
		}
	}

	/**
	 * Detect junction table drops (manyToMany relation removed)
	 */
	private detectJunctionTableDrops(
		removedTables: SchemaDiff[],
		handledDiffs: Set<string>,
	): void {
		for (const removedTable of removedTables) {
			if (removedTable.type !== "tableRemoved") continue;

			const tableName = removedTable.tableName;
			const diffKey = `table:${tableName}`;

			// Skip if already handled by relation type change detection
			if (handledDiffs.has(diffKey)) continue;

			// Check if this looks like a junction table
			if (this.looksLikeJunctionTable(tableName)) {
				handledDiffs.add(diffKey);

				this._ambiguous.push({
					id: `junction_drop:${tableName}`,
					tableName,
					type: "junction_table_drop",
					removedName: tableName,
					addedName: "",
					warning: "All relations in this junction table will be lost.",
					possibleActions: [
						{
							type: "confirm_drop",
							description: `Confirm dropping junction table '${tableName}' (data loss)`,
						},
					],
					resolved: false,
				});
			}
		}
	}

	/**
	 * Detect junction table renames (through name change)
	 */
	private detectJunctionTableRenames(
		removedTables: SchemaDiff[],
		addedTables: SchemaDiff[],
		handledDiffs: Set<string>,
	): void {
		for (const removedTable of removedTables) {
			if (removedTable.type !== "tableRemoved") continue;

			const oldName = removedTable.tableName;
			const oldDiffKey = `table:${oldName}`;

			if (handledDiffs.has(oldDiffKey)) continue;
			if (!this.looksLikeJunctionTable(oldName)) continue;

			for (const addedTable of addedTables) {
				if (addedTable.type !== "tableAdded") continue;

				const newName = addedTable.schema.tableName ?? addedTable.schema.name;
				const newDiffKey = `table:${newName}`;

				if (handledDiffs.has(newDiffKey)) continue;
				if (!this.looksLikeJunctionTable(newName)) continue;

				// Check if they have similar structure (both junction tables for same models)
				if (this.couldBeJunctionRename(oldName, newName)) {
					handledDiffs.add(oldDiffKey);
					handledDiffs.add(newDiffKey);

					this._ambiguous.push({
						id: `junction_rename:${oldName}->${newName}`,
						tableName: oldName,
						type: "junction_table_rename_or_replace",
						removedName: oldName,
						addedName: newName,
						warning: "Renaming junction tables may cause issues if referenced elsewhere.",
						possibleActions: [
							{
								type: "rename",
								description: `Rename junction table '${oldName}' to '${newName}' (preserves data)`,
							},
							{
								type: "drop_and_recreate",
								description: `Drop '${oldName}' and create '${newName}' (data loss)`,
							},
						],
						resolved: false,
					});
				}
			}
		}
	}

	/**
	 * Detect FK column changes (rename or drop)
	 *
	 * Handles:
	 * - FK rename: authorId removed + writerId added → column_rename_or_replace
	 * - FK drop: authorId removed + no new FK added → fk_column_drop
	 */
	private detectFkColumnChanges(
		removedFields: Map<string, SchemaDiff[]>,
		addedFields: Map<string, SchemaDiff[]>,
		handledDiffs: Set<string>,
	): void {
		for (const [tableName, removed] of removedFields) {
			const added = addedFields.get(tableName) ?? [];

			// Get all added FK columns in this table (not yet handled)
			const addedFkColumns = added.filter(
				(d) =>
					d.type === "fieldAdded" &&
					d.fieldName.endsWith("Id") &&
					!handledDiffs.has(`${tableName}.${d.fieldName}`),
			);

			for (const removedDiff of removed) {
				if (removedDiff.type !== "fieldRemoved") continue;
				if (!removedDiff.fieldName.endsWith("Id")) continue;

				const removedKey = `${tableName}.${removedDiff.fieldName}`;
				if (handledDiffs.has(removedKey)) continue;

				// Check if there's a new FK column added - could be a rename
				if (addedFkColumns.length > 0) {
					// Find the first unhandled added FK column
					const addedDiff = addedFkColumns.find(
						(d) => !handledDiffs.has(`${tableName}.${d.fieldName}`),
					);

					if (addedDiff && addedDiff.type === "fieldAdded") {
						const addedKey = `${tableName}.${addedDiff.fieldName}`;

						handledDiffs.add(removedKey);
						handledDiffs.add(addedKey);

						this._ambiguous.push({
							id: `${tableName}.${removedDiff.fieldName}->${addedDiff.fieldName}`,
							tableName,
							type: "column_rename_or_replace",
							removedName: removedDiff.fieldName,
							addedName: addedDiff.fieldName,
							addedDefinition: addedDiff.definition,
							possibleActions: [
								{
									type: "rename",
									description: `Rename column '${removedDiff.fieldName}' to '${addedDiff.fieldName}' (preserves data)`,
								},
								{
									type: "drop_and_add",
									description: `Drop '${removedDiff.fieldName}' and add '${addedDiff.fieldName}' (data loss)`,
								},
							],
							resolved: false,
						});

						continue;
					}
				}

				// No matching added FK column - this is a pure FK drop
				handledDiffs.add(removedKey);

				this._ambiguous.push({
					id: `fk_drop:${tableName}.${removedDiff.fieldName}`,
					tableName,
					type: "fk_column_drop",
					removedName: removedDiff.fieldName,
					addedName: "",
					warning: "All foreign key references will be lost.",
					possibleActions: [
						{
							type: "confirm_drop",
							description: `Confirm dropping FK column '${removedDiff.fieldName}' from '${tableName}' (data loss)`,
						},
					],
					resolved: false,
				});
			}
		}
	}

	/**
	 * Detect potential column renames
	 */
	private detectColumnRenames(
		removedFields: Map<string, SchemaDiff[]>,
		addedFields: Map<string, SchemaDiff[]>,
		handledDiffs: Set<string>,
	): void {
		for (const [tableName, removed] of removedFields) {
			const added = addedFields.get(tableName);
			if (!added) continue;

			for (const removedDiff of removed) {
				if (removedDiff.type !== "fieldRemoved") continue;

				const removedKey = `${tableName}.${removedDiff.fieldName}`;
				if (handledDiffs.has(removedKey)) continue;

				for (const addedDiff of added) {
					if (addedDiff.type !== "fieldAdded") continue;

					const addedKey = `${tableName}.${addedDiff.fieldName}`;
					if (handledDiffs.has(addedKey)) continue;

					// Check if could be rename
					if (this.couldBeRename(undefined, addedDiff.definition)) {
						handledDiffs.add(removedKey);
						handledDiffs.add(addedKey);

						this._ambiguous.push({
							id: `${tableName}.${removedDiff.fieldName}->${addedDiff.fieldName}`,
							tableName,
							type: "column_rename_or_replace",
							removedName: removedDiff.fieldName,
							addedName: addedDiff.fieldName,
							addedDefinition: addedDiff.definition,
							possibleActions: [
								{
									type: "rename",
									description: `Rename column '${removedDiff.fieldName}' to '${addedDiff.fieldName}' (preserves data)`,
								},
								{
									type: "drop_and_add",
									description: `Drop '${removedDiff.fieldName}' and add '${addedDiff.fieldName}' (data loss)`,
								},
							],
							resolved: false,
						});

						// Only match one pair per removed field
						break;
					}
				}
			}
		}
	}

	/**
	 * Detect potential table renames
	 */
	private detectTableRenames(
		removedTables: SchemaDiff[],
		addedTables: SchemaDiff[],
		handledDiffs: Set<string>,
	): void {
		for (const removedDiff of removedTables) {
			if (removedDiff.type !== "tableRemoved") continue;

			const removedKey = `table:${removedDiff.tableName}`;
			if (handledDiffs.has(removedKey)) continue;

			for (const addedDiff of addedTables) {
				if (addedDiff.type !== "tableAdded") continue;

				const addedKey = `table:${addedDiff.schema.tableName ?? addedDiff.schema.name}`;
				if (handledDiffs.has(addedKey)) continue;

				if (this.couldBeTableRename(removedDiff.tableName, addedDiff.schema)) {
					handledDiffs.add(removedKey);
					handledDiffs.add(addedKey);

					this._ambiguous.push({
						id: `table:${removedDiff.tableName}->${addedDiff.schema.name}`,
						tableName: removedDiff.tableName,
						type: "table_rename_or_replace",
						removedName: removedDiff.tableName,
						addedName: addedDiff.schema.name,
						possibleActions: [
							{
								type: "rename",
								description: `Rename table '${removedDiff.tableName}' to '${addedDiff.schema.name}' (preserves data)`,
							},
							{
								type: "drop_and_add",
								description: `Drop '${removedDiff.tableName}' and create '${addedDiff.schema.name}' (data loss)`,
							},
						],
						resolved: false,
					});

					break;
				}
			}
		}
	}

	/**
	 * Detect FK model changes (belongsTo pointing to a different model).
	 * The FK column name stays the same but the referenced model changes.
	 */
	private detectFkModelChanges(
		modifiedFields: Map<string, SchemaDiff[]>,
		handledDiffs: Set<string>,
	): void {
		for (const [tableName, modified] of modifiedFields) {
			for (const diff of modified) {
				if (diff.type !== "fieldModified") continue;

				const oldDef = diff.oldDefinition;
				const newDef = diff.newDefinition;

				if (oldDef.type !== "relation" || newDef.type !== "relation") continue;
				if (oldDef.kind !== "belongsTo" || newDef.kind !== "belongsTo") continue;
				if (oldDef.model === newDef.model) continue;

				const diffKey = `${tableName}.${diff.fieldName}`;
				if (handledDiffs.has(diffKey)) continue;
				handledDiffs.add(diffKey);

				const fkColumn = newDef.foreignKey ?? `${newDef.model}Id`;

				this._ambiguous.push({
					id: `fk_model_change:${tableName}.${diff.fieldName}`,
					tableName,
					type: "fk_model_change",
					removedName: oldDef.model,
					addedName: newDef.model,
					warning: `Existing data in '${fkColumn}' will reference '${newDef.model}' instead of '${oldDef.model}'. Ensure data integrity before migrating.`,
					possibleActions: [
						{
							type: "keep_column",
							description: `Keep column '${fkColumn}' as-is and change the referenced model (data may be inconsistent)`,
						},
						{
							type: "drop_and_recreate",
							description: `Drop '${fkColumn}' and recreate it (data loss)`,
						},
					],
					resolved: false,
				});
			}
		}
	}

	/**
	 * Detect relation direction flips.
	 * A hasOne/hasMany FK is removed from one table and an equivalent FK
	 * is added to another table — the relation ownership is flipping sides.
	 *
	 * Pattern: fieldRemoved (FK column on tableA) + fieldAdded (FK column on tableB)
	 * where both columns represent the same logical relation but point in
	 * opposite directions.
	 */
	private detectRelationDirectionFlips(
		removedFields: Map<string, SchemaDiff[]>,
		addedFields: Map<string, SchemaDiff[]>,
		handledDiffs: Set<string>,
	): void {
		for (const [removedTable, removed] of removedFields) {
			for (const removedDiff of removed) {
				if (removedDiff.type !== "fieldRemoved") continue;
				if (!removedDiff.fieldName.endsWith("Id")) continue;

				const removedKey = `${removedTable}.${removedDiff.fieldName}`;
				if (handledDiffs.has(removedKey)) continue;

				// Look for a new FK column on a different table
				for (const [addedTable, added] of addedFields) {
					if (addedTable === removedTable) continue;

					for (const addedDiff of added) {
						if (addedDiff.type !== "fieldAdded") continue;
						if (!addedDiff.fieldName.endsWith("Id")) continue;

						const addedKey = `${addedTable}.${addedDiff.fieldName}`;
						if (handledDiffs.has(addedKey)) continue;

						// Check if these two FK columns are related to the same models
						// removedTable has a FK pointing to some model (ends with Id)
						// addedTable has a new FK pointing to some model
						// They're a direction flip if one points to the other's table
						const removedModelHint = removedDiff.fieldName.slice(0, -2);
						const addedModelHint = addedDiff.fieldName.slice(0, -2);

						const removedTableBase = this.singularize(removedTable);
						const addedTableBase = this.singularize(addedTable);

						const isFlip =
							removedModelHint === addedTableBase ||
							addedModelHint === removedTableBase;

						if (isFlip) {
							handledDiffs.add(removedKey);
							handledDiffs.add(addedKey);

							this._ambiguous.push({
								id: `direction_flip:${removedTable}.${removedDiff.fieldName}->${addedTable}.${addedDiff.fieldName}`,
								tableName: removedTable,
								type: "relation_direction_flip",
								removedName: `${removedTable}.${removedDiff.fieldName}`,
								addedName: `${addedTable}.${addedDiff.fieldName}`,
								warning: `Relation direction is changing. '${removedDiff.fieldName}' on '${removedTable}' will be replaced by '${addedDiff.fieldName}' on '${addedTable}'. Existing relation data will be lost.`,
								possibleActions: [
									{
										type: "drop_and_recreate",
										description: `Drop '${removedDiff.fieldName}' from '${removedTable}' and add '${addedDiff.fieldName}' to '${addedTable}' (data loss)`,
									},
								],
								resolved: false,
							});

							break;
						}
					}
				}
			}
		}
	}

	/**
	 * Check if table name looks like a junction table
	 */
	private looksLikeJunctionTable(tableName: string): boolean {
		// Junction tables typically have underscore: post_tag, category_post, etc.
		return tableName.includes("_") && !tableName.startsWith("_");
	}

	/**
	 * Check if junction table is for given table and relation
	 */
	private isJunctionTableFor(
		junctionName: string,
		tableName: string,
		relationName: string,
	): boolean {
		const parts = junctionName.split("_");
		if (parts.length !== 2) return false;

		// Junction table should contain both model names (singular form)
		const singularTable = this.singularize(tableName);
		const singularRelation = relationName.toLowerCase();

		const containsTable = parts.some(
			(p) => p === singularTable || p === tableName.toLowerCase(),
		);
		const containsRelation = parts.some(
			(p) => p === singularRelation || p === this.pluralize(singularRelation),
		);

		return containsTable && containsRelation;
	}

	/**
	 * Check if two junction tables could be a rename
	 */
	private couldBeJunctionRename(oldName: string, newName: string): boolean {
		const oldParts = new Set(oldName.split("_"));
		const newParts = new Set(newName.split("_"));

		// At least one part should be common
		let commonParts = 0;
		for (const part of oldParts) {
			if (newParts.has(part)) commonParts++;
		}

		return commonParts >= 1;
	}

	/**
	 * Simple singularize helper
	 */
	private singularize(word: string): string {
		if (word.endsWith("ies")) {
			return word.slice(0, -3) + "y";
		}
		if (word.endsWith("es")) {
			return word.slice(0, -2);
		}
		if (word.endsWith("s") && !word.endsWith("ss")) {
			return word.slice(0, -1);
		}
		return word;
	}

	/**
	 * Simple pluralize helper
	 */
	private pluralize(word: string): string {
		if (word.endsWith("y")) {
			return word.slice(0, -1) + "ies";
		}
		if (word.endsWith("s") || word.endsWith("x") || word.endsWith("ch") || word.endsWith("sh")) {
			return word + "es";
		}
		return word + "s";
	}

	/**
	 * Check if field change could be a rename
	 */
	private couldBeRename(
		_oldDef: FieldDefinition | undefined,
		_newDef: FieldDefinition,
	): boolean {
		// Simple heuristic: if types match, could be rename
		// In real implementation, check more properties
		return true; // For now, always offer rename option
	}

	/**
	 * Check if table change could be a rename
	 *
	 * Excludes common system fields (id, createdAt, updatedAt) from comparison
	 * to focus on user-defined fields only.
	 */
	private couldBeTableRename(
		oldTableName: string,
		newSchema: SchemaDefinition,
	): boolean {
		const oldSchema = this.databaseSchemas.get(oldTableName);
		if (!oldSchema) return false;

		// Exclude system fields from comparison
		const systemFields = new Set(["id", "createdAt", "updatedAt"]);

		const oldFields = new Set(
			Object.keys(oldSchema.fields).filter((f) => !systemFields.has(f)),
		);
		const newFields = new Set(
			Object.keys(newSchema.fields).filter((f) => !systemFields.has(f)),
		);

		// Need at least 1 user-defined field to compare
		if (oldFields.size === 0 || newFields.size === 0) {
			return false;
		}

		// Count common fields
		let commonFields = 0;
		for (const field of oldFields) {
			if (newFields.has(field)) {
				commonFields++;
			}
		}

		// Need at least 70% of fields to match by name (stricter threshold)
		const totalUniqueFields = new Set([...oldFields, ...newFields]).size;
		const fieldNameSimilarity = commonFields / totalUniqueFields;

		if (fieldNameSimilarity < 0.7) {
			return false;
		}

		// Also check field count similarity
		const countSimilarity =
			Math.min(oldFields.size, newFields.size) /
			Math.max(oldFields.size, newFields.size);

		return countSimilarity > 0.7;
	}

	/**
	 * Get tables to create
	 */
	get tablesToCreate(): readonly SchemaDefinition[] {
		return this.differences
			.filter((d) => d.type === "tableAdded")
			.map((d) => (d as { type: "tableAdded"; schema: SchemaDefinition }).schema);
	}

	/**
	 * Get tables to drop
	 */
	get tablesToDrop(): readonly string[] {
		return this.differences
			.filter((d) => d.type === "tableRemoved")
			.map((d) => (d as { type: "tableRemoved"; tableName: string }).tableName);
	}

	/**
	 * Get tables to alter
	 */
	get tablesToAlter(): readonly { tableName: string; changes: readonly SchemaDiff[] }[] {
		const alterations = new Map<string, SchemaDiff[]>();

		for (const diff of this.differences) {
			if (
				diff.type === "fieldAdded" ||
				diff.type === "fieldRemoved" ||
				diff.type === "fieldModified" ||
				diff.type === "indexAdded" ||
				diff.type === "indexRemoved"
			) {
				const tableName = diff.tableName;
				if (!alterations.has(tableName)) {
					alterations.set(tableName, []);
				}
				alterations.get(tableName)!.push(diff);
			}
		}

		return Array.from(alterations.entries()).map(([tableName, changes]) => ({
			tableName,
			changes,
		}));
	}

	/**
	 * Get ambiguous changes that need resolution
	 */
	get ambiguous(): readonly AmbiguousChange[] {
		return this._ambiguous.filter((a) => !a.resolved);
	}

	/**
	 * Check if there are unresolved ambiguous changes
	 */
	hasUnresolvedAmbiguous(): boolean {
		return this._ambiguous.some((a) => !a.resolved);
	}

	/**
	 * Resolve an ambiguous change
	 */
	resolveAmbiguous(
		id: string,
		action: AmbiguousActionType,
	): Result<void, MigrationSystemError> {
		const ambiguous = this._ambiguous.find((a) => a.id === id);
		if (!ambiguous) {
			return {
				success: false,
				error: new MigrationSystemError(
					`Ambiguous change '${id}' not found`,
					"MIGRATION_ERROR",
				),
			};
		}

		const selectedAction = ambiguous.possibleActions.find(
			(a) => a.type === action,
		);
		if (!selectedAction) {
			return {
				success: false,
				error: new MigrationSystemError(
					`Invalid action '${action}' for ambiguous change '${id}'`,
					"MIGRATION_ERROR",
				),
			};
		}

		ambiguous.resolved = true;
		ambiguous.resolvedAction = selectedAction;

		// Update differences based on resolution
		this.applyResolution(ambiguous, action);

		return { success: true, data: undefined };
	}

	/**
	 * Apply resolution - update differences based on chosen action
	 */
	private applyResolution(
		ambiguous: AmbiguousChange,
		action: AmbiguousActionType,
	): void {
		switch (ambiguous.type) {
			case "column_rename_or_replace":
				if (action === "rename") {
					this.applyColumnRename(ambiguous);
				}
				// drop_and_add: keep original diffs
				break;

			case "table_rename_or_replace":
				if (action === "rename") {
					this.applyTableRename(ambiguous);
				}
				// drop_and_add: keep original diffs
				break;

			case "junction_table_rename_or_replace":
				if (action === "rename") {
					this.applyTableRename(ambiguous);
				}
				// drop_and_recreate: keep original diffs
				break;

			case "fk_column_drop":
			case "junction_table_drop":
				// confirm_drop: keep original diffs (just confirming)
				break;

			case "relation_upgrade_single_to_many":
				if (action === "migrate_to_junction") {
					// TODO: Add data migration operation
					// For now, keep original diffs but mark for data migration
				}
				// fresh_start: keep original diffs (no data migration)
				break;

			case "relation_downgrade_many_to_single":
				if (action === "migrate_first") {
					// TODO: Add data migration operation
					// For now, keep original diffs but mark for data migration
				}
				// fresh_start: keep original diffs (no data migration)
				break;

			case "fk_model_change":
				// Both keep_column and drop_and_recreate: keep original diffs for now
				break;

			case "relation_direction_flip":
				// drop_both_and_recreate: keep original diffs
				break;
		}
	}

	/**
	 * Apply column rename - replace drop+add with rename
	 */
	private applyColumnRename(ambiguous: AmbiguousChange): void {
		// Remove the fieldRemoved and fieldAdded diffs
		this.differences = this.differences.filter((d) => {
			if (
				d.type === "fieldRemoved" &&
				d.tableName === ambiguous.tableName &&
				d.fieldName === ambiguous.removedName
			) {
				return false;
			}
			if (
				d.type === "fieldAdded" &&
				d.tableName === ambiguous.tableName &&
				d.fieldName === ambiguous.addedName
			) {
				return false;
			}
			return true;
		});

		// Add fieldRenamed diff
		this.differences.push({
			type: "fieldRenamed",
			tableName: ambiguous.tableName,
			from: ambiguous.removedName,
			to: ambiguous.addedName,
		});
	}

	/**
	 * Apply table rename - replace drop+add with rename
	 */
	private applyTableRename(ambiguous: AmbiguousChange): void {
		// Remove tableRemoved and tableAdded diffs
		this.differences = this.differences.filter((d) => {
			if (d.type === "tableRemoved" && d.tableName === ambiguous.removedName) {
				return false;
			}
			if (d.type === "tableAdded" && d.schema.name === ambiguous.addedName) {
				return false;
			}
			return true;
		});

		// Add tableRenamed diff
		this.differences.push({
			type: "tableRenamed",
			from: ambiguous.removedName,
			to: ambiguous.addedName,
		});
	}

	/**
	 * Check if there are any changes to apply
	 */
	hasChanges(): boolean {
		return this.differences.length > 0;
	}

	/**
	 * Get migration plan
	 */
	getPlan(): Result<MigrationPlan, MigrationSystemError> {
		if (this.hasUnresolvedAmbiguous()) {
			return {
				success: false,
				error: new MigrationSystemError(
					"Cannot generate plan with unresolved ambiguous changes",
					"MIGRATION_ERROR",
				),
			};
		}

		const operationsResult = this.generator.generateOperations(this.differences);
		if (!operationsResult.success) {
			return {
				success: false,
				error: operationsResult.error,
			};
		}

		return {
			success: true,
			data: {
				tablesToCreate: this.tablesToCreate,
				tablesToDrop: this.tablesToDrop,
				tablesToAlter: this.tablesToAlter,
				operations: operationsResult.data,
				hasChanges: this.hasChanges(),
			},
		};
	}

	/**
	 * Apply migrations
	 */
	async apply(): Promise<Result<readonly MigrationResult[], MigrationSystemError>> {
		if (this.hasUnresolvedAmbiguous()) {
			return {
				success: false,
				error: new MigrationSystemError(
					"Cannot apply migrations with unresolved ambiguous changes",
					"MIGRATION_ERROR",
				),
			};
		}

		if (!this.hasChanges()) {
			return { success: true, data: [] };
		}

		// Generate migration
		const migrationResult = this.generator.generate(this.differences, {
			name: `migration_${Date.now()}`,
			version: Date.now().toString(),
			description: "Auto-generated migration",
		});

		if (!migrationResult.success) {
			return {
				success: false,
				error: migrationResult.error,
			};
		}

		const baseMigration = migrationResult.data;

		// Inject data transfer operations for resolved migrate_to_junction / migrate_first
		const enrichedOperations = this.injectDataTransferOperations(baseMigration.operations);
		const migration: Migration = {
			...baseMigration,
			operations: enrichedOperations,
		};

		// Create runner and execute
		const runner = new ForgeMigrationRunner(
			this.adapter,
			this.history,
			[migration],
		);

		const runResult = await runner.runPending();
		if (!runResult.success) {
			return {
				success: false,
				error: runResult.error,
			};
		}

		return { success: true, data: runResult.data };
	}

	/**
	 * Inject data transfer operations into the migration operation list.
	 *
	 * For each resolved ambiguous change with a data migration action,
	 * inserts a dataTransfer step at the correct position:
	 * - migrate_to_junction: after createTable(junction), before dropColumn(fkCol)
	 * - migrate_first: after addColumn(fkCol), before dropTable(junction)
	 */
	private injectDataTransferOperations(
		operations: readonly MigrationOperation[],
	): readonly MigrationOperation[] {
		const result: MigrationOperation[] = [...operations];

		for (const ambiguous of this._ambiguous) {
			if (!ambiguous.resolved) continue;

			if (ambiguous.resolvedAction?.type === "migrate_to_junction") {
				const sourceFkCol = ambiguous.removedName; // e.g. "categoryId"
				const junctionTable = ambiguous.addedName; // e.g. "category_post"
				const sourceTable = ambiguous.tableName; // e.g. "posts"

				// Find insert position: after createTable(junction)
				const createIdx = result.findIndex(
					(op) => op.type === "createTable" &&
						((op.schema.tableName ?? op.schema.name) === junctionTable),
				);

				// Find drop position: before alterTable(sourceTable) that drops fkCol
				const dropIdx = result.findIndex(
					(op) => op.type === "alterTable" &&
						op.tableName === sourceTable &&
						op.operations.some((o) => o.type === "dropColumn" && o.column === sourceFkCol),
				);

				if (createIdx === -1 || dropIdx === -1) continue;

				const transferOp: DataTransferOperation = {
					type: "dataTransfer",
					description: `Migrate '${sourceTable}.${sourceFkCol}' values to junction table '${junctionTable}'`,
					execute: async (runner: QueryRunner) => {
						const selectResult = await runner.executeQuery<{ id: string | number; [key: string]: unknown }>({
							type: "select",
							table: sourceTable,
							select: ["id", sourceFkCol],
						});
						if (!selectResult.success) throw selectResult.error;

						const rows = selectResult.data.rows;

						// Junction FK col for source: derived from FK col on target (e.g. "categoryId" → target model "category")
						// Source FK col in junction: singular of sourceTable + "Id" (e.g. "posts" → "postId")
						const sourceModelName = this.singularize(sourceTable);
						const sourceJunctionFkCol = `${sourceModelName}Id`;

						const junctionRows = rows
							.filter((row) => row[sourceFkCol] != null)
							.map((row) => ({
								[sourceJunctionFkCol]: row.id,
								[sourceFkCol]: row[sourceFkCol],
							}));

						if (junctionRows.length === 0) return;

						const insertResult = await runner.executeQuery({
							type: "insert",
							table: junctionTable,
							data: junctionRows,
						});
						if (!insertResult.success) throw insertResult.error;
					},
				};

				// Insert after createTable, but before drop
				const insertAt = Math.min(createIdx + 1, dropIdx);
				result.splice(insertAt, 0, transferOp);

			} else if (ambiguous.resolvedAction?.type === "migrate_first") {
				const junctionTable = ambiguous.removedName; // e.g. "post_tag"
				const targetFkCol = ambiguous.addedName; // e.g. "tagId"
				const targetTable = ambiguous.tableName; // e.g. "posts"

				// Find insert position: after addColumn(targetFkCol) on targetTable
				const addColIdx = result.findIndex(
					(op) => op.type === "alterTable" &&
						op.tableName === targetTable &&
						op.operations.some((o) => o.type === "addColumn" && o.column === targetFkCol),
				);

				// Find drop position: before dropTable(junction)
				const dropTableIdx = result.findIndex(
					(op) => op.type === "dropTable" && op.tableName === junctionTable,
				);

				if (addColIdx === -1 || dropTableIdx === -1) continue;

				// Junction FK col for target table: singular of targetTable + "Id" (e.g. "posts" → "postId")
				const targetModelName = this.singularize(targetTable);
				const sourceFkCol = `${targetModelName}Id`; // e.g. "postId"
				const relatedFkCol = targetFkCol; // e.g. "tagId"

				const transferOp: DataTransferOperation = {
					type: "dataTransfer",
					description: `Migrate first relation from '${junctionTable}' to '${targetTable}.${targetFkCol}'`,
					execute: async (runner: QueryRunner) => {
						const selectResult = await runner.executeQuery<{ [key: string]: unknown }>({
							type: "select",
							table: junctionTable,
							select: [sourceFkCol, relatedFkCol],
						});
						if (!selectResult.success) throw selectResult.error;

						// Group by sourceFk, keep first occurrence per source record
						const firstBySource = new Map<unknown, unknown>();
						for (const row of selectResult.data.rows) {
							const sourceId = row[sourceFkCol];
							if (!firstBySource.has(sourceId)) {
								firstBySource.set(sourceId, row[relatedFkCol]);
							}
						}

						// Update each source record with its first related FK
						for (const [sourceId, relatedId] of firstBySource) {
							const updateResult = await runner.executeQuery({
								type: "update",
								table: targetTable,
								where: { id: { $eq: sourceId } },
								data: { [relatedFkCol]: relatedId },
							});
							if (!updateResult.success) throw updateResult.error;
						}
					},
				};

				// Insert after addColumn, but before dropTable
				const insertAt = Math.min(addColIdx + 1, dropTableIdx);
				result.splice(insertAt, 0, transferOp);
			}
		}

		return result;
	}

	/**
	 * Get dry-run preview of what would be applied
	 */
	async preview(): Promise<Result<readonly MigrationOperation[], MigrationSystemError>> {
		const planResult = this.getPlan();
		if (!planResult.success) {
			return {
				success: false,
				error: planResult.error,
			};
		}

		return { success: true, data: planResult.data.operations };
	}
}

/**
 * Create migration session
 */
export async function createMigrationSession(
	forja: IForja,
): Promise<Result<MigrationSession, MigrationSystemError>> {
	const session = new MigrationSession(forja);
	const initResult = await session.initialize();

	if (!initResult.success) {
		return {
			success: false,
			error: initResult.error,
		};
	}

	return { success: true, data: session };
}
