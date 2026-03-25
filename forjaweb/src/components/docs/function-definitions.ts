/**
 * Function definitions for hover tooltips in docs.
 * Triggered on fnCall kind tokens (word followed by "(").
 */

export interface FunctionDefinition {
	signature: string;
	description: string;
	/** Link to the full docs page, e.g. "/docs/core/interfaces#findmany" */
	docsPath?: string;
}

export const FUNCTION_DEFINITIONS: Record<string, FunctionDefinition> = {
	// ─── CRUD ──────────────────────────────────────────────────────────────────

	findOne: {
		signature: `findOne<T extends ForjaEntry>(\n  model: string,\n  where: WhereClause<T>,\n  options?: RawCrudOptions<T>,\n): Promise<T | null>`,
		description:
			"Returns the first record matching where, or null if none found.",
		docsPath: "/docs/core/interfaces#findone",
	},

	findById: {
		signature: `findById<T extends ForjaEntry>(\n  model: string,\n  id: number,\n  options?: RawCrudOptions<T>,\n): Promise<T | null>`,
		description:
			"Shorthand for findOne with where: { id }. Returns null if not found.",
		docsPath: "/docs/core/interfaces#findbyid",
	},

	findMany: {
		signature: `findMany<T extends ForjaEntry>(\n  model: string,\n  options?: RawFindManyOptions<T>,\n): Promise<T[]>`,
		description:
			"Returns all records matching the given options. Returns an empty array if none found.",
		docsPath: "/docs/core/interfaces#findmany",
	},

	count: {
		signature: `count<T extends ForjaEntry>(\n  model: string,\n  where?: WhereClause<T>,\n): Promise<number>`,
		description:
			"Returns the number of records matching where. Omit where to count all records.",
		docsPath: "/docs/core/interfaces#count",
	},

	create: {
		signature: `create<T extends ForjaEntry, TInput extends FallbackInput>(\n  model: string,\n  data: TInput,\n  options?: RawCrudOptions<T>,\n): Promise<T>`,
		description:
			"Inserts a single record and returns it. Runs full field validation and injects createdAt / updatedAt automatically.",
		docsPath: "/docs/core/interfaces#create",
	},

	createMany: {
		signature: `createMany<T extends ForjaEntry, TInput extends FallbackInput>(\n  model: string,\n  data: TInput[],\n  options?: RawCrudOptions<T>,\n): Promise<T[]>`,
		description:
			"Inserts multiple records in a single transaction and returns them all.",
		docsPath: "/docs/core/interfaces#createmany",
	},

	update: {
		signature: `update<T extends ForjaEntry, TInput extends FallbackInput>(\n  model: string,\n  id: number,\n  data: TInput,\n  options?: RawCrudOptions<T>,\n): Promise<T>`,
		description:
			"Updates a single record by ID and returns it. Throws RECORD_NOT_FOUND if the ID does not exist.",
		docsPath: "/docs/core/interfaces#update",
	},

	updateMany: {
		signature: `updateMany<T extends ForjaEntry, TInput extends FallbackInput>(\n  model: string,\n  where: WhereClause<T>,\n  data: TInput,\n  options?: RawCrudOptions<T>,\n): Promise<T[]>`,
		description:
			"Updates all records matching where and returns them. Returns an empty array if no records matched.",
		docsPath: "/docs/core/interfaces#updatemany",
	},

	delete: {
		signature: `delete<T extends ForjaEntry>(\n  model: string,\n  id: number,\n  options?: RawCrudOptions<T>,\n): Promise<T>`,
		description:
			"Deletes a single record by ID and returns it. Throws RECORD_NOT_FOUND if the ID does not exist.",
		docsPath: "/docs/core/interfaces#delete",
	},

	deleteMany: {
		signature: `deleteMany<T extends ForjaEntry>(\n  model: string,\n  where: WhereClause<T>,\n  options?: RawCrudOptions<T>,\n): Promise<T[]>`,
		description: "Deletes all records matching where and returns them.",
		docsPath: "/docs/core/interfaces#deletemany",
	},

	// ─── Schema access ─────────────────────────────────────────────────────────

	getSchemas: {
		signature: `getSchemas(): SchemaRegistry`,
		description: "Returns the full schema registry.",
		docsPath: "/docs/core/interfaces#getschemas",
	},

	getSchema: {
		signature: `getSchema(\n  name: string,\n): SchemaDefinition | undefined`,
		description:
			"Returns a single schema by name, or undefined if not registered.",
		docsPath: "/docs/core/interfaces#getschema",
	},

	hasSchema: {
		signature: `hasSchema(\n  name: string,\n): boolean`,
		description: "Returns true if a schema with the given name is registered.",
		docsPath: "/docs/core/interfaces#hasschema",
	},

	getAllSchemas: {
		signature: `getAllSchemas(): readonly SchemaDefinition[]`,
		description: "Returns all registered schemas as a readonly array.",
		docsPath: "/docs/core/interfaces#getallschemas",
	},

	// ─── Plugin system ─────────────────────────────────────────────────────────

	getPlugin: {
		signature: `getPlugin<T extends ForjaPlugin>(\n  name: string,\n): T | null`,
		description: "Returns the plugin instance by name, or null if not found.",
		docsPath: "/docs/core/interfaces#getplugin",
	},

	getPlugins: {
		signature: `getPlugins(): readonly ForjaPlugin[]`,
		description: "Returns all registered plugin instances.",
		docsPath: "/docs/core/interfaces#getplugins",
	},

	hasPlugin: {
		signature: `hasPlugin(\n  name: string,\n): boolean`,
		description: "Returns true if a plugin with the given name is registered.",
		docsPath: "/docs/core/interfaces#hasplugin",
	},

	// ─── Lifecycle ─────────────────────────────────────────────────────────────

	isInitialized: {
		signature: `isInitialized(): boolean`,
		description:
			"Returns true if forja has been initialized. Safe to call before initialization.",
		docsPath: "/docs/core/interfaces#isinitialized",
	},

	getConfig: {
		signature: `getConfig(): ForjaConfig`,
		description:
			"Returns the active configuration object. Throws if called before initialization.",
		docsPath: "/docs/core/interfaces#getconfig",
	},

	getAdapter: {
		signature: `getAdapter<T extends DatabaseAdapter>(): T`,
		description: "Returns the active adapter instance.",
		docsPath: "/docs/core/interfaces#getadapter",
	},

	shutdown: {
		signature: `shutdown(): Promise<void>`,
		description:
			"Destroys all plugins, closes the database connection, and resets the instance.",
		docsPath: "/docs/core/interfaces#shutdown",
	},

	// ─── CLI internals ─────────────────────────────────────────────────────────

	beginMigrate: {
		signature: `beginMigrate(): Promise<MigrationSession>`,
		description:
			"Used internally by the Forja CLI. Compares current schemas against the live database and returns a MigrationSession.",
		docsPath: "/docs/core/interfaces#beginmigrate",
	},

	// ─── Top-level ─────────────────────────────────────────────────────────────

	defineConfig: {
		signature: `defineConfig(\n  factory: () => ForjaConfig,\n): () => Promise<Forja>`,
		description:
			"Define Forja configuration. Returns a function that when called, returns an initialized Forja instance.",
		//	docsPath: "/docs/core/getting-started#defineconfig",
	},

	defineSchema: {
		signature: `defineSchema(\n  definition: SchemaDefinition,\n): SchemaDefinition`,
		description:
			"Define a schema. Pass the result to schemas[] in defineConfig().",
		docsPath: "/docs/core/schema#defineschema",
	},

	// ─── API Plugin ─────────────────────────────────────────────────────────────

	ApiPlugin: {
		signature: `new ApiPlugin<TRole extends string = string>(\n  options: ApiConfig<TRole>,\n)`,
		description:
			"Turns any Forja instance into a fully-featured REST API. Auto-generates CRUD routes for every schema, handles authentication, and optionally manages file uploads.",
	},

	// ─── Upload ─────────────────────────────────────────────────────────────────

	Upload: {
		signature: `new Upload<TResolutions extends string = string>(\n  options: UploadOptions<TResolutions>,\n)`,
		description:
			"File upload handler. Pass an instance to ApiPlugin via the upload option. Injects a media schema and exposes /upload endpoints automatically.",
	},

	LocalStorageProvider: {
		signature: `new LocalStorageProvider(options: {\n  basePath: string,          // directory to write files into\n  baseUrl: string,           // public URL prefix\n  ensureDirectory?: boolean, // create basePath if missing — default: true\n})`,
		description: "Stores files on the local filesystem.",
	},

	S3StorageProvider: {
		signature: `new S3StorageProvider(options: {\n  bucket: string,\n  region: string,\n  accessKeyId: string,\n  secretAccessKey: string,\n  endpoint?: string,   // custom endpoint for R2 / MinIO\n  pathPrefix?: string, // optional key prefix\n})`,
		description:
			"Stores files in any S3-compatible object storage (AWS S3, R2, MinIO, etc.).",
	},

	// ─── Query serializer ────────────────────────────────────────────────────────

	queryToParams: {
		signature: `queryToParams<T extends ForjaEntry = ForjaRecord>(\n  query: ParsedQuery<T> | undefined,\n): string`,
		description:
			"Serializes a typed ParsedQuery object into a URL query string. Fully typed — accepts the same shape the server parses, keeping client and server query shapes in sync.",
	},

	serializeQuery: {
		signature: `serializeQuery<T extends ForjaEntry = ForjaEntry>(\n  query: ParsedQuery<T>,\n): RawQueryParams`,
		description:
			"Converts a ParsedQuery object into RawQueryParams (Strapi-style key/value pairs). Use queryToParams if you need a ready-to-use query string.",
	},
};
