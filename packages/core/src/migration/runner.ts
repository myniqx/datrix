/**
 * Migration Runner Implementation
 *
 * Executes migrations and manages migration plans.
 */

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
	async getPending(): Promise<readonly Migration[]> {
		try {
			// Initialize history table
			await this.history.initialize();

			// Get applied migrations
			const appliedResult = await this.history.getAll();

			const appliedVersions = new Set(
				appliedResult
					.filter((record) => record.status === "completed")
					.map((record) => record.version),
			);

			// Filter pending migrations
			const pending = this.migrations.filter(
				(migration) => !appliedVersions.has(migration.metadata.version),
			);

			return pending;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new MigrationSystemError(
				`Failed to get pending migrations: ${message}`,
				"MIGRATION_ERROR",
				error,
			);
		}
	}

	/**
	 * Get applied migrations
	 */
	async getApplied(): Promise<readonly MigrationHistoryRecord[]> {
		await this.history.initialize();
		return await this.history.getAll();
	}

	/**
	 * Run pending migrations
	 */
	async runPending(options?: {
		readonly target?: string;
		readonly dryRun?: boolean;
	}): Promise<readonly MigrationExecutionResult[]> {
		try {
			let migrationsToRun = await this.getPending();

			// Filter by target version if specified
			if (options?.target) {
				const targetIndex = migrationsToRun.findIndex(
					(m) => m.metadata.version === options.target,
				);

				if (targetIndex === -1) {
					throw new MigrationSystemError(
						`Target version ${options.target} not found`,
						"MIGRATION_ERROR",
					);
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
				return simulatedResults;
			}

			const results: MigrationExecutionResult[] = [];

			for (const migration of migrationsToRun) {
				const result = await this.runOne(migration);

				results.push(result);

				// Stop on failure
				if (result.status === "failed") {
					break;
				}
			}

			return results;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new MigrationSystemError(
				`Failed to run pending migrations: ${message}`,
				"MIGRATION_ERROR",
				error,
			);
		}
	}

	/**
	 * Run specific migration
	 */
	async runOne(migration: Migration): Promise<MigrationExecutionResult> {
		const startTime = Date.now();

		try {
			// Begin transaction
			const tx = await this.adapter.beginTransaction();
			try {
				// Execute all operations within transaction
				for (const operation of migration.operations) {
					try {
						await this.executeOperation(tx, operation);
					} catch (error) {
						// Rollback transaction on failure
						await tx.rollback();

						const executionTime = Date.now() - startTime;

						// Record failure
						await this.history.record(
							migration,
							executionTime,
							"failed",
							error as Error,
						);

						return {
							migration,
							status: "failed",
							executionTime,
							error: error as Error,
						};
					}
				}

				try {
					// Commit transaction
					await tx.commit();
				} catch (error) {
					const executionTime = Date.now() - startTime;

					return {
						migration,
						status: "failed",
						executionTime,
						error: error as Error,
					};
				}

				const executionTime = Date.now() - startTime;
				// Collect warning if recording fails, but don't fail the migration
				const warnings: string[] = [];

				// Record success
				try {
					await this.history.record(migration, executionTime, "completed");
				} catch (error) {
					warnings.push(
						`Failed to record migration history: ${(error as Error).message}`,
					);
				}

				return {
					migration,
					status: "completed",
					executionTime,
					...(warnings.length > 0 && { warnings }),
				};
			} catch (error) {
				// Rollback on error
				await tx.rollback();

				const executionTime = Date.now() - startTime;
				const err = error instanceof Error ? error : new Error(String(error));

				const warnings: string[] = [];
				// Record success
				try {
					await this.history.record(migration, executionTime, "failed", err);
				} catch (error) {
					warnings.push(
						`Failed to record migration history: ${(error as Error).message}`,
					);
				}

				return {
					migration,
					status: "failed",
					executionTime,
					error: err,
					...(warnings.length > 0 && { warnings }),
				};
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);

			throw new MigrationSystemError(
				`Failed to run migration: ${message}`,
				"MIGRATION_ERROR",
				error,
			);
		}
	}

	/**
	 * Get migration plan
	 */
	getPlan(options?: { readonly target?: string }): MigrationPlan {
		try {
			let migrations = [...this.migrations];

			if (options?.target) {
				const targetIndex = migrations.findIndex(
					(m) => m.metadata.version === options.target,
				);

				if (targetIndex === -1) {
					throw new MigrationSystemError(
						`Target version ${options.target} not found`,
						"MIGRATION_ERROR",
					);
				}

				migrations = migrations.slice(0, targetIndex + 1);
			}

			return {
				migrations,
				...(options?.target !== undefined && { target: options.target }),
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new MigrationSystemError(
				`Failed to create migration plan: ${message}`,
				"MIGRATION_ERROR",
				error,
			);
		}
	}

	/**
	 * Execute a single migration operation within a transaction
	 */
	private async executeOperation(
		tx: Transaction,
		operation: MigrationOperation,
	): Promise<void> {
		switch (operation.type) {
			case "createTable":
				return await tx.createTable(operation.schema);

			case "dropTable":
				return await tx.dropTable(operation.tableName);

			case "alterTable":
				return await tx.alterTable(operation.tableName, operation.operations);

			case "createIndex":
				return await tx.addIndex(operation.tableName, operation.index);

			case "dropIndex":
				return await tx.dropIndex(operation.tableName, operation.indexName);

			case "renameTable":
				return await tx.renameTable(operation.from, operation.to);

			case "raw":
				await tx.executeRawQuery(operation.sql, operation.params ?? []);
				return;

			case "dataTransfer":
				return await operation.execute(tx);
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
