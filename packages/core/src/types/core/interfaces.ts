import { DatabaseAdapter } from "../adapter";
import { DevConfig, DatrixConfig, MigrationConfig } from "./config";
import {
	PopulateClause,
	SelectClause,
	WhereClause,
	OrderByClause,
} from "./query-builder";
import {
	AnyRelationInput,
	DatrixEntry,
	DatrixRecord,
	ISchemaRegistry,
} from "./schema";
import { DatrixPlugin, SchemaDefinition } from "./plugin";
import { QueryAction } from "./query-context";

export interface RawCrudOptions<T extends DatrixEntry = DatrixRecord> {
	select?: SelectClause<T> | undefined;
	populate?: PopulateClause<T> | undefined;
	noReturning?: boolean;
	/** @internal Used by the dispatcher to identify the operation type for plugin hooks. */
	action?: QueryAction;
}

export interface RawUpsertOptions<T extends DatrixEntry = DatrixRecord>
	extends RawCrudOptions<T> {
	/** A unique field, or the fields of a unique index. */
	conflictOn: readonly string[];
	/** Fields overwritten with the incoming value on conflict. Defaults to every field the rows set; `[]` leaves existing rows untouched. */
	update?: readonly string[] | undefined;
}

export interface RawCountOptions<T extends DatrixEntry = DatrixRecord> {
	/** Group results by these fields (must be non-relation schema fields). */
	groupBy?: readonly string[] | undefined;
	/** Filter groups after aggregation. Only meaningful together with `groupBy`. */
	having?: WhereClause<T> | undefined;
}

/**
 * Options for `countMany` — mirrors `RawFindManyOptions`'s single-options-bag
 * shape (`where` inside, not a separate positional parameter), but `groupBy`
 * is required: `countMany` without a grouping is just `count`.
 *
 * Contract: `countMany` always resolves to an array — one entry per distinct
 * group, each entry carrying that group's `groupBy` field values plus a
 * `count`. No rows match (or `having` filters every group out) → `[]`, never
 * a bare `0`. This is deliberately a different shape from `count()` (which
 * always returns a single `number`) so callers never have to guess whether
 * a "count" result is a number or an array — `count` vs `countMany` disambiguates
 * by name.
 */
export interface RawCountManyOptions<T extends DatrixEntry = DatrixRecord> {
	where?: WhereClause<T> | undefined;
	groupBy: readonly string[];
	/** Filter groups after aggregation; fields must be a subset of `groupBy`. */
	having?: WhereClause<T> | undefined;
}

export interface RawFindManyOptions<T extends DatrixEntry = DatrixRecord>
	extends RawCrudOptions<T>, RawCountOptions<T> {
	orderBy?: OrderByClause<T> | undefined;
	limit?: number | undefined;
	offset?: number | undefined;
	where?: WhereClause<T> | undefined;

	/** Deduplicate rows (SELECT DISTINCT). */
	distinct?: boolean | undefined;
}

/**
 * Scalar primitive accepted in untyped CRUD input.
 * Covers all field types: string, number, boolean, date, json (object), array.
 */
export type FallbackScalar =
	| string
	| number
	| boolean
	| Date
	| null
	| undefined
	| object;

/**
 * Fallback input type for untyped CRUD operations.
 * Used when no generic is provided — allows any scalar or relation input
 * without requiring a specific model type.
 */
export type FallbackInput = {
	[key: string]: FallbackScalar | FallbackScalar[] | AnyRelationInput;
};

/**
 * Raw CRUD operations interface (bypasses plugin hooks)
 *
 * Supports two usage patterns:
 * - Typed:   datrix.create<User, CreateUserInput>(model, data) — full type safety
 * - Untyped: datrix.create(model, data) — fallback with relation intellisense
 */
