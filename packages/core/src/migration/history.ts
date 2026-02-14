/**
 * Migration History Manager Implementation
 *
 * Manages migration execution history in the database.
 * Uses forja.raw for all CRUD operations - no raw SQL.
 */

import { createHash } from "crypto";
import {
	Migration,
	MigrationHistory,
	MigrationHistoryRecord,
	MigrationStatus,
	MigrationSystemError,
} from "forja-types/core/migration";
import { Result } from "forja-types/utils";
import { IForja } from "forja-types/forja";
import { ForjaEntry } from "forja-types";
import { DEFAULT_MIGRATION_MODEL } from "./schema";

/**
 * Migration history entry type (matches the schema)
 */
interface MigrationEntry extends ForjaEntry {
	name: string;
	version: string;
	executionTime: number;
	status: MigrationStatus;
	checksum?: string;
	error?: string;
	appliedAt: Date;
}

/**
 * Migration history manager implementation
 */
export class ForgeMigrationHistory implements MigrationHistory {
	private readonly forja: IForja;
	private readonly modelName: string;
	private initialized = false;

	constructor(forja: IForja, modelName: string = DEFAULT_MIGRATION_MODEL) {
		this.forja = forja;
		this.modelName = modelName;
	}

	/**
	 * Initialize migrations tracking table
	 *
	 * The table is created via adapter.createTable using the migration schema.
	 * Schema is already registered in Forja initialization.
	 */
	async initialize(): Promise<Result<void, MigrationSystemError>> {
		if (this.initialized) {
			return { success: true, data: undefined };
		}

		try {
			const schema = this.forja.getSchemas().get(this.modelName);
			if (!schema) {
				return {
					success: false,
					error: new MigrationSystemError(
						`Migration schema '${this.modelName}' not found in registry`,
						"MIGRATION_ERROR",
					),
				};
			}

			const tableName = schema.tableName ?? schema.name;
			const adapter = this.forja.getAdapter();
			const exists = await adapter.tableExists(tableName);

			if (!exists) {
				const createResult = await adapter.createTable(schema);
				if (!createResult.success) {
					return {
						success: false,
						error: new MigrationSystemError(
							`Failed to create migrations table: ${createResult.error.message}`,
							"MIGRATION_ERROR",
							createResult.error,
						),
					};
				}
			}

			this.initialized = true;
			return { success: true, data: undefined };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				success: false,
				error: new MigrationSystemError(
					`Failed to initialize migration history: ${message}`,
					"MIGRATION_ERROR",
					error,
				),
			};
		}
	}

	/**
	 * Record migration execution
	 */
	async record(
		migration: Migration,
		executionTime: number,
		status: MigrationStatus,
		error?: Error,
	): Promise<Result<void, MigrationSystemError>> {
		try {
			const checksum = this.calculateChecksum(migration);

			await this.forja.raw.create<MigrationEntry>(this.modelName, {
				name: migration.metadata.name,
				version: migration.metadata.version,
				executionTime,
				status,
				checksum,
				error: error?.message,
				appliedAt: new Date(),
			});

			return { success: true, data: undefined };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				success: false,
				error: new MigrationSystemError(
					`Failed to record migration: ${message}`,
					"MIGRATION_ERROR",
					error,
				),
			};
		}
	}

	/**
	 * Get all migration records
	 */
	async getAll(): Promise<
		Result<readonly MigrationHistoryRecord[], MigrationSystemError>
	> {
		try {
			const entries = await this.forja.raw.findMany<MigrationEntry>(
				this.modelName,
				{
					orderBy: { appliedAt: "asc" },
				},
			);

			const records: MigrationHistoryRecord[] = entries.map((entry) => ({
				id: entry.id,
				name: entry.name,
				version: entry.version,
				appliedAt: entry.appliedAt,
				executionTime: entry.executionTime,
				status: entry.status,
				...(entry.checksum && { checksum: entry.checksum }),
				...(entry.error && { error: entry.error }),
			}));

			return { success: true, data: records };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				success: false,
				error: new MigrationSystemError(
					`Failed to get migration history: ${message}`,
					"MIGRATION_ERROR",
					error,
				),
			};
		}
	}

	/**
	 * Get last applied migration
	 */
	async getLast(): Promise<
		Result<MigrationHistoryRecord | undefined, MigrationSystemError>
	> {
		try {
			const entries = await this.forja.raw.findMany<MigrationEntry>(
				this.modelName,
				{
					where: { status: "completed" },
					orderBy: { appliedAt: "desc" },
					limit: 1,
				},
			);

			const entry = entries[0];
			if (!entry) {
				return { success: true, data: undefined };
			}

			const record: MigrationHistoryRecord = {
				id: entry.id,
				name: entry.name,
				version: entry.version,
				appliedAt: entry.appliedAt,
				executionTime: entry.executionTime,
				status: entry.status,
				...(entry.checksum && { checksum: entry.checksum }),
				...(entry.error && { error: entry.error }),
			};

			return { success: true, data: record };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				success: false,
				error: new MigrationSystemError(
					`Failed to get last migration: ${message}`,
					"MIGRATION_ERROR",
					error,
				),
			};
		}
	}

	/**
	 * Check if migration was applied
	 */
	async isApplied(
		version: string,
	): Promise<Result<boolean, MigrationSystemError>> {
		try {
			const count = await this.forja.raw.count<MigrationEntry>(
				this.modelName,
				{ version, status: "completed" },
			);

			return { success: true, data: count > 0 };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				success: false,
				error: new MigrationSystemError(
					`Failed to check migration status: ${message}`,
					"MIGRATION_ERROR",
					error,
				),
			};
		}
	}

	/**
	 * Remove migration record (for rollback)
	 */
	async remove(version: string): Promise<Result<void, MigrationSystemError>> {
		try {
			await this.forja.raw.deleteMany<MigrationEntry>(this.modelName, {
				version,
			});

			return { success: true, data: undefined };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				success: false,
				error: new MigrationSystemError(
					`Failed to remove migration record: ${message}`,
					"MIGRATION_ERROR",
					error,
				),
			};
		}
	}

	/**
	 * Calculate migration checksum
	 */
	calculateChecksum(migration: Migration): string {
		const content = JSON.stringify({
			up: migration.up,
			down: migration.down,
		});

		return createHash("sha256").update(content).digest("hex");
	}

	/**
	 * Verify migration integrity
	 */
	verifyChecksum(
		migration: Migration,
		record: MigrationHistoryRecord,
	): boolean {
		if (!record.checksum) {
			return true;
		}

		const currentChecksum = this.calculateChecksum(migration);
		return currentChecksum === record.checksum;
	}
}

/**
 * Create migration history manager
 */
export function createMigrationHistory(
	forja: IForja,
	tableName?: string,
): MigrationHistory {
	return new ForgeMigrationHistory(forja, tableName);
}
