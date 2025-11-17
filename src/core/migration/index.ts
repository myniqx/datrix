/**
 * Migration System Entry Point
 *
 * Exports all migration system components.
 */

// Types
export type {
  MigrationStatus,
  MigrationDirection,
  MigrationMetadata,
  MigrationContext,
  MigrationOperationType,
  MigrationOperation,
  BaseMigrationOperation,
  CreateTableOperation,
  DropTableOperation,
  AlterTableOperation,
  CreateIndexOperation,
  DropIndexOperation,
  RenameTableOperation,
  RawSQLOperation,
  Migration,
  SchemaDiffType,
  SchemaDiff,
  BaseSchemaDiff,
  TableAddedDiff,
  TableRemovedDiff,
  TableRenamedDiff,
  FieldAddedDiff,
  FieldRemovedDiff,
  FieldModifiedDiff,
  FieldRenamedDiff,
  IndexAddedDiff,
  IndexRemovedDiff,
  SchemaComparison,
  MigrationHistoryRecord,
  MigrationExecutionResult,
  MigrationPlan,
  SchemaDiffer,
  MigrationGenerator,
  MigrationRunner,
  MigrationHistory
} from './types';

export { MigrationSystemError } from './types';

// Schema Differ
export { ForgeSchemaDiffer, createSchemaDiffer } from './differ';

// Migration Generator
export { ForgeMigrationGenerator, createMigrationGenerator } from './generator';

// Migration History
export { ForgeMigrationHistory, createMigrationHistory } from './history';

// Migration Runner
export { ForgeMigrationRunner, createMigrationRunner } from './runner';
