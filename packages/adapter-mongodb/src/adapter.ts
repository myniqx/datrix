/**
 * MongoDB Database Adapter
 *
 * Main adapter implementation for MongoDB.
 * Handles connection management, query execution, transactions, and schema operations.
 *
 * Key differences from SQL adapters:
 * - No SQL generation: uses MongoDB native operations (find, insertMany, updateMany, etc.)
 * - Auto-increment IDs: managed via _forja collection counters (MongoDB has no SERIAL)
 * - Schema-less: ALTER TABLE operations translate to $set/$unset/$rename on all documents
 * - Transactions: require replica set (MongoDB limitation)
 */

import type {
	MongoClient as NativeMongoClient,
	Db,
	ClientSession,
	Collection,
	Document,
} from "mongodb";
import { MongoClient as NativeMongoClientClass } from "mongodb";

import { MongoDBQueryTranslator } from "./query-translator";
import { MongoDBPopulator } from "./populate";
import { MongoClient } from "./mongo-client";
import { resolveNestedWhere } from "./nested-where";
import {
	validateFkReferences,
	validateFkReferencesForUpdate,
} from "./fk-validator";
import { applyOnDeleteActions } from "./on-delete";
import { MongoDBExporter } from "./export-import/exporter";
import { MongoDBImporter } from "./export-import/importer";
import type { ExportWriter, ImportReader } from "@forja/core/types/adapter";
import type {
	MongoDBConfig,
	MongoFindResult,
	MongoTranslateResult,
} from "./types";
import { COUNTER_KEY_PREFIX } from "./types";
import { getNextIds } from "./helpers";
import type { QueryObject, QuerySelectObject } from "@forja/core/types";
import type { ForjaEntry } from "@forja/core/types";
import type {
	AlterOperation,
	ConnectionState,
	DatabaseAdapter,
	QueryMetadata,
	QueryResult,
	Transaction,
} from "@forja/core/types/adapter";
import {
	ForjaAdapterError,
	throwNotConnected,
	throwConnectionError,
	throwMigrationError,
	throwIntrospectionError,
	throwTransactionError,
	throwTransactionSavepointNotSupported,
	throwQueryError,
	throwMetaFieldAlreadyExists,
	throwMetaFieldNotFound,
} from "@forja/core/types/errors";
import { validateQueryObject } from "@forja/core/types/utils";
import type {
	IndexDefinition,
	ISchemaRegistry,
	SchemaDefinition,
} from "@forja/core/types";
import type { SchemaRegistry } from "@forja/core";
import { FORJA_META_MODEL, FORJA_META_KEY_PREFIX } from "@forja/core/types";

/**
 * MongoDB adapter implementation
 */
export class MongoDBAdapter implements DatabaseAdapter<MongoDBConfig> {
	readonly name = "mongodb";
	readonly config: MongoDBConfig;

	private nativeClient: NativeMongoClient | undefined;
	private db: Db | undefined;
	private state: ConnectionState = "disconnected";
	private _schemas: ISchemaRegistry | undefined;
	private _translator: MongoDBQueryTranslator | undefined;

	constructor(config: MongoDBConfig) {
		this.config = config;
	}

	private getTranslator(): MongoDBQueryTranslator {
		return this._translator!;
	}

	/**
	 * Get a MongoClient wrapper for operations
	 */
	private createClient<T extends ForjaEntry>(
		session: ClientSession | undefined,
		query: QueryObject<T>,
	): MongoClient<T> {
		if (!this.db) {
			throwNotConnected({ adapter: "mongodb" });
		}
		return new MongoClient(this.db!, session, query);
	}

	/**
	 * Get the _forja meta collection
	 */
	private getMetaCollection(): Collection<Document> {
		if (!this.db) {
			throwNotConnected({ adapter: "mongodb" });
		}
		return this.db!.collection(FORJA_META_MODEL);
	}

	// =========================================================================
	// Connection Management
	// =========================================================================

