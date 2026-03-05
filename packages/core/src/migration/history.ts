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
import { IForja } from "forja-types/forja";
import { ForjaEntry } from "forja-types";
import { DEFAULT_MIGRATION_MODEL, FORJA_META_MODEL } from "./schema";

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
	async initialize(): Promise<void> {
		if (this.initialized) {
			return;
		}

		try {
			const schema = this.forja.getSchemas().get(this.modelName);
			if (!schema) {
				throw new MigrationSystemError(
					`Migration schema '${this.modelName}' not found in registry`,
					"MIGRATION_ERROR",
				);
			}

			const adapter = this.forja.getAdapter();

			// Ensure _forja metadata table exists before any other table operation
			const metaExists = await adapter.tableExists(FORJA_META_MODEL);
			if (!metaExists) {
				const metaSchema = this.forja.getSchemas().get(FORJA_META_MODEL);
				if (!metaSchema) {
					throw new MigrationSystemError(
						`Schema '${FORJA_META_MODEL}' not found in registry`,
						"MIGRATION_ERROR",
					);
				}
				try {
					await adapter.createTable(metaSchema);
				} catch (error) {
					throw new MigrationSystemError(
						`Failed to create _forja metadata table: ${(error as Error).message}`,
						"MIGRATION_ERROR",
						error,
					);
				}
			}

			const tableName = schema.tableName ?? schema.name;
			const exists = await adapter.tableExists(tableName);

			if (!exists) {
				try {
					await adapter.createTable(schema);
				} catch (error) {
					throw new MigrationSystemError(
						`Failed to create migrations table: ${(error as Error).message}`,
						"MIGRATION_ERROR",
						error,
					);
				}
			}

			this.initialized = true;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new MigrationSystemError(
				`Failed to initialize migration history: ${message}`,
				"MIGRATION_ERROR",
				error,
			);
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
	): Promise<void> {
		try {
			const checksum = this.calculateChecksum(migration);

			await this.forja.raw.create<MigrationEntry>(this.modelName, {
				name: migration.metadata.name,
				version: migration.metadata.version,
				executionTime,
				status,
				checksum,
				error: error?.message || "",
				appliedAt: new Date(),
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new MigrationSystemError(
				`Failed to record migration: ${message}`,
				"MIGRATION_ERROR",
				error,
			);
		}
	}

	/**
	 * Get all migration records
	 */
	async getAll(): Promise<readonly MigrationHistoryRecord[]> {
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

			return records;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new MigrationSystemError(
				`Failed to get migration history: ${message}`,
				"MIGRATION_ERROR",
				error,
			);
		}
	}

	/**
	 * Get last applied migration
	 */
	async getLast(): Promise<MigrationHistoryRecord | undefined> {
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
				return undefined;
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

			return record;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new MigrationSystemError(
				`Failed to get last migration: ${message}`,
				"MIGRATION_ERROR",
				error,
			);
		}
	}

	/**
	 * Check if migration was applied
	 */
	async isApplied(version: string): Promise<boolean> {
		try {
			const count = await this.forja.raw.count<MigrationEntry>(this.modelName, {
				version,
				status: "completed",
			});

			return count > 0;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new MigrationSystemError(
				`Failed to check migration status: ${message}`,
				"MIGRATION_ERROR",
				error,
			);
		}
	}

	/**
	 * Calculate migration checksum
	 */
	calculateChecksum(migration: Migration): string {
		const content = JSON.stringify({
			operations: migration.operations,
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
