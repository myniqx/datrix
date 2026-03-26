import { DatabaseAdapter } from "./adapter";
import { DevConfig, ForjaConfig, MigrationConfig } from "./config";
import {
	PopulateClause,
	SelectClause,
	WhereClause,
	OrderByClause,
} from "./core/query-builder";
import {
	AnyRelationInput,
	ForjaEntry,
	ForjaRecord,
	ISchemaRegistry,
} from "./core/schema";
import { ForjaPlugin, QueryAction } from "./plugin";

export interface RawCrudOptions<T extends ForjaEntry = ForjaRecord> {
	select?: SelectClause<T> | undefined;
	populate?: PopulateClause<T> | undefined;
	noReturning?: boolean;
	/** @internal Used by the dispatcher to identify the operation type for plugin hooks. */
	action?: QueryAction;
}

export interface RawFindManyOptions<
	T extends ForjaEntry = ForjaRecord,
> extends RawCrudOptions<T> {
	orderBy?: OrderByClause<T> | undefined;
	limit?: number | undefined;
	offset?: number | undefined;
	where?: WhereClause<T> | undefined;
}

/**
 * Fallback input type for untyped CRUD operations.
 * Used when no generic is provided — allows any scalar or relation input
 * without requiring a specific model type.
 */
export type FallbackInput = {
	[key: string]: string | number | boolean | Date | null | AnyRelationInput;
};

/**
 * Raw CRUD operations interface (bypasses plugin hooks)
 *
 * Supports two usage patterns:
 * - Typed:   forja.create<User, CreateUserInput>(model, data) — full type safety
 * - Untyped: forja.create(model, data) — fallback with relation intellisense
 */
export interface IRawCrud {
	findOne<T extends ForjaEntry = ForjaRecord>(
		model: string,
		where: WhereClause<T>,
		options?: RawCrudOptions<T>,
	): Promise<T | null>;
	findById<T extends ForjaEntry = ForjaRecord>(
		model: string,
		id: number,
		options?: RawCrudOptions<T>,
	): Promise<T | null>;
	findMany<T extends ForjaEntry = ForjaRecord>(
		model: string,
		options?: RawFindManyOptions<T>,
	): Promise<T[]>;
	count<T extends ForjaEntry = ForjaRecord>(
		model: string,
		where?: WhereClause<T>,
	): Promise<number>;
	create<
		T extends ForjaEntry = ForjaRecord,
		TInput extends FallbackInput = FallbackInput,
	>(
		model: string,
		data: TInput,
		options?: RawCrudOptions<T>,
	): Promise<T>;
	createMany<
		T extends ForjaEntry = ForjaRecord,
		TInput extends FallbackInput = FallbackInput,
	>(
		model: string,
		data: TInput[],
		options?: RawCrudOptions<T>,
	): Promise<T[]>;
	update<
		T extends ForjaEntry = ForjaRecord,
		TInput extends FallbackInput = FallbackInput,
	>(
		model: string,
		id: number,
		data: TInput,
		options?: RawCrudOptions<T>,
	): Promise<T>;
	updateMany<
		T extends ForjaEntry = ForjaRecord,
		TInput extends FallbackInput = FallbackInput,
	>(
		model: string,
		where: WhereClause<T>,
		data: TInput,
		options?: RawCrudOptions<T>,
	): Promise<T[]>;
	delete<T extends ForjaEntry = ForjaRecord>(
		model: string,
		id: number,
		options?: RawCrudOptions<T>,
	): Promise<T>;
	deleteMany<T extends ForjaEntry = ForjaRecord>(
		model: string,
		where: WhereClause<T>,
		options?: RawCrudOptions<T>,
	): Promise<T[]>;
}

/**
 * Forja Main Singleton Class
 *
 * Extends IRawCrud to provide the same CRUD operations with plugin hooks enabled.
 * All database entry types must extend ForjaEntry to ensure
 * they include the required fields (id, createdAt, updatedAt).
 */
export interface IForja extends IRawCrud {
	// Lifecycle & Configuration
	shutdown(): Promise<void>;
	getConfig(): ForjaConfig;
	getAdapter<T extends DatabaseAdapter = DatabaseAdapter>(): T;
	getPlugins(): readonly ForjaPlugin[];
	getPlugin(name: string): ForjaPlugin | null;
	hasPlugin(name: string): boolean;
	getSchemas(): ISchemaRegistry;
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
}
