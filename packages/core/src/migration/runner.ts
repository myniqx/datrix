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
} from "@forja/core/types/core/migration";
import { MigrationSystemError } from "@forja/core/types/core/migration";
import { DatabaseAdapter, Transaction } from "@forja/core/types/adapter";

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
	 *
	 * Operations are split into 3 phases for adapter compatibility:
	 * - Phase 1 (pre-tx): createTable — run before transaction
	 * - Phase 2 (tx): alterTable, dataTransfer, createIndex, dropIndex, renameTable, raw — inside transaction
	 * - Phase 3 (post-tx): dropTable — run after successful commit
	 *
	 * This split is necessary because some adapters (e.g. MongoDB) cannot run
	 * DDL operations (create/drop collection) inside a multi-document transaction.
	 * For SQL adapters this is harmless since DDL is transaction-safe anyway.
	 *
	 * NOTE: On failure during phase 2, tables created in phase 1 may remain
	 * as empty leftovers. This is acceptable — no data loss occurs.
	 */
	async runOne(migration: Migration): Promise<MigrationExecutionResult> {
		const startTime = Date.now();

		// Split operations into 3 phases, preserving relative order within each phase
		const { preOps, txOps, postOps } = this.splitOperationsByPhase(
			migration.operations,
		);

		try {
			// Phase 1: createTable operations (outside transaction)
			for (const operation of preOps) {
				try {
					await this.executeOperationDirect(operation);
				} catch (error) {
					const executionTime = Date.now() - startTime;
					const err = error instanceof Error ? error : new Error(String(error));
					await this.recordSafe(migration, executionTime, "failed", err);
					return { migration, status: "failed", executionTime, error: err };
				}
			}

			// Phase 2: DML and non-DDL operations (inside transaction)
			const tx = await this.adapter.beginTransaction();
			try {
				for (const operation of txOps) {
					try {
						await this.executeOperation(tx, operation);
					} catch (error) {
						await tx.rollback();
						const executionTime = Date.now() - startTime;
						const err =
							error instanceof Error ? error : new Error(String(error));
						await this.recordSafe(migration, executionTime, "failed", err);
						return { migration, status: "failed", executionTime, error: err };
					}
				}

				try {
					await tx.commit();
				} catch (error) {
					const executionTime = Date.now() - startTime;
					const err = error instanceof Error ? error : new Error(String(error));
					return { migration, status: "failed", executionTime, error: err };
				}
			} catch (error) {
				await tx.rollback();
				const executionTime = Date.now() - startTime;
				const err = error instanceof Error ? error : new Error(String(error));
				await this.recordSafe(migration, executionTime, "failed", err);
				return { migration, status: "failed", executionTime, error: err };
			}

			// Phase 3: dropTable operations (after successful commit)
			for (const operation of postOps) {
				try {
					await this.executeOperationDirect(operation);
				} catch (error) {
					// Drop failures after successful commit are warnings, not failures.
					// Data is already safely migrated — leftover tables can be cleaned manually.
					const executionTime = Date.now() - startTime;
					const warnings = [
						`Post-commit dropTable failed: ${(error as Error).message}`,
					];
					await this.recordSafe(migration, executionTime, "completed");
					return { migration, status: "completed", executionTime, warnings };
				}
			}

			const executionTime = Date.now() - startTime;
			const warnings: string[] = [];
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
			const message = error instanceof Error ? error.message : String(error);
			throw new MigrationSystemError(
				`Failed to run migration: ${message}`,
				"MIGRATION_ERROR",
				error,
			);
		}
	}

	/**
	 * Split migration operations into 3 phases.
	 * Preserves relative order within each phase.
	 *
	 * - pre: createTable (must exist before DML references them)
	 * - tx: everything else except dropTable
	 * - post: dropTable (safe to drop after data is committed)
	 */
	private splitOperationsByPhase(operations: readonly MigrationOperation[]): {
		readonly preOps: readonly MigrationOperation[];
		readonly txOps: readonly MigrationOperation[];
		readonly postOps: readonly MigrationOperation[];
	} {
		const preOps: MigrationOperation[] = [];
		const txOps: MigrationOperation[] = [];
		const postOps: MigrationOperation[] = [];

		for (const op of operations) {
			if (op.type === "createTable") {
				preOps.push(op);
			} else if (op.type === "dropTable" || op.type === "renameTable") {
				postOps.push(op);
			} else {
				txOps.push(op);
			}
		}

		return { preOps, txOps, postOps };
	}

	/**
	 * Execute a migration operation directly on the adapter (outside transaction)
	 */
	private async executeOperationDirect(
		operation: MigrationOperation,
	): Promise<void> {
		switch (operation.type) {
			case "createTable":
				return await this.adapter.createTable(operation.schema);
			case "dropTable":
				return await this.adapter.dropTable(operation.tableName);
			case "renameTable":
				return await this.adapter.renameTable(operation.from, operation.to);
			default:
				throw new MigrationSystemError(
					`Operation type '${operation.type}' cannot run outside transaction`,
					"MIGRATION_ERROR",
				);
		}
	}

	/**
	 * Record migration history safely (never throws)
	 */
	private async recordSafe(
		migration: Migration,
		executionTime: number,
		status: "completed" | "failed",
		error?: Error,
	): Promise<void> {
		try {
			await this.history.record(migration, executionTime, status, error);
		} catch {
			// Swallow — recording failure should not mask the original error
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
