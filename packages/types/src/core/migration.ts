/**
 * Migration System Type Definitions (~200 LOC)
 *
 * Types for database schema migrations, diffing, and history tracking.
 */

import { AlterOperation, QueryRunner } from "../adapter";
import { Result } from "../utils";
import { FieldDefinition, IndexDefinition, SchemaDefinition } from "./schema";

/**
 * Migration status
 */
export type MigrationStatus = "pending" | "running" | "completed" | "failed";

/**
 * Migration metadata
 */
export interface MigrationMetadata {
	readonly name: string;
	readonly version: string;
	readonly timestamp: number;
	readonly description?: string;
	readonly author?: string;
}

/**
 * Migration context for execution
 */
export interface MigrationContext {
	readonly version: string;
	readonly dryRun?: boolean;
}

/**
 * Migration operation types
 */
export type MigrationOperationType =
	| "createTable"
	| "dropTable"
	| "alterTable"
	| "createIndex"
	| "dropIndex"
	| "renameTable"
	| "raw"
	| "dataTransfer";

/**
 * Base migration operation
 */
export interface BaseMigrationOperation {
	readonly type: MigrationOperationType;
}

/**
 * Create table operation
 */
export interface CreateTableOperation extends BaseMigrationOperation {
	readonly type: "createTable";
	readonly schema: SchemaDefinition;
}

/**
 * Drop table operation
 */
export interface DropTableOperation extends BaseMigrationOperation {
	readonly type: "dropTable";
	readonly tableName: string;
}

/**
 * Alter table operation
 */
export interface AlterTableOperation extends BaseMigrationOperation {
	readonly type: "alterTable";
	readonly tableName: string;
	readonly operations: readonly AlterOperation[];
}

/**
 * Create index operation
 */
export interface CreateIndexOperation extends BaseMigrationOperation {
	readonly type: "createIndex";
	readonly tableName: string;
	readonly index: IndexDefinition;
}

/**
 * Drop index operation
 */
export interface DropIndexOperation extends BaseMigrationOperation {
	readonly type: "dropIndex";
	readonly tableName: string;
	readonly indexName: string;
}

/**
 * Rename table operation
 */
export interface RenameTableOperation extends BaseMigrationOperation {
	readonly type: "renameTable";
	readonly from: string;
	readonly to: string;
}

/**
 * Raw SQL operation (for custom migrations)
 */
export interface RawSQLOperation extends BaseMigrationOperation {
	readonly type: "raw";
	readonly sql: string;
	readonly params?: readonly unknown[];
}

/**
 * Data transfer operation — runs a callback with the transaction runner.
 * Used for migrating data between tables (e.g. FK → junction, junction → FK).
 */
export interface DataTransferOperation extends BaseMigrationOperation {
	readonly type: "dataTransfer";
	readonly description: string;
	readonly execute: (runner: QueryRunner) => Promise<void>;
}

/**
 * Union of all migration operations
 */
export type MigrationOperation =
	| CreateTableOperation
	| DropTableOperation
	| AlterTableOperation
	| CreateIndexOperation
	| DropIndexOperation
	| RenameTableOperation
	| RawSQLOperation
	| DataTransferOperation;

/**
 * Migration definition
 */
export interface Migration {
	readonly metadata: MigrationMetadata;
	readonly operations: readonly MigrationOperation[];
}

/**
 * Schema difference types
 */
export type SchemaDiffType =
	| "tableAdded"
	| "tableRemoved"
	| "tableRenamed"
	| "fieldAdded"
	| "fieldRemoved"
	| "fieldModified"
	| "fieldRenamed"
	| "indexAdded"
	| "indexRemoved";

/**
 * Base schema difference
 */
export interface BaseSchemaDiff {
	readonly type: SchemaDiffType;
}

/**
 * Table added difference
 */
export interface TableAddedDiff extends BaseSchemaDiff {
	readonly type: "tableAdded";
	readonly schema: SchemaDefinition;
}

/**
 * Table removed difference
 */
export interface TableRemovedDiff extends BaseSchemaDiff {
	readonly type: "tableRemoved";
	readonly tableName: string;
}

/**
 * Table renamed difference
 */
export interface TableRenamedDiff extends BaseSchemaDiff {
	readonly type: "tableRenamed";
	readonly from: string;
	readonly to: string;
}

/**
 * Field added difference
 */
export interface FieldAddedDiff extends BaseSchemaDiff {
	readonly type: "fieldAdded";
	readonly tableName: string;
	readonly fieldName: string;
	readonly definition: FieldDefinition;
}

/**
 * Field removed difference
 */
export interface FieldRemovedDiff extends BaseSchemaDiff {
	readonly type: "fieldRemoved";
	readonly tableName: string;
	readonly fieldName: string;
}

/**
 * Field modified difference
 */
export interface FieldModifiedDiff extends BaseSchemaDiff {
	readonly type: "fieldModified";
	readonly tableName: string;
	readonly fieldName: string;
	readonly oldDefinition: FieldDefinition;
	readonly newDefinition: FieldDefinition;
}

/**
 * Field renamed difference
 */
export interface FieldRenamedDiff extends BaseSchemaDiff {
	readonly type: "fieldRenamed";
	readonly tableName: string;
	readonly from: string;
	readonly to: string;
}