	async connect(schemas: ISchemaRegistry): Promise<void> {
		if (this.state === "connected") return;
		this.state = "connecting";
		this._schemas = schemas;
		this._translator = new MongoDBQueryTranslator(schemas as SchemaRegistry);

		try {
			this.nativeClient = new NativeMongoClientClass(this.config.uri, {
				maxPoolSize: this.config.maxPoolSize ?? 10,
				minPoolSize: this.config.minPoolSize ?? 2,
				connectTimeoutMS: this.config.connectTimeoutMS ?? 10000,
				serverSelectionTimeoutMS: this.config.serverSelectionTimeoutMS ?? 5000,
				appName: this.config.appName ?? "forja",
				...(this.config.tls !== undefined && { tls: this.config.tls }),
				...(this.config.tlsCAFile && { tlsCAFile: this.config.tlsCAFile }),
				...(this.config.replicaSet && { replicaSet: this.config.replicaSet }),
				...(this.config.authSource && { authSource: this.config.authSource }),
			});

			await this.nativeClient.connect();
			this.db = this.nativeClient.db(this.config.database);

			// Verify connection
			await this.db.command({ ping: 1 });
			this.state = "connected";
		} catch (error) {
			this.state = "error";
			const message = error instanceof Error ? error.message : String(error);
			throwConnectionError({
				adapter: "mongodb",
				message: `Failed to connect to MongoDB: ${message}`,
				cause: error instanceof Error ? error : undefined,
			});
		}
	}

	async disconnect(): Promise<void> {
		if (this.state === "disconnected") return;

		try {
			if (this.nativeClient) {
				await this.nativeClient.close();
				this.nativeClient = undefined;
				this.db = undefined;
			}
			this.state = "disconnected";
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throwConnectionError({
				adapter: "mongodb",
				message: `Failed to disconnect from MongoDB: ${message}`,
				operation: "disconnect",
				cause: error instanceof Error ? error : undefined,
			});
		}
	}

	isConnected(): boolean {
		return this.state === "connected" && this.db !== undefined;
	}

	getConnectionState(): ConnectionState {
		return this.state;
	}

	// =========================================================================
	// Query Execution
	// =========================================================================

	async executeQuery<TResult extends ForjaEntry>(
		query: QueryObject<TResult>,
		session?: ClientSession,
	): Promise<QueryResult<TResult>> {
		validateQueryObject(query);

		if (!this.db) {
			throwNotConnected({ adapter: "mongodb" });
		}

		const client = this.createClient(session, query);

		try {
			// SELECT with populate
			if (
				query.type === "select" &&
				query.populate &&
				Object.keys(query.populate).length > 0
			) {
				return this.executeWithPopulate<TResult>(query, client);
			}

			const translated = this.getTranslator().translate(query);

			// Resolve nested relation WHERE conditions (cross-collection lookups)
			const resolved = await this.resolveFilterRelations(translated, client);

			switch (resolved.operation) {
				case "find":
					return this.executeFindOp<TResult>(
						resolved as MongoFindResult,
						client,
					);
				case "insertMany":
					return this.executeInsertOp<TResult>(resolved, client);
				case "updateMany":
					return this.executeUpdateOp<TResult>(resolved, client);
				case "deleteMany":
					return this.executeDeleteOp<TResult>(resolved, client);
				case "countDocuments":
					return this.executeCountOp<TResult>(resolved, client);
				default:
					throwQueryError({
						adapter: "mongodb",
						message: `Unknown operation: ${(translated as { operation: string }).operation}`,
					});
			}
		} catch (error) {
			if (error instanceof ForjaAdapterError) throw error;
			throw this.mapMongoError(error, query);
		}
	}

	private async executeFindOp<TResult extends ForjaEntry>(
		op: MongoFindResult,
		client: MongoClient<TResult>,
	): Promise<QueryResult<TResult>> {
		// MongoDB treats limit(0) as "no limit" — return empty immediately
		if (op.limit === 0) {
			return {
				rows: [] as unknown as readonly TResult[],
				metadata: { rowCount: 0, affectedRows: 0 },
			};
		}

		const collection = client.getCollection(op.collection);
		const sessionOpts = client.sessionOptions();

		const projection = op.projection
			? { ...op.projection, _id: 0 }
			: { _id: 0 };

		let cursor = collection.find(op.filter, { ...sessionOpts, projection });
		if (op.sort) cursor = cursor.sort(op.sort);
		if (op.skip !== undefined) cursor = cursor.skip(op.skip);
		if (op.limit !== undefined) cursor = cursor.limit(op.limit);

		const rows = await client.execute(
			`find:${op.collection}`,
			() => cursor.toArray(),
			{ filter: op.filter },
		);

		const metadata: QueryMetadata = {
			rowCount: rows.length,
			affectedRows: rows.length,
		};

		return { rows: rows as unknown as readonly TResult[], metadata };
	}