export interface IRawCrud {
	findOne<T extends DatrixEntry = DatrixRecord>(
		model: string,
		where: WhereClause<T>,
		options?: RawCrudOptions<T>,
	): Promise<T | null>;
	findById<T extends DatrixEntry = DatrixRecord>(
		model: string,
		id: number,
		options?: RawCrudOptions<T>,
	): Promise<T | null>;
	findMany<T extends DatrixEntry = DatrixRecord>(
		model: string,
		options?: RawFindManyOptions<T>,
	): Promise<T[]>;
	count<T extends DatrixEntry = DatrixRecord>(
		model: string,
		where?: WhereClause<T>,
	): Promise<number>;
	countMany<T extends DatrixEntry = DatrixRecord>(
		model: string,
		options: RawCountManyOptions<T>,
	): Promise<(Record<string, unknown> & { count: number })[]>;
	create<
		T extends DatrixEntry = DatrixRecord,
		TInput extends FallbackInput = FallbackInput,
	>(
		model: string,
		data: TInput,
		options?: RawCrudOptions<T>,
	): Promise<T>;
	createMany<
		T extends DatrixEntry = DatrixRecord,
		TInput extends FallbackInput = FallbackInput,
	>(
		model: string,
		data: TInput[],
		options?: RawCrudOptions<T>,
	): Promise<T[]>;
	update<
		T extends DatrixEntry = DatrixRecord,
		TInput extends FallbackInput = FallbackInput,
	>(
		model: string,
		id: number,
		data: TInput,
		options?: RawCrudOptions<T>,
	): Promise<T>;
	updateMany<
		T extends DatrixEntry = DatrixRecord,
		TInput extends FallbackInput = FallbackInput,
	>(
		model: string,
		where: WhereClause<T>,
		data: TInput,
		options?: RawCrudOptions<T>,
	): Promise<T[]>;
	upsert<
		T extends DatrixEntry = DatrixRecord,
		TInput extends FallbackInput = FallbackInput,
	>(
		model: string,
		data: TInput,
		options: RawUpsertOptions<T>,
	): Promise<T>;
	upsertMany<
		T extends DatrixEntry = DatrixRecord,
		TInput extends FallbackInput = FallbackInput,
	>(
		model: string,
		data: TInput[],
		options: RawUpsertOptions<T>,
	): Promise<T[]>;
	delete<T extends DatrixEntry = DatrixRecord>(
		model: string,
		id: number,
		options?: RawCrudOptions<T>,
	): Promise<T>;
	deleteMany<T extends DatrixEntry = DatrixRecord>(
		model: string,
		where: WhereClause<T>,
		options?: RawCrudOptions<T>,
	): Promise<T[]>;
}

/**
 * Datrix Main Singleton Class
 *
 * Extends IRawCrud to provide the same CRUD operations with plugin hooks enabled.
 * All database entry types must extend DatrixEntry to ensure
 * they include the required fields (id, createdAt, updatedAt).
 */
export interface IDatrix extends IRawCrud {
	// Lifecycle & Configuration
	shutdown(): Promise<void>;
	getConfig(): DatrixConfig;
	getAdapter<T extends DatabaseAdapter = DatabaseAdapter>(): T;
	getPlugins(): readonly DatrixPlugin[];
	getPlugin<T extends DatrixPlugin = DatrixPlugin>(name: string): T | null;
	hasPlugin(name: string): boolean;
	getSchemas(): ISchemaRegistry;
	getSchema(name: string): SchemaDefinition | undefined;
	getMigrationConfig(): Required<MigrationConfig>;
	getDevConfig(): Required<DevConfig>;
	isInitialized(): boolean;

	/**
	 * Raw CRUD operations (bypasses plugin hooks)
	 *
	 * Use this when you need direct database access without
	 * triggering onBeforeQuery/onAfterQuery plugin hooks.
	 */
	readonly raw: IRawCrud;

	/**
	 * Run CRUD operations atomically. Commits when `fn` resolves, rolls back
	 * when it throws (or when any operation inside it failed).
	 */
	transaction<R>(
		fn: (tx: DatrixTransaction) => Promise<R>,
		options?: TransactionOptions,
	): Promise<R>;
}

export type AfterCommitCallback = () => void | Promise<void>;

export interface TransactionOptions {
	/** Receives errors thrown by afterCommit callbacks (the data is already committed). */
	onAfterCommitError?: (error: unknown) => void | Promise<void>;
}

export interface DatrixTransaction extends IRawCrud {
	readonly raw: IRawCrud;

	/** Runs after a successful commit; discarded on rollback. */
	afterCommit(callback: AfterCommitCallback): void;

	/** Rolls the transaction back; `transaction()` rejects with DatrixTransactionRollbackError. */
	rollback(): never;
}
