/**
 * Migration Runner Implementation
 *
 * Executes migrations and manages migration plans.
 */

import { Result } from "forja-types/utils";
import type {
	MigrationRunner,
	Migration,
	MigrationHistory,
	MigrationHistoryRecord,
	MigrationExecutionResult,
	MigrationPlan,
	MigrationOperation,
} from "forja-types/core/migration";
import { MigrationSystemError } from "forja-types/core/migration";
import { DatabaseAdapter, Transaction } from "forja-types/adapter";

/**
 * Migration runner implementation
 */
export class ForgeMigrationRunner implements MigrationRunner {
	private readonly adapter: DatabaseAdapter;
	private readonly history: MigrationHistory;
	private readonly migrations: readonly Migration[];

	constructor(
		adapter: DatabaseAdapter,
		history: MigrationHistory,
		migrations: readonly Migration[],
	) {
		this.adapter = adapter;
		this.history = history;
		this.migrations = migrations;
	}

	/**
	 * Get pending migrations
	 */
	async getPending(): Promise<
		Result<readonly Migration[], MigrationSystemError>
	> {
		try {
			// Initialize history table
			const initResult = await this.history.initialize();
			if (!initResult.success) {
				return { success: false, error: initResult.error };
			}

			// Get applied migrations
			const appliedResult = await this.history.getAll();
			if (!appliedResult.success) {
				return { success: false, error: appliedResult.error };
			}

			const appliedVersions = new Set(
				appliedResult.data
					.filter((record) => record.status === "completed")
					.map((record) => record.version),
			);

			// Filter pending migrations
			const pending = this.migrations.filter(
				(migration) => !appliedVersions.has(migration.metadata.version),
			);

			return { success: true, data: pending };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				success: false,
				error: new MigrationSystemError(
					`Failed to get pending migrations: ${message}`,
					"MIGRATION_ERROR",
					error,
				),
			};
		}
	}

	/**
	 * Get applied migrations
	 */
	async getApplied(): Promise<
		Result<readonly MigrationHistoryRecord[], MigrationSystemError>
	> {
		try {
			const initResult = await this.history.initialize();
			if (!initResult.success) {
				return { success: false, error: initResult.error };
			}

			return await this.history.getAll();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				success: false,
				error: new MigrationSystemError(
					`Failed to get applied migrations: ${message}`,
					"MIGRATION_ERROR",
					error,
				),
			};
		}
	}

	/**
	 * Run pending migrations
	 */
	async runPending(options?: {
		readonly target?: string;
		readonly dryRun?: boolean;
	}): Promise<
		Result<readonly MigrationExecutionResult[], MigrationSystemError>
	> {
		try {
			const pendingResult = await this.getPending();
			if (!pendingResult.success) {
				return { success: false, error: pendingResult.error };
			}

			let migrationsToRun = pendingResult.data;

			// Filter by target version if specified
			if (options?.target) {
				const targetIndex = migrationsToRun.findIndex(
					(m) => m.metadata.version === options.target,
				);

				if (targetIndex === -1) {
					return {
						success: false,
						error: new MigrationSystemError(
							`Target version ${options.target} not found`,
							"MIGRATION_ERROR",
						),
					};
				}

				migrationsToRun = migrationsToRun.slice(0, targetIndex + 1);
			}

			// Handle dry run - simulate migrations without executing
			if (options?.dryRun) {
				const simulatedResults: MigrationExecutionResult[] =
					migrationsToRun.map(
						(migration): MigrationExecutionResult => ({
							migration,
							status: "pending",
							executionTime: 0,
						}),
					);
				return { success: true, data: simulatedResults };
			}

			const results: MigrationExecutionResult[] = [];

			for (const migration of migrationsToRun) {
				const result = await this.runOne(migration);

				if (!result.success) {
					return { success: false, error: result.error };
				}

				results.push(result.data);

				// Stop on failure
				if (result.data.status === "failed") {
					break;
				}
			}

			return { success: true, data: results };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				success: false,
				error: new MigrationSystemError(
					`Failed to run pending migrations: ${message}`,
					"MIGRATION_ERROR",
					error,
				),
			};
		}
	}

	/**
	 * Run specific migration
	 */
	async runOne(
		migration: Migration,
	): Promise<Result<MigrationExecutionResult, MigrationSystemError>> {
		const startTime = Date.now();

		try {
			// Begin transaction
			const txResult = await this.adapter.beginTransaction();
			if (!txResult.success) {
				return {
					success: false,
					error: new MigrationSystemError(
						`Failed to begin transaction: ${txResult.error.message}`,
						"MIGRATION_ERROR",
						txResult.error,
					),
				};
			}

			const tx = txResult.data;

			try {
				// Execute all operations within transaction
				for (const operation of migration.operations) {
					const opResult = await this.executeOperation(tx, operation);

					if (!opResult.success) {
						// Rollback transaction on failure
						await tx.rollback();

						const executionTime = Date.now() - startTime;

						// Record failure
						await this.history.record(
							migration,
							executionTime,
							"failed",
							opResult.error,
						);

						return {
							success: true,
							data: {
								migration,
								status: "failed",
								executionTime,
								error: opResult.error,
							},
						};
					}
				}

				// Commit transaction
				const commitResult = await tx.commit();
				if (!commitResult.success) {
					const executionTime = Date.now() - startTime;

					return {
						success: true,
						data: {
							migration,
							status: "failed",
							executionTime,
							error: commitResult.error,
						},
					};
				}

				const executionTime = Date.now() - startTime;

				// Record success
				const recordResult = await this.history.record(
					migration,
					executionTime,
					"completed",
				);

				// Collect warning if recording fails, but don't fail the migration
				const warnings: string[] = [];
				if (!recordResult.success) {
					warnings.push(
						`Failed to record migration history: ${recordResult.error.message}`,
					);
				}

				return {
					success: true,
					data: {
						migration,
						status: "completed",
						executionTime,
						...(warnings.length > 0 && { warnings }),
					},
				};
			} catch (error) {
				// Rollback on error
				await tx.rollback();

				const executionTime = Date.now() - startTime;
				const err = error instanceof Error ? error : new Error(String(error));

				const warnings: string[] = [];
				const recordResult = await this.history.record(
					migration,
					executionTime,
					"failed",
					err,
				);
				if (!recordResult.success) {
					warnings.push(
						`Failed to record migration failure: ${recordResult.error.message}`,
					);
				}

				return {
					success: true,
					data: {
						migration,
						status: "failed",
						executionTime,
						error: err,
						...(warnings.length > 0 && { warnings }),
					},
				};
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);

			return {
				success: false,
				error: new MigrationSystemError(
					`Failed to run migration: ${message}`,
					"MIGRATION_ERROR",
					error,
				),
			};
		}
	}

	/**
	 * Get migration plan
	 */
	getPlan(options?: {
		readonly target?: string;
	}): Result<MigrationPlan, MigrationSystemError> {
		try {
			let migrations = [...this.migrations];

			if (options?.target) {
				const targetIndex = migrations.findIndex(
					(m) => m.metadata.version === options.target,
				);

				if (targetIndex === -1) {
					return {
						success: false,
						error: new MigrationSystemError(
							`Target version ${options.target} not found`,
							"MIGRATION_ERROR",
						),
					};
				}

				migrations = migrations.slice(0, targetIndex + 1);
			}

			return {
				success: true,
				data: {
					migrations,
					...(options?.target !== undefined && { target: options.target }),
				},
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				success: false,
				error: new MigrationSystemError(
					`Failed to create migration plan: ${message}`,
					"MIGRATION_ERROR",
					error,
				),
			};
		}
	}

	/**
	 * Execute a single migration operation within a transaction
	 */
	private async executeOperation(
		tx: Transaction,
		operation: MigrationOperation,
	): Promise<Result<void, Error>> {
		switch (operation.type) {
			case "createTable":
				return await tx.createTable(operation.schema);

			case "dropTable":
				return await tx.dropTable(operation.tableName);

			case "alterTable":
				return await tx.alterTable(
					operation.tableName,
					operation.operations,
				);

			case "createIndex":
				return await tx.addIndex(
					operation.tableName,
					operation.index,
				);

			case "dropIndex":
				return await tx.dropIndex(
					operation.tableName,
					operation.indexName,
				);

			case "renameTable":
				return await tx.renameTable(operation.from, operation.to);

			case "raw":
				return await tx
					.executeRawQuery(operation.sql, operation.params ?? [])
					.then((result) => {
						if (result.success) {
							return { success: true as const, data: undefined };
						}
						return { success: false as const, error: result.error };
					});
		}
	}
}

/**
 * Create migration runner
 */
export function createMigrationRunner(
	adapter: DatabaseAdapter,
	history: MigrationHistory,
	migrations: readonly Migration[],
): MigrationRunner {
	return new ForgeMigrationRunner(adapter, history, migrations);
}