	private async executeInsertOp<TResult extends ForjaEntry>(
		op: {
			readonly collection: string;
			readonly documents: readonly Document[];
		},
		client: MongoClient<TResult>,
	): Promise<QueryResult<TResult>> {
		// Validate FK references (MongoDB has no FK constraints)
		await validateFkReferences(
			op.collection,
			op.documents as readonly Record<string, unknown>[],
			client,
			this._schemas!,
		);

		// Apply schema default values (MongoDB has no DEFAULT constraint)
		const docsWithDefaults = this.applyDefaults(
			op.collection,
			op.documents,
			this._schemas!,
		);

		const metaCollection = this.getMetaCollection();
		const docCount = docsWithDefaults.length;

		// Get auto-increment IDs
		const firstId = await getNextIds(metaCollection, op.collection, docCount);

		// Assign IDs to documents
		const docsWithIds = docsWithDefaults.map((doc, index) => ({
			...doc,
			id: firstId + index,
		}));

		const collection = client.getCollection(op.collection);
		const sessionOpts = client.sessionOptions();

		await client.execute(
			`insertMany:${op.collection}`,
			() => collection.insertMany(docsWithIds as Document[], sessionOpts),
			{ count: docCount },
		);

		const idRows = docsWithIds.map((doc) => ({ id: doc.id })) as TResult[];
		const metadata: QueryMetadata = {
			rowCount: docCount,
			affectedRows: docCount,
			insertIds: docsWithIds.map((d) => d.id),
		};

		return { rows: idRows, metadata };
	}

	private async executeUpdateOp<TResult extends ForjaEntry>(
		op: {
			readonly collection: string;
			readonly filter: Document;
			readonly update: Document;
		},
		client: MongoClient<TResult>,
	): Promise<QueryResult<TResult>> {
		// Validate FK references in $set data (MongoDB has no FK constraints)
		const setData = (op.update as { $set?: Record<string, unknown> }).$set;
		if (setData) {
			await validateFkReferencesForUpdate(
				op.collection,
				setData,
				client,
				this._schemas!,
			);
		}

		const collection = client.getCollection(op.collection);
		const sessionOpts = client.sessionOptions();

		// Pre-fetch affected IDs (like MySQL adapter - no RETURNING in MongoDB)
		const affectedDocs = await client.execute(
			`find:${op.collection}:preUpdate`,
			() =>
				collection
					.find(op.filter, { ...sessionOpts, projection: { _id: 0, id: 1 } })
					.toArray(),
		);

		await client.execute(
			`updateMany:${op.collection}`,
			() => collection.updateMany(op.filter, op.update, sessionOpts),
			{ filter: op.filter },
		);

		const idRows = affectedDocs.map((doc) => ({ id: doc["id"] })) as TResult[];
		const metadata: QueryMetadata = {
			rowCount: affectedDocs.length,
			affectedRows: affectedDocs.length,
		};

		return { rows: idRows, metadata };
	}

	private async executeDeleteOp<TResult extends ForjaEntry>(
		op: { readonly collection: string; readonly filter: Document },
		client: MongoClient<TResult>,
	): Promise<QueryResult<TResult>> {
		const collection = client.getCollection(op.collection);
		const sessionOpts = client.sessionOptions();

		// Pre-fetch IDs to delete (needed for ON DELETE actions)
		const docsToDelete = await client.execute(
			`find:${op.collection}:preDelete`,
			() =>
				collection
					.find(op.filter, { ...sessionOpts, projection: { _id: 0, id: 1 } })
					.toArray(),
		);
		const idsToDelete = docsToDelete.map((d) => d["id"] as number);

		// Apply ON DELETE actions (restrict/setNull/cascade) before deleting
		if (idsToDelete.length > 0) {
			await applyOnDeleteActions(
				op.collection,
				idsToDelete,
				client,
				this._schemas!,
			);
		}

		const result = await client.execute(
			`deleteMany:${op.collection}`,
			() => collection.deleteMany(op.filter, sessionOpts),
			{ filter: op.filter },
		);

		const metadata: QueryMetadata = {
			rowCount: result.deletedCount,
			affectedRows: result.deletedCount,
		};

		return { rows: [] as unknown as readonly TResult[], metadata };
	}

	private async executeCountOp<TResult extends ForjaEntry>(
		op: { readonly collection: string; readonly filter: Document },
		client: MongoClient<TResult>,
	): Promise<QueryResult<TResult>> {
		const collection = client.getCollection(op.collection);
		const sessionOpts = client.sessionOptions();

		const count = await client.execute(
			`countDocuments:${op.collection}`,
			() => collection.countDocuments(op.filter, sessionOpts),
			{ filter: op.filter },
		);

		const metadata: QueryMetadata = {
			rowCount: 0,
			affectedRows: 0,
			count,
		};

		return { rows: [] as unknown as readonly TResult[], metadata };
	}

