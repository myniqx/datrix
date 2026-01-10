# Migration Module API Reference

> Complete API reference for migration module.

---

## Classes

### ForgeSchemaDiffer

```typescript
class ForgeSchemaDiffer implements SchemaDiffer {
  compare(
    oldSchemas: Record<string, SchemaDefinition>,
    newSchemas: Record<string, SchemaDefinition>
  ): Result<SchemaComparison, MigrationSystemError>
}
```

### ForgeMigrationGenerator

```typescript
class ForgeMigrationGenerator implements MigrationGenerator {
  generate(
    differences: readonly SchemaDiff[],
    metadata: Omit<MigrationMetadata, 'timestamp'>
  ): Result<Migration, MigrationSystemError>

  generateOperations(
    differences: readonly SchemaDiff[]
  ): Result<{
    readonly up: readonly MigrationOperation[]
    readonly down: readonly MigrationOperation[]
  }, MigrationSystemError>
}
```

### ForgeMigrationHistory

```typescript
class ForgeMigrationHistory implements MigrationHistory {
  constructor(adapter: DatabaseAdapter, tableName?: string)

  initialize(): Promise<Result<void, MigrationSystemError>>

  record(
    migration: Migration,
    executionTime: number,
    status: MigrationStatus,
    error?: Error
  ): Promise<Result<void, MigrationSystemError>>

  getAll(): Promise<Result<readonly MigrationHistoryRecord[], MigrationSystemError>>

  getApplied(): Promise<Result<readonly MigrationHistoryRecord[], MigrationSystemError>>

  getPending(
    allMigrations: readonly Migration[]
  ): Promise<Result<readonly Migration[], MigrationSystemError>>

  getLatest(): Promise<Result<MigrationHistoryRecord | undefined, MigrationSystemError>>
}
```

### ForgeMigrationRunner

```typescript
class ForgeMigrationRunner implements MigrationRunner {
  constructor(
    adapter: DatabaseAdapter,
    history: MigrationHistory,
    migrations: readonly Migration[]
  )

  getPending(): Promise<Result<readonly Migration[], MigrationSystemError>>

  getApplied(): Promise<Result<readonly MigrationHistoryRecord[], MigrationSystemError>>

  runPending(options?: {
    readonly target?: string
    readonly dryRun?: boolean
  }): Promise<Result<readonly MigrationExecutionResult[], MigrationSystemError>>

  runOne(
    migration: Migration,
    direction: MigrationDirection
  ): Promise<Result<MigrationExecutionResult, MigrationSystemError>>

  rollback(options?: {
    readonly target?: string
    readonly steps?: number
  }): Promise<Result<readonly MigrationExecutionResult[], MigrationSystemError>>

  status(): Promise<Result<MigrationPlan, MigrationSystemError>>
}
```

---

## Factory Functions

```typescript
function createSchemaDiffer(): ForgeSchemaDiffer

function createMigrationGenerator(): ForgeMigrationGenerator

function createMigrationHistory(
  adapter: DatabaseAdapter,
  tableName?: string
): ForgeMigrationHistory

function createMigrationRunner(
  adapter: DatabaseAdapter,
  history: MigrationHistory,
  migrations: readonly Migration[]
): ForgeMigrationRunner
```

---

## Types

```typescript
type MigrationDirection = 'up' | 'down'

type MigrationStatus = 'success' | 'failed' | 'pending'

interface Migration {
  readonly name: string
  readonly version: string
  readonly up: readonly MigrationOperation[]
  readonly down: readonly MigrationOperation[]
  readonly timestamp: number
}

interface MigrationMetadata {
  readonly name: string
  readonly version: string
  readonly timestamp: number
}

interface MigrationHistoryRecord {
  readonly version: string
  readonly name: string
  readonly appliedAt: Date
  readonly executionTime: number
  readonly status: MigrationStatus
  readonly error?: string
}

interface MigrationExecutionResult {
  readonly migration: Migration
  readonly direction: MigrationDirection
  readonly status: MigrationStatus
  readonly executionTime: number
  readonly error?: Error
}

interface MigrationPlan {
  readonly pending: readonly Migration[]
  readonly applied: readonly MigrationHistoryRecord[]
  readonly total: number
  readonly pendingCount: number
  readonly appliedCount: number
}

interface SchemaComparison {
  readonly hasChanges: boolean
  readonly differences: readonly SchemaDiff[]
  readonly added: readonly string[]
  readonly removed: readonly string[]
  readonly modified: readonly string[]
}

type SchemaDiff =
  | SchemaAddedDiff
  | SchemaRemovedDiff
  | SchemaModifiedDiff

interface SchemaAddedDiff {
  readonly type: 'schemaAdded'
  readonly schema: SchemaDefinition
}

interface SchemaRemovedDiff {
  readonly type: 'schemaRemoved'
  readonly schemaName: string
}

interface SchemaModifiedDiff {
  readonly type: 'schemaModified'
  readonly schemaName: string
  readonly changes: readonly FieldChange[]
}

type FieldChange =
  | FieldAddedChange
  | FieldRemovedChange
  | FieldModifiedChange

type MigrationOperation =
  | CreateTableOperation
  | DropTableOperation
  | AddColumnOperation
  | RemoveColumnOperation
  | ModifyColumnOperation
  | RenameTableOperation
  | AddIndexOperation
  | RemoveIndexOperation
  | RawSQLOperation
```

---

## Source

- Schema differ - `packages/core/src/migration/differ.ts`
- Migration generator - `packages/core/src/migration/generator.ts`
- Migration history - `packages/core/src/migration/history.ts`
- Migration runner - `packages/core/src/migration/runner.ts`
- Migration types - `packages/types/src/migration.ts`