/**
 * Index added difference
 */
export interface IndexAddedDiff extends BaseSchemaDiff {
	readonly type: "indexAdded";
	readonly tableName: string;
	readonly index: IndexDefinition;
}

/**
 * Index removed difference
 */
export interface IndexRemovedDiff extends BaseSchemaDiff {
	readonly type: "indexRemoved";
	readonly tableName: string;
	readonly indexName: string;
}

/**
 * Union of all schema differences
 */
export type SchemaDiff =
	| TableAddedDiff
	| TableRemovedDiff
	| TableRenamedDiff
	| FieldAddedDiff
	| FieldRemovedDiff
	| FieldModifiedDiff
	| FieldRenamedDiff
	| IndexAddedDiff
	| IndexRemovedDiff;

/**
 * Schema comparison result
 */
export interface SchemaComparison {
	readonly differences: readonly SchemaDiff[];
	readonly hasChanges: boolean;
}

/**
 * Migration history record (stored in database)
 */
export interface MigrationHistoryRecord {
	readonly id: number;
	readonly name: string;
	readonly version: string;
	readonly appliedAt: Date;
	readonly executionTime: number; // milliseconds
	readonly status: MigrationStatus;
	readonly checksum?: string;
	readonly error?: string;
}

/**
 * Migration execution result
 */
export interface MigrationExecutionResult {
	readonly migration: Migration;
	readonly status: MigrationStatus;
	readonly executionTime: number;
	readonly error?: Error;
	readonly warnings?: readonly string[];
}

/**
 * Migration plan (list of migrations to execute)
 */
export interface MigrationPlan {
	readonly migrations: readonly Migration[];
	readonly target?: string; // Target version (undefined = latest)
}

/**
 * Migration error
 */
export class MigrationSystemError extends Error {
	constructor(
		message: string,
		public readonly code:
			| "MIGRATION_ERROR"
			| "DIFF_ERROR"
			| "GENERATION_ERROR"
			| "VALIDATION_ERROR",
		public readonly details?: unknown,
	) {
		super(message);
		this.name = "MigrationSystemError";
	}
}

/**
 * Schema differ interface
 */
export interface SchemaDiffer {
	/**
	 * Compare two schemas and return differences
	 */
	compare(
		oldSchema: Record<string, SchemaDefinition>,
		newSchema: Record<string, SchemaDefinition>,
	): Result<SchemaComparison, MigrationSystemError>;

	/**
	 * Detect field type changes
	 */
	isFieldModified(
		oldField: FieldDefinition,
		newField: FieldDefinition,
	): boolean;
}

/**
 * Migration generator interface
 */
export interface MigrationGenerator {
	/**
	 * Generate migration from schema differences
	 */
	generate(
		differences: readonly SchemaDiff[],
		metadata: Omit<MigrationMetadata, "timestamp">,
	): Result<Migration, MigrationSystemError>;

	/**
	 * Generate migration operations from differences
	 */
	generateOperations(
		differences: readonly SchemaDiff[],
	): Result<readonly MigrationOperation[], MigrationSystemError>;

	/**
	 * Generate TypeScript migration file content
	 */
	generateFile(migration: Migration): string;
}

/**
 * Migration runner interface
 */
export interface MigrationRunner {
	/**
	 * Get pending migrations
	 */
	getPending(): Promise<Result<readonly Migration[], MigrationSystemError>>;

	/**
	 * Get applied migrations
	 */
	getApplied(): Promise<
		Result<readonly MigrationHistoryRecord[], MigrationSystemError>
	>;

	/**
	 * Run pending migrations
	 */
	runPending(options?: {
		readonly target?: string;
		readonly dryRun?: boolean;
	}): Promise<
		Result<readonly MigrationExecutionResult[], MigrationSystemError>
	>;

	/**
	 * Run specific migration
	 */
	runOne(
		migration: Migration,
	): Promise<Result<MigrationExecutionResult, MigrationSystemError>>;

	/**
	 * Get migration plan
	 */
	getPlan(options?: {
		readonly target?: string;
	}): Result<MigrationPlan, MigrationSystemError>;
}

/**
 * Migration history manager interface
 */
export interface MigrationHistory {
	/**
	 * Initialize migrations table
	 */
	initialize(): Promise<Result<void, MigrationSystemError>>;

	/**
	 * Record migration execution
	 */
	record(
		migration: Migration,
		executionTime: number,
		status: MigrationStatus,
		error?: Error,
	): Promise<Result<void, MigrationSystemError>>;

	/**
	 * Get all migration records
	 */
	getAll(): Promise<
		Result<readonly MigrationHistoryRecord[], MigrationSystemError>
	>;

	/**
	 * Get last applied migration
	 */
	getLast(): Promise<
		Result<MigrationHistoryRecord | undefined, MigrationSystemError>
	>;

	/**
	 * Check if migration was applied
	 */
	isApplied(version: string): Promise<Result<boolean, MigrationSystemError>>;

	/**
	 * Calculate migration checksum
	 */
	calculateChecksum(migration: Migration): string;

	/**
	 * Verify migration integrity
	 */
	verifyChecksum(migration: Migration, record: MigrationHistoryRecord): boolean;
}