	/**
	 * Execute query with populate
	 */
	private async executeWithPopulate<TResult extends ForjaEntry>(
		query: QuerySelectObject<TResult>,
		client: MongoClient<TResult>,
	): Promise<QueryResult<TResult>> {
		const populator = new MongoDBPopulator(
			client,
			this._schemas!,
			this._translator!,
		);

		const translated = this.getTranslator().translate(query) as MongoFindResult;
		const resolved = (await this.resolveFilterRelations(
			translated,
			client,
		)) as MongoFindResult;
		const rows = await populator.populate(
			query,
			resolved.filter,
			resolved.projection,
			resolved.sort as Document | undefined,
		);

		const metadata: QueryMetadata = {
			rowCount: rows.length,
			affectedRows: rows.length,
		};

		return { rows, metadata };
	}

	/**
	 * Apply schema default values to insert documents.
	 * MongoDB has no DEFAULT constraint, so we inject defaults here.
	 */
	private applyDefaults(
		collection: string,
		documents: readonly Document[],
		schemaRegistry: ISchemaRegistry,
	): Document[] {
		const modelName = schemaRegistry.findModelByTableName(collection);
		if (!modelName) return documents as Document[];
		const schema = schemaRegistry.get(modelName);
		if (!schema) return documents as Document[];

		// Collect field defaults and nullable fields.
		// SQL databases store NULL for missing optional columns and apply DEFAULT
		// constraints automatically. MongoDB has neither, so we do both here.
		const fieldDefaults: Record<string, unknown> = {};
		for (const [fieldName, field] of Object.entries(schema.fields)) {
			if (field.type === "relation") continue;
			if (field.hidden) continue;
			if (fieldName === "id") continue;
			if (field.default !== undefined) {
				fieldDefaults[fieldName] = field.default;
			} else if (!field.required) {
				fieldDefaults[fieldName] = null;
			}
		}

		if (Object.keys(fieldDefaults).length === 0) return documents as Document[];

		// Mutate objects in-place to avoid high memory allocation in bulk inserts
		const mutableDocs = documents as Document[];
		for (const doc of mutableDocs) {
			for (const [fieldName, defaultValue] of Object.entries(fieldDefaults)) {
				if (!(fieldName in doc)) {
					doc[fieldName] = defaultValue;
				}
			}
		}

		return mutableDocs;
	}

	/**
	 * Resolve nested relation conditions in translated query filter.
	 * Only applies to operations that have a filter (find, count, update, delete).
	 */
	private async resolveFilterRelations<TResult extends ForjaEntry>(
		translated: MongoTranslateResult,
		client: MongoClient<TResult>,
	): Promise<MongoTranslateResult> {
		if (!("filter" in translated) || !translated.filter) return translated;

		const filterKeys = Object.keys(translated.filter);
		if (filterKeys.length === 0) return translated;

		const resolvedFilter = await resolveNestedWhere(
			translated.filter,
			translated.collection,
			client,
			this._schemas!,
		);

		return { ...translated, filter: resolvedFilter } as MongoTranslateResult;
	}

	/**
	 * Map MongoDB errors to ForjaAdapterError
	 */
	private mapMongoError<TResult extends ForjaEntry>(
		error: unknown,
		query?: QueryObject<TResult>,
	): ForjaAdapterError {
		if (error instanceof ForjaAdapterError) return error;

		const message = error instanceof Error ? error.message : String(error);
		const mongoError = error as { code?: number; codeName?: string };

		const forjaCode =
			mongoError.code === 11000 || mongoError.code === 11001
				? ("ADAPTER_UNIQUE_CONSTRAINT" as const)
				: ("ADAPTER_QUERY_ERROR" as const);

		return new ForjaAdapterError(`Query execution failed: ${message}`, {
			adapter: "mongodb",
			code: forjaCode,
			operation: "query",
			context: {
				...(query && { query: { type: query.type, table: query.table } }),
				...(mongoError.code !== undefined && { mongoCode: mongoError.code }),
				...(mongoError.codeName && { mongoCodeName: mongoError.codeName }),
			},
			cause: error instanceof Error ? error : undefined,
		});
	}

	// =========================================================================
	// Raw Query
	// =========================================================================

	async executeRawQuery<TResult extends ForjaEntry>(
		sql: string,
		_params: readonly unknown[],
		session?: ClientSession,
	): Promise<QueryResult<TResult>> {
		if (!this.db) {
			throwNotConnected({ adapter: "mongodb" });
		}

		const client = this.createClient(session, {
			type: "rawQuery",
			table: "raw",
			operation: "raw",
		} as unknown as QueryObject);

		try {
			// Interpret "sql" as a JSON command for MongoDB
			const command = JSON.parse(sql) as Document;
			const sessionOpts = client.sessionOptions();
			const result = await client.execute(
				"rawCommand",
				() => this.db!.command(command, sessionOpts),
				{ command },
			);

			const rows =
				(result as { cursor?: { firstBatch?: Document[] } })?.cursor
					?.firstBatch ?? [];

			const metadata: QueryMetadata = {
				rowCount: rows.length,
				affectedRows: rows.length,
			};

			return { rows: rows as unknown as readonly TResult[], metadata };
		} catch (error) {
			if (error instanceof ForjaAdapterError) throw error;
			throw this.mapMongoError(error);
		}
	}

