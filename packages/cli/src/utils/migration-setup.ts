/**
 * Migration Setup Helper
 *
 * Creates MigrationRunner from a Forja instance.
 * Handles the pipeline: adapter → history → differ → generator → runner
 */

import {
	createMigrationHistory,
	createMigrationRunner,
	createSchemaDiffer,
	createMigrationGenerator,
} from "forja-core";
import type { Forja } from "forja-core";
import type { MigrationRunner } from "forja-types/core/migration";
import type { SchemaDefinition } from "forja-types/core/schema";
import { CLIError } from "../types";
import { Result } from "forja-types/utils";

/**
 * Create a MigrationRunner from an initialized Forja instance
 *
 * Steps:
 * 1. Get adapter and schemas from Forja
 * 2. Create migration history tracker
 * 3. Diff current schemas against DB state (empty = first run)
 * 4. Generate migrations from diffs
 * 5. Create runner with generated migrations
 */
export async function createMigrationSetup(
	forja: Forja,
): Promise<Result<MigrationRunner, CLIError>> {
	try {
		const adapter = forja.getAdapter();
		const schemaRegistry = forja.getSchemas();
		const migrationConfig = forja.getMigrationConfig();

		// Create history tracker
		const history = createMigrationHistory(
			adapter,
			migrationConfig.tableName,
		);

		// Get current schemas as record
		const allSchemas = schemaRegistry.getAll();
		const newSchemas: Record<string, SchemaDefinition> = {};
		for (const schema of allSchemas) {
			newSchemas[schema.tableName ?? schema.name] = schema;
		}

		// Diff against empty (first run) or existing state
		// History tracks what's been applied, differ finds what's new
		const differ = createSchemaDiffer();
		const generator = createMigrationGenerator();

		// Get applied migrations to determine old state
		const initResult = await history.initialize();
		if (!initResult.success) {
			return {
				success: false,
				error: new CLIError(
					`Failed to initialize migration history: ${initResult.error.message}`,
					"EXECUTION_ERROR",
					initResult.error,
				),
			};
		}

		// Compare current schemas with empty state (runner handles history internally)
		const comparison = differ.compare({}, newSchemas);
		if (!comparison.success) {
			return {
				success: false,
				error: new CLIError(
					`Failed to diff schemas: ${comparison.error.message}`,
					"EXECUTION_ERROR",
					comparison.error,
				),
			};
		}

		// Generate migrations from diffs
		const migrations = [];
		if (comparison.data.differences.length > 0) {
			const migrationResult = generator.generate(
				comparison.data.differences,
				{
					name: `auto_${Date.now()}`,
					description: "Auto-generated migration from schema diff",
				},
			);

			if (!migrationResult.success) {
				return {
					success: false,
					error: new CLIError(
						`Failed to generate migrations: ${migrationResult.error.message}`,
						"EXECUTION_ERROR",
						migrationResult.error,
					),
				};
			}

			migrations.push(migrationResult.data);
		}

		// Create runner
		const runner = createMigrationRunner(adapter, history, migrations);

		return { success: true, data: runner };
	} catch (error) {
		const message =
			error instanceof Error ? error.message : String(error);
		return {
			success: false,
			error: new CLIError(
				`Failed to setup migration runner: ${message}`,
				"EXECUTION_ERROR",
				error,
			),
		};
	}
}
