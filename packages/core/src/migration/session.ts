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

import { DatabaseAdapter } from "forja-types/adapter";
import { SchemaDefinition, FieldDefinition } from "forja-types/core/schema";
import {
	Migration,
	MigrationOperation,
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
 * Ambiguous change that requires user input
 */
export interface AmbiguousChange {
	readonly id: string;
	readonly tableName: string;
	readonly type: "column_rename_or_replace" | "table_rename_or_replace";
	readonly removedName: string;
	readonly addedName: string;
	readonly removedDefinition?: FieldDefinition;
	readonly addedDefinition?: FieldDefinition;
	readonly possibleActions: readonly AmbiguousAction[];
	resolved: boolean;
	resolvedAction?: AmbiguousAction;
}

/**
 * Possible action for ambiguous change
 */
export interface AmbiguousAction {
	readonly type: "rename" | "drop_and_add";
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
	 * Detect ambiguous changes (potential renames)
	 */
	private detectAmbiguousChanges(): void {
		// Group by table
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

		// Check for potential column renames (same table, one removed, one added)
		for (const [tableName, removed] of removedFields) {
			const added = addedFields.get(tableName);
			if (!added) continue;

			// For each removed field, check if there's a potential rename candidate
			for (const removedDiff of removed) {
				if (removedDiff.type !== "fieldRemoved") continue;

				for (const addedDiff of added) {
					if (addedDiff.type !== "fieldAdded") continue;

					// Same type = potential rename
					if (
						removedDiff.type === "fieldRemoved" &&
						addedDiff.type === "fieldAdded" &&
						this.couldBeRename(undefined, addedDiff.definition)
					) {
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
					}
				}
			}
		}

		// Check for potential table renames
		for (const removedDiff of removedTables) {
			if (removedDiff.type !== "tableRemoved") continue;

			for (const addedDiff of addedTables) {
				if (addedDiff.type !== "tableAdded") continue;

				// Similar structure = potential rename
				if (this.couldBeTableRename(removedDiff.tableName, addedDiff.schema)) {
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
				}
			}
		}
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
	 */
	private couldBeTableRename(
		oldTableName: string,
		newSchema: SchemaDefinition,
	): boolean {
		const oldSchema = this.databaseSchemas.get(oldTableName);
		if (!oldSchema) return false;

		// Compare field count and types
		const oldFields = Object.keys(oldSchema.fields);
		const newFields = Object.keys(newSchema.fields);

		// If field count is similar, might be rename
		const similarity =
			Math.min(oldFields.length, newFields.length) /
			Math.max(oldFields.length, newFields.length);

		return similarity > 0.7; // 70% similar = potential rename
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
		action: "rename" | "drop_and_add",
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
		if (action === "rename") {
			this.applyRenameResolution(ambiguous);
		}
		// drop_and_add keeps original differences

		return { success: true, data: undefined };
	}

	/**
	 * Apply rename resolution - replace drop+add with rename
	 */
	private applyRenameResolution(ambiguous: AmbiguousChange): void {
		if (ambiguous.type === "column_rename_or_replace") {
			// Remove the fieldRemoved and fieldAdded diffs
			this.differences = this.differences.filter((d) => {
				if (d.type === "fieldRemoved" && d.tableName === ambiguous.tableName && d.fieldName === ambiguous.removedName) {
					return false;
				}
				if (d.type === "fieldAdded" && d.tableName === ambiguous.tableName && d.fieldName === ambiguous.addedName) {
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
		} else if (ambiguous.type === "table_rename_or_replace") {
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
				operations: operationsResult.data.up,
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

		const migration = migrationResult.data;

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