	// =========================================================================
	// Transaction
	// =========================================================================

	async beginTransaction(): Promise<Transaction> {
		if (!this.nativeClient || !this.db) {
			throwNotConnected({ adapter: "mongodb" });
		}

		try {
			const session = this.nativeClient!.startSession();
			session.startTransaction();

			const transaction = new MongoDBTransaction(
				session,
				this,
				`tx_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
			);

			return transaction;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throwTransactionError({
				adapter: "mongodb",
				message: `Failed to begin transaction: ${message}`,
				cause: error instanceof Error ? error : undefined,
			});
		}
	}

	// =========================================================================
	// Schema Operations
	// =========================================================================

	async createTable(
		schema: SchemaDefinition,
		_session?: ClientSession,
		options?: {
			/**
			 * Set to true when called from the importer.
			 * Skips upsertSchemaMeta so the importer can restore _forja data as-is.
			 */
			isImport?: boolean;
		},
	): Promise<void> {
		if (!this.db) {
			throwNotConnected({ adapter: "mongodb" });
		}

		try {
			// Create collection
			await this.db!.createCollection(schema.tableName!);

			// _forja is a key/value meta collection - index on `key`, not `id`
			const collection = this.db!.collection(schema.tableName!);
			if (schema.name === FORJA_META_MODEL) {
				await collection.createIndex({ key: 1 }, { unique: true });
			} else {
				// Regular collections get unique index on auto-increment `id`
				await collection.createIndex({ id: 1 }, { unique: true });
			}

			// Create indexes defined in schema
			if (schema.indexes) {
				for (const index of schema.indexes) {
					await this.addIndex(schema.tableName!, index, schema);
				}
			}

			// Track schema in _forja (skip during import — _forja data will be restored as-is)
			if (!options?.isImport) {
				if (schema.name !== FORJA_META_MODEL) {
					const metaExists = await this.tableExists(FORJA_META_MODEL);
					if (!metaExists) {
						throwMigrationError({
							adapter: "mongodb",
							message: `Cannot create collection '${schema.name}': '${FORJA_META_MODEL}' collection does not exist yet. Create '${FORJA_META_MODEL}' first.`,
						});
					}
				}

				await this.upsertSchemaMeta(schema);
			}
		} catch (error) {
			if (error instanceof ForjaAdapterError) throw error;
			const message = error instanceof Error ? error.message : String(error);
			throwMigrationError({
				adapter: "mongodb",
				message: `Failed to create collection '${schema.name}': ${message}`,
				table: schema.tableName,
				cause: error instanceof Error ? error : undefined,
			});
		}
	}

	async dropTable(
		tableName: string,
		_session?: ClientSession,
		options?: { isImport?: boolean },
	): Promise<void> {
		if (!this.db) {
			throwNotConnected({ adapter: "mongodb" });
		}

		try {
			await this.db!.collection(tableName).drop();

			// Remove schema from _forja (skip during import — _forja data will be restored as-is)
			if (!options?.isImport && tableName !== FORJA_META_MODEL) {
				const metaKey = `${FORJA_META_KEY_PREFIX}${tableName}`;
				const metaCollection = this.getMetaCollection();
				await metaCollection.deleteOne({ key: metaKey });

				// Remove counter
				const counterKey = `${COUNTER_KEY_PREFIX}${tableName}`;
				await metaCollection.deleteOne({ key: counterKey });
			}
		} catch (error) {
			if (error instanceof ForjaAdapterError) throw error;
			const message = error instanceof Error ? error.message : String(error);
			throwMigrationError({
				adapter: "mongodb",
				message: `Failed to drop collection '${tableName}': ${message}`,
				table: tableName,
				cause: error instanceof Error ? error : undefined,
			});
		}
	}

	async renameTable(
		from: string,
		to: string,
		_session?: ClientSession,
	): Promise<void> {
		if (!this.db) {
			throwNotConnected({ adapter: "mongodb" });
		}

		try {
			await this.db!.collection(from).rename(to);

			// Update key in _forja
			if (from !== FORJA_META_MODEL && to !== FORJA_META_MODEL) {
				const metaCollection = this.getMetaCollection();
				const oldKey = `${FORJA_META_KEY_PREFIX}${from}`;
				const newKey = `${FORJA_META_KEY_PREFIX}${to}`;
				await metaCollection.updateOne(
					{ key: oldKey },
					{ $set: { key: newKey } },
				);

				// Rename counter key
				const oldCounterKey = `${COUNTER_KEY_PREFIX}${from}`;
				const newCounterKey = `${COUNTER_KEY_PREFIX}${to}`;
				await metaCollection.updateOne(
					{ key: oldCounterKey },
					{ $set: { key: newCounterKey } },
				);
			}
		} catch (error) {
			if (error instanceof ForjaAdapterError) throw error;
			const message = error instanceof Error ? error.message : String(error);
			throwMigrationError({
				adapter: "mongodb",
				message: `Failed to rename collection '${from}' to '${to}': ${message}`,
				cause: error instanceof Error ? error : undefined,
			});
		}
	}

	async alterTable(
		tableName: string,
		operations: readonly AlterOperation[],
		_session?: ClientSession,
	): Promise<void> {
		if (!this.db) {
			throwNotConnected({ adapter: "mongodb" });
		}

		try {
			const collection = this.db!.collection(tableName);

			for (const op of operations) {
				switch (op.type) {
					case "addColumn": {
						// Set default value on all existing documents
						const defaultVal = op.definition.default ?? null;
						await collection.updateMany(
							{},
							{ $set: { [op.column]: defaultVal } },
						);
						break;
					}
					case "dropColumn": {
						await collection.updateMany({}, { $unset: { [op.column]: "" } });
						break;
					}
					case "modifyColumn": {
						// MongoDB is schema-less, type changes don't need DDL
						// If type conversion is needed, it would be done via aggregation pipeline
						// For now, this is a no-op since the data should already be compatible
						break;
					}
					case "renameColumn": {
						await collection.updateMany({}, { $rename: { [op.from]: op.to } });
						break;
					}
				}
			}

			// Update schema in _forja
			if (tableName !== FORJA_META_MODEL) {
				await this.applyOperationsToMetaSchema(tableName, operations);
			}
		} catch (error) {
			if (error instanceof ForjaAdapterError) throw error;
			const message = error instanceof Error ? error.message : String(error);
			throwMigrationError({
				adapter: "mongodb",
				message: `Failed to alter collection '${tableName}': ${message}`,
				table: tableName,
				cause: error instanceof Error ? error : undefined,
			});
		}
	}

	async addIndex(
		tableNameParam: string,
		index: IndexDefinition,
		schema?: SchemaDefinition,
		_session?: ClientSession,
	): Promise<void> {
		if (!this.db) {
			throwNotConnected({ adapter: "mongodb" });
		}

		try {
			const collection = this.db!.collection(tableNameParam);
			const indexName =
				index.name ?? `idx_${tableNameParam}_${index.fields.join("_")}`;

			// Map relation fields to their foreign keys
			const mappedFields = index.fields.map((fieldName) => {
				if (schema) {
					const field = schema.fields[fieldName];
					if (field && field.type === "relation") {
						const relationField = field as { foreignKey?: string };
						return relationField.foreignKey || fieldName;
					}
				}
				return fieldName;
			});

			const indexSpec: Record<string, 1> = {};
			for (const field of mappedFields) {
				indexSpec[field] = 1;
			}

			await collection.createIndex(indexSpec, {
				unique: index.unique ?? false,
				name: indexName,
			});
		} catch (error) {
			if (error instanceof ForjaAdapterError) throw error;
			const message = error instanceof Error ? error.message : String(error);
			throwMigrationError({
				adapter: "mongodb",
				message: `Failed to add index on collection '${tableNameParam}': ${message}`,
				table: tableNameParam,
				cause: error instanceof Error ? error : undefined,
			});
		}
	}

	async dropIndex(
		tableName: string,
		indexName: string,
		_session?: ClientSession,
	): Promise<void> {
		if (!this.db) {
			throwNotConnected({ adapter: "mongodb" });
		}

		try {
			const collection = this.db!.collection(tableName);
			await collection.dropIndex(indexName);
		} catch (error) {
			if (error instanceof ForjaAdapterError) throw error;
			const message = error instanceof Error ? error.message : String(error);
			throwMigrationError({
				adapter: "mongodb",
				message: `Failed to drop index '${indexName}': ${message}`,
				table: tableName,
				cause: error instanceof Error ? error : undefined,
			});
		}
	}

	// =========================================================================
	// Introspection
	// =========================================================================

	async getTables(): Promise<readonly string[]> {
		if (!this.db) {
			throwNotConnected({ adapter: "mongodb" });
		}

		try {
			const collections = await this.db!.listCollections().toArray();
			return collections.map((c) => c.name).sort();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throwIntrospectionError({
				adapter: "mongodb",
				message: `Failed to get collections: ${message}`,
				cause: error instanceof Error ? error : undefined,
			});
		}
	}

	async getTableSchema(tableName: string): Promise<SchemaDefinition | null> {
		if (!this.db) {
			throwNotConnected({ adapter: "mongodb" });
		}

		try {
			const metaKey = `${FORJA_META_KEY_PREFIX}${tableName}`;
			const metaCollection = this.getMetaCollection();
			const doc = await metaCollection.findOne({ key: metaKey });

			if (!doc) return null;

			return JSON.parse(doc["value"] as string) as SchemaDefinition;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throwIntrospectionError({
				adapter: "mongodb",
				message: `Failed to get collection schema for '${tableName}': ${message}`,
				table: tableName,
				cause: error instanceof Error ? error : undefined,
			});
		}
	}

	async tableExists(tableName: string): Promise<boolean> {
		if (!this.db) return false;

		try {
			const collections = await this.db
				.listCollections({ name: tableName })
				.toArray();
			return collections.length > 0;
		} catch {
			return false;
		}
	}

	// =========================================================================
	// Meta Schema Helpers
	// =========================================================================

	private async upsertSchemaMeta(schema: SchemaDefinition): Promise<void> {
		const metaCollection = this.getMetaCollection();
		const metaKey = `${FORJA_META_KEY_PREFIX}${schema.tableName ?? schema.name}`;
		const metaValue = JSON.stringify(schema);
		const now = new Date();

		await metaCollection.updateOne(
			{ key: metaKey },
			{
				$set: { key: metaKey, value: metaValue, updatedAt: now },
				$setOnInsert: { createdAt: now },
			},
			{ upsert: true },
		);
	}

	async exportData(writer: ExportWriter): Promise<void> {
		await new MongoDBExporter(this.db!, this).export(writer);
	}

	async importData(reader: ImportReader): Promise<void> {
		await new MongoDBImporter(this.db!, this).import(reader);
	}

	private async applyOperationsToMetaSchema(
		tableName: string,
		operations: readonly AlterOperation[],
	): Promise<void> {
		const metaCollection = this.getMetaCollection();
		const metaKey = `${FORJA_META_KEY_PREFIX}${tableName}`;
		const doc = await metaCollection.findOne({ key: metaKey });

		if (!doc) {
			throwMigrationError({
				adapter: "mongodb",
				message: `Schema meta for collection '${tableName}' not found in _forja`,
				table: tableName,
			});
		}

		const schema = JSON.parse(doc!["value"] as string) as SchemaDefinition;
		const fields = { ...schema.fields };

		for (const op of operations) {
			switch (op.type) {
				case "addColumn":
					fields[op.column] = op.definition;
					break;
				case "dropColumn":
					delete fields[op.column];
					break;
				case "modifyColumn":
					fields[op.column] = op.newDefinition;
					break;
				case "renameColumn": {
					const fieldDef = fields[op.from];
					if (fieldDef !== undefined) {
						fields[op.to] = fieldDef;
						delete fields[op.from];
					}
					// Update relation fields that reference the renamed column
					for (const [key, def] of Object.entries(fields)) {
						if (def.type === "relation" && def.foreignKey === op.from) {
							fields[key] = { ...def, foreignKey: op.to };
						}
					}
					break;
				}
				case "addMetaField":
					if (fields[op.field] !== undefined) {
						throwMetaFieldAlreadyExists({
							adapter: "mongodb",
							field: op.field,
							table: tableName,
						});
					}
					fields[op.field] = op.definition;
					break;
				case "dropMetaField":
					if (fields[op.field] === undefined) {
						throwMetaFieldNotFound({
							adapter: "mongodb",
							field: op.field,
							table: tableName,
						});
					}
					delete fields[op.field];
					break;
				case "modifyMetaField":
					if (fields[op.field] === undefined) {
						throwMetaFieldNotFound({
							adapter: "mongodb",
							field: op.field,
							table: tableName,
						});
					}
					fields[op.field] = op.newDefinition;
					break;
			}
		}

		const updatedSchema: SchemaDefinition = { ...schema, fields };
		const updatedValue = JSON.stringify(updatedSchema);
		await metaCollection.updateOne(
			{ key: metaKey },
			{ $set: { value: updatedValue, updatedAt: new Date() } },
		);
	}
}

// =============================================================================
// Transaction
// =============================================================================

/**
 * MongoDB transaction implementation
 *
 * Uses ClientSession for transaction management.
 * Delegates query execution to adapter's executeQuery with the session.
 */
class MongoDBTransaction implements Transaction {
	readonly id: string;
	private session: ClientSession;
	private adapter: MongoDBAdapter;
	private committed = false;
	private rolledBack = false;
	private aborted = false;

	constructor(session: ClientSession, adapter: MongoDBAdapter, id: string) {
		this.session = session;
		this.adapter = adapter;
		this.id = id;
	}

	async executeQuery<TResult extends ForjaEntry>(
		query: QueryObject<TResult>,
	): Promise<QueryResult<TResult>> {
		if (this.committed || this.rolledBack) {
			throwQueryError({
				adapter: "mongodb",
				message: "Transaction already completed",
				query: query as QueryObject,
			});
		}

		if (this.aborted) {
			throwQueryError({
				adapter: "mongodb",
				message:
					"Transaction is aborted, commands ignored until end of transaction block",
				query: query as QueryObject,
			});
		}

		try {
			return await this.adapter.executeQuery<TResult>(query, this.session);
		} catch (error) {
			this.aborted = true;
			throw error;
		}
	}

	async executeRawQuery<TResult extends ForjaEntry>(
		sql: string,
		params: readonly unknown[],
	): Promise<QueryResult<TResult>> {
		if (this.committed || this.rolledBack) {
			throwQueryError({
				adapter: "mongodb",
				message: "Transaction already completed",
				sql,
			});
		}

		if (this.aborted) {
			throwQueryError({
				adapter: "mongodb",
				message:
					"Transaction is aborted, commands ignored until end of transaction block",
				sql,
			});
		}

		try {
			return await this.adapter.executeRawQuery<TResult>(
				sql,
				params,
				this.session,
			);
		} catch (error) {
			this.aborted = true;
			throw error;
		}
	}

	async commit(): Promise<void> {
		if (this.committed) {
			throwTransactionError({
				adapter: "mongodb",
				message: "Transaction already committed",
			});
		}
		if (this.rolledBack) {
			throwTransactionError({
				adapter: "mongodb",
				message: "Transaction already rolled back",
			});
		}

		try {
			await this.session.commitTransaction();
			this.committed = true;
			this.session.endSession();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throwTransactionError({
				adapter: "mongodb",
				message: `Failed to commit transaction: ${message}`,
				cause: error instanceof Error ? error : undefined,
			});
		}
	}

	async rollback(): Promise<void> {
		if (this.committed) {
			throwTransactionError({
				adapter: "mongodb",
				message: "Transaction already committed",
			});
		}
		if (this.rolledBack) {
			throwTransactionError({
				adapter: "mongodb",
				message: "Transaction already rolled back",
			});
		}

		try {
			await this.session.abortTransaction();
			this.rolledBack = true;
			this.session.endSession();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throwTransactionError({
				adapter: "mongodb",
				message: `Failed to rollback transaction: ${message}`,
				cause: error instanceof Error ? error : undefined,
			});
		}
	}

	async savepoint(_name: string): Promise<void> {
		throwTransactionSavepointNotSupported({ adapter: "mongodb" });
	}

	async rollbackTo(_name: string): Promise<void> {
		throwTransactionSavepointNotSupported({ adapter: "mongodb" });
	}

	async release(_name: string): Promise<void> {
		throwTransactionSavepointNotSupported({ adapter: "mongodb" });
	}

	/**
	 * MongoDB cannot create/drop/rename collections inside a multi-document
	 * transaction. DDL operations run without the session.
	 */
	async createTable(schema: SchemaDefinition): Promise<void> {
		return this.adapter.createTable(schema);
	}

	async dropTable(tableName: string): Promise<void> {
		return this.adapter.dropTable(tableName);
	}

	async renameTable(from: string, to: string): Promise<void> {
		return this.adapter.renameTable(from, to);
	}

	async alterTable(
		tableName: string,
		operations: readonly AlterOperation[],
	): Promise<void> {
		return this.adapter.alterTable(tableName, operations, this.session);
	}

	async addIndex(tableName: string, index: IndexDefinition): Promise<void> {
		return this.adapter.addIndex(tableName, index, undefined, this.session);
	}

	async dropIndex(tableName: string, indexName: string): Promise<void> {
		return this.adapter.dropIndex(tableName, indexName, this.session);
	}
}

/**
 * Create MongoDB adapter
 */
export function createMongoDBAdapter(config: MongoDBConfig): MongoDBAdapter {
	return new MongoDBAdapter(config);
}
