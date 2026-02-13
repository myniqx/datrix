import { DatabaseAdapter } from "./adapter";
import { DevConfig, ForjaConfig, MigrationConfig } from "./config";
import { QueryOrderBy, PopulateClause, SelectClause, WhereClause, OrderByClause } from "./core/query-builder";
import { ForjaEntry, SchemaRegistry } from "./core/schema";
import { ForjaError } from "./errors/forja-error";
import { ForjaPlugin, QueryAction } from "./plugin";
import { Result } from "./utils";

export interface RawCrudOptions<T extends ForjaEntry> {
	select?: SelectClause<T> | undefined
	populate?: PopulateClause<T> | undefined
	action?: QueryAction
	noReturning?: boolean
}

export interface RawFindManyOptions<T extends ForjaEntry> extends RawCrudOptions<T> {
	orderBy?: OrderByClause<T> | undefined
	limit?: number | undefined
	offset?: number | undefined
	where?: WhereClause<T> | undefined
}

/**
 * Raw CRUD operations interface (bypasses plugin hooks)
 *
 * All database entry types must extend ForjaEntry to ensure
 * they include the required fields (id, createdAt, updatedAt).
 */
export interface IRawCrud {
	findOne<T extends ForjaEntry = ForjaEntry>(
		model: string,
		where: WhereClause<T>,
		options?: RawCrudOptions<T>,
	): Promise<T | null>;
	findById<T extends ForjaEntry = ForjaEntry>(
		model: string,
		id: number,
		options?: RawCrudOptions<T>,
	): Promise<T | null>;
	findMany<T extends ForjaEntry = ForjaEntry>(
		model: string,
		options?: RawFindManyOptions<T>,
	): Promise<T[]>;
	count<T extends ForjaEntry = ForjaEntry>(
		model: string,
		where?: WhereClause<T>,
	): Promise<number>;
	create<T extends ForjaEntry = ForjaEntry>(
		model: string,
		data: Partial<T>,
		options?: RawCrudOptions<T>,
	): Promise<T>;
	createMany<T extends ForjaEntry = ForjaEntry>(
		model: string,
		data: Partial<T>[],
		options?: RawCrudOptions<T>,
	): Promise<T[]>;
	update<T extends ForjaEntry = ForjaEntry>(
		model: string,
		id: number,
		data: Partial<T>,
		options?: RawCrudOptions<T>,
	): Promise<T>;
	updateMany<T extends ForjaEntry = ForjaEntry>(
		model: string,
		where: WhereClause<T>,
		data: Partial<T>,
		options?: RawCrudOptions<T>,
	): Promise<T[]>;
	delete<T extends ForjaEntry = ForjaEntry>(
		model: string,
		id: number,
		options?: RawCrudOptions<T>,
	): Promise<T>;
	deleteMany<T extends ForjaEntry = ForjaEntry>(
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
	shutdown(): Promise<Result<void, ForjaError>>;
	getConfig(): ForjaConfig;
	getAdapter<T extends DatabaseAdapter = DatabaseAdapter>(): T;
	getPlugins(): readonly ForjaPlugin[];
	getPlugin(name: string): ForjaPlugin | null;
	hasPlugin(name: string): boolean;
	getSchemas(): SchemaRegistry;
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
