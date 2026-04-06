/**
 * Type definitions for hover tooltips in docs.
 * Each key is a type name (with or without generics), value is the popup content.
 */

export interface TypeDefinition {
	signature: string;
	description?: string;
	/** Link to the full docs page, e.g. "/docs/core/types#whereclause" */
	/** Group name shown as a section heading in TypesReference, e.g. "Schema" */
	group?: string;
	/** If true, this entry is only used for hover tooltips and won't appear in TypesReference */
	skipDocs?: boolean;
}

export const TYPE_DEFINITIONS: Record<string, TypeDefinition> = {
	// ─── Primitives — tooltip only ───────────────────────────────────────────────
	string: {
		signature: "string",
		description: "A JavaScript string value.",
		skipDocs: true,
	},
	number: {
		signature: "number",
		description: "A JavaScript number value (integer or float).",
		skipDocs: true,
	},
	boolean: {
		signature: "boolean",
		description: "true or false.",
		skipDocs: true,
	},
	Date: {
		signature: "Date",
		description: "A JavaScript Date object.",
		skipDocs: true,
	},

	// ─── Core ─────────────────────────────────────────────────────────────────────
	DatrixEntry: {
		group: "Core",
		signature: `interface DatrixEntry {\n  id:        number\n  createdAt: Date\n  updatedAt: Date\n}`,
		description:
			"Base type every record extends. Fields are injected automatically and cannot be written manually.",
	},
	IDatrix: {
		group: "Core",
		signature: `interface IDatrix extends IRawCrud {\n  // CRUD (with plugin hooks) — same as IRawCrud methods\n  findOne(model, where, options?):          Promise<T | null>\n  findById(model, id, options?):            Promise<T | null>\n  findMany(model, options?):               Promise<T[]>\n  count(model, where?):                    Promise<number>\n  create(model, data, options?):           Promise<T>\n  createMany(model, data[], options?):     Promise<T[]>\n  update(model, id, data, options?):       Promise<T>\n  updateMany(model, where, data, options?): Promise<T[]>\n  delete(model, id, options?):             Promise<T>\n  deleteMany(model, where, options?):      Promise<T[]>\n\n  // Raw CRUD (bypasses plugin hooks)\n  readonly raw: IRawCrud\n\n  // Schema access\n  getSchemas():              ISchemaRegistry\n  getSchema(name):           SchemaDefinition | undefined\n  hasSchema(name):           boolean\n  getAllSchemas():            readonly SchemaDefinition[]\n\n  // Plugin access\n  getPlugins():              readonly DatrixPlugin[]\n  getPlugin(name):           DatrixPlugin | null\n  hasPlugin(name):           boolean\n\n  // Lifecycle\n  isInitialized():           boolean\n  getConfig():               DatrixConfig\n  getAdapter<T>():           T\n  shutdown():                Promise<void>\n}`,
		description:
			"Main Datrix instance interface. Returned by the function created with defineConfig(). All CRUD methods run through plugin hooks — use .raw for direct database access without hooks.",
	},

	RawCrudOptions: {
		group: "Core",
		signature: `interface RawCrudOptions<T> {\n  select?:      SelectClause<T>\n  populate?:    PopulateClause<T>\n  noReturning?: boolean\n}`,
		description:
			"Options for single-record operations (findOne, findById, create, update, delete).",
	},
	RawFindManyOptions: {
		group: "Core",
		signature: `interface RawFindManyOptions<T> extends RawCrudOptions<T> {\n  where?:   WhereClause<T>\n  orderBy?: OrderByClause<T>\n  limit?:   number\n  offset?:  number\n}`,
		description:
			"Options for findMany. Extends RawCrudOptions with filtering and pagination.",
	},
	FallbackInput: {
		group: "Core",
		signature: `type FallbackInput = {\n  [key: string]: string | number | boolean | Date | null | AnyRelationInput\n}`,
		description:
			"Default input type when no generic is provided. Allows any scalar or relation value.",
		skipDocs: true,
	},

	// ─── Query ────────────────────────────────────────────────────────────────────
	WhereClause: {
		group: "Query",
		signature: `type WhereClause<T> =\n  | { [K in keyof T]?: ComparisonOperators<T[K]> | T[K] }\n  | { $and: WhereClause<T>[] }\n  | { $or:  WhereClause<T>[] }\n  | { $not: WhereClause<T> }`,
		description:
			"Filter expression. Supports direct values, comparison operators ($eq, $gt, $in…), logical operators ($and, $or, $not), and nested relation conditions.",
	},
	ComparisonOperators: {
		group: "Query",
		signature: `type ComparisonOperators<T> = {\n  $eq?:         T\n  $ne?:         T\n  $gt?:         T        // number | Date only\n  $gte?:        T        // number | Date only\n  $lt?:         T        // number | Date only\n  $lte?:        T        // number | Date only\n  $in?:         T[]\n  $nin?:        T[]\n  $like?:       string   // string only\n  $ilike?:      string   // string only\n  $startsWith?: string   // string only\n  $endsWith?:   string   // string only\n  $contains?:   string   // string only\n  $exists?:     boolean\n  $null?:       boolean\n  $notNull?:    boolean\n}`,
		description:
			"Field-level comparison operators for WhereClause. Operators are type-aware — $gt/$lt are only valid for number/Date fields, $like/$contains only for strings.",
		skipDocs: true,
	},
	SelectClause: {
		group: "Query",
		signature: `type SelectClause<T> =\n  | (keyof T)[]\n  | keyof T\n  | "*"`,
		description:
			'Fields to return. Use "*" for all fields. Relation fields cannot appear here — use populate instead.',
	},
	PopulateClause: {
		group: "Query",
		signature: `type PopulateClause<T> =\n  | true\n  | "*"\n  | string[]\n  | { [relation: string]: true | PopulateOptions }`,
		description:
			'Relations to load alongside the main record. Supports true, "*", array of names, or object with per-relation options.',
	},
	PopulateOptions: {
		group: "Query",
		signature: `type PopulateOptions<T> = {\n  select?:   SelectClause<T>\n  where?:    WhereClause<T>\n  populate?: PopulateClause<T>\n  limit?:    number\n  offset?:   number\n  orderBy?:  OrderByClause<T>\n}`,
		description:
			"Per-relation populate options. Used as the value in an object-form PopulateClause.",
	},
	OrderByClause: {
		group: "Query",
		signature: `type OrderByClause<T> =\n  | { field: keyof T; direction: "asc" | "desc"; nulls?: "first" | "last" }[]\n  | { [K in keyof T]?: "asc" | "desc" }\n  | string[]`,
		description:
			'Sort order. Three formats: full object array, shorthand object, or string array ("-field" for desc).',
	},

	// ─── Schema ───────────────────────────────────────────────────────────────────
	SchemaDefinition: {
		group: "Schema",
		signature: `interface SchemaDefinition {\n  name:        string\n  fields:      Record<string, FieldDefinition>\n  indexes?:    IndexDefinition[]\n  hooks?:      LifecycleHooks\n  timestamps?: boolean\n  softDelete?: boolean\n  tableName?:  string\n  permission?: SchemaPermission\n}`,
		description:
			"Defines a database table's structure, constraints, and access rules. Pass the result of defineSchema() to schemas[] in defineConfig().",
	},
	FieldDefinition: {
		group: "Schema",
		signature: `type FieldDefinition =\n  | StringField\n  | NumberField\n  | BooleanField\n  | DateField\n  | JsonField\n  | EnumField\n  | ArrayField\n  | RelationField\n  | FileField`,
		description:
			"Discriminated union of all field type interfaces. The type property on each determines which options are available.",
	},
	StringField: {
		group: "Schema",
		signature: `interface StringField {\n  type:          "string"\n  required?:     boolean\n  default?:      string\n  unique?:       boolean\n  minLength?:    number\n  maxLength?:    number\n  pattern?:      RegExp\n  validator?:    (value: string) => true | string\n  errorMessage?: string\n  description?:  string\n  permission?:   FieldPermission\n}`,
		description:
			"String field definition. Use minLength/maxLength for length constraints, pattern for regex validation, validator for custom logic.",
	},
	NumberField: {
		group: "Schema",
		signature: `interface NumberField {\n  type:           "number"\n  required?:      boolean\n  default?:       number\n  unique?:        boolean\n  min?:           number\n  max?:           number\n  integer?:       boolean\n  autoIncrement?: boolean\n  validator?:     (value: number) => true | string\n  description?:   string\n  permission?:    FieldPermission\n}`,
		description:
			"Number field definition. Set integer: true to disallow decimals. autoIncrement is typically only used for the primary key.",
	},
	BooleanField: {
		group: "Schema",
		signature: `interface BooleanField {\n  type:         "boolean"\n  required?:    boolean\n  default?:     boolean\n  description?: string\n  permission?:  FieldPermission\n}`,
		description: "Boolean field definition.",
	},
	DateField: {
		group: "Schema",
		signature: `interface DateField {\n  type:         "date"\n  required?:    boolean\n  default?:     Date\n  min?:         Date\n  max?:         Date\n  description?: string\n  permission?:  FieldPermission\n}`,
		description: "Date field definition.",
	},
	JsonField: {
		group: "Schema",
		signature: `interface JsonField {\n  type:         "json"\n  required?:    boolean\n  default?:     Record<string, unknown>\n  schema?:      Record<string, unknown>  // JSON schema validation\n  description?: string\n  permission?:  FieldPermission\n}`,
		description:
			"JSON field definition. Stored as a JSON column. Optionally validated against a JSON schema.",
	},
	EnumField: {
		group: "Schema",
		signature: `interface EnumField {\n  type:         "enum"\n  required?:    boolean\n  default?:     string\n  values:       readonly string[]  // allowed values\n  description?: string\n  permission?:  FieldPermission\n}`,
		description:
			"Enum field definition. values defines the complete set of allowed string literals.",
	},
	ArrayField: {
		group: "Schema",
		signature: `interface ArrayField {\n  type:         "array"\n  required?:    boolean\n  items:        FieldDefinition  // type of each element\n  minItems?:    number\n  maxItems?:    number\n  unique?:      boolean          // all items must be unique\n  description?: string\n  permission?:  FieldPermission\n}`,
		description:
			"Array field definition. items defines the type of each element — can be any FieldDefinition including nested objects.",
	},
	RelationField: {
		group: "Schema",
		signature: `interface RelationField {\n  type:        "relation"\n  required?:   boolean\n  model:       string      // target schema name\n  kind:        RelationKind\n  foreignKey?: string      // defaults to fieldName + "Id"\n  through?:    string      // join table for manyToMany\n  onDelete?:   "cascade" | "setNull" | "restrict"\n  onUpdate?:   "cascade" | "restrict"\n  description?: string\n  permission?:  FieldPermission\n}`,
		description:
			"Relation field definition. kind determines the cardinality. For manyToMany, a junction table is auto-generated if through is omitted.",
	},
	RelationKind: {
		group: "Schema",
		signature: `type RelationKind =\n  | "hasOne"     // 1:1  — this model owns the FK on the other side\n  | "hasMany"    // 1:N  — other model holds the FK\n  | "belongsTo"  // N:1  — this model holds the FK\n  | "manyToMany" // N:N  — junction table`,
		description: "Defines the cardinality of a relation field.",
	},
	FileField: {
		group: "Schema",
		signature: `interface FileField {\n  type:          "file"\n  required?:     boolean\n  allowedTypes?: string[]  // MIME types, e.g. ["image/png"]\n  maxSize?:      number    // bytes\n  multiple?:     boolean\n  description?:  string\n  permission?:   FieldPermission\n}`,
		description:
			"File field definition. Requires the upload plugin to be configured.",
	},
	IndexDefinition: {
		group: "Schema",
		signature: `interface IndexDefinition {\n  name?:   string\n  fields:  readonly string[]\n  unique?: boolean\n  type?:   "btree" | "hash" | "gist" | "gin"\n}`,
		description:
			"Defines a database index on one or more fields. Pass to indexes[] in SchemaDefinition.",
	},
	LifecycleHooks: {
		group: "Schema",
		signature: `interface LifecycleHooks<T extends DatrixEntry = DatrixEntry> {\n  beforeCreate?: (\n    query: QueryInsertObject<T>,\n    ctx: QueryContext,\n  ) => Promise<QueryInsertObject<T>> | QueryInsertObject<T>\n\n  afterCreate?: (\n    records: readonly T[],\n    ctx: QueryContext,\n  ) => Promise<readonly T[]> | readonly T[]\n\n  beforeUpdate?: (\n    query: QueryUpdateObject<T>,\n    ctx: QueryContext,\n  ) => Promise<QueryUpdateObject<T>> | QueryUpdateObject<T>\n\n  afterUpdate?: (\n    records: readonly T[],\n    ctx: QueryContext,\n  ) => Promise<readonly T[]> | readonly T[]\n\n  beforeDelete?: (\n    query: QueryDeleteObject<T>,\n    ctx: QueryContext,\n  ) => Promise<QueryDeleteObject<T>> | QueryDeleteObject<T>\n\n  afterDelete?: (\n    records: readonly T[],\n    ctx: QueryContext,\n  ) => Promise<void> | void\n\n  beforeFind?: (\n    query: QuerySelectObject<T>,\n    ctx: QueryContext,\n  ) => Promise<QuerySelectObject<T>> | QuerySelectObject<T>\n\n  afterFind?: (\n    records: readonly T[],\n    ctx: QueryContext,\n  ) => Promise<readonly T[]> | readonly T[]\n}`,
		description:
			"Schema lifecycle hooks. Defined in the hooks field of SchemaDefinition. Before hooks receive the full query object and must return it. After hooks receive all affected records as an array. ctx.datrix gives access to the Datrix instance for additional queries.",
	},

	// ─── Permissions ──────────────────────────────────────────────────────────────
	SchemaPermission: {
		group: "Permissions",
		signature: `interface SchemaPermission {\n  create?: PermissionValue\n  read?:   PermissionValue\n  update?: PermissionValue\n  delete?: PermissionValue\n}`,
		description:
			"Schema-level access control. Each action accepts true, false, a role array, a function, or a mixed array of roles and functions. \nNOTE: Only enforced when using the @datrix/api package.",
	},
	FieldPermission: {
		group: "Permissions",
		signature: `interface FieldPermission {\n  read?:  PermissionValue\n  write?: PermissionValue\n}`,
		description:
			"Field-level access control. read: if denied, field is stripped from the response. write: if denied, returns 403. \nNOTE: Only enforced when using the @datrix/api package.",
	},
	PermissionValue: {
		group: "Permissions",
		signature: `type PermissionValue =\n  | boolean\n  | readonly string[]                    // role names\n  | PermissionFn                         // (ctx) => boolean\n  | readonly (string | PermissionFn)[]   // role OR function (OR logic)`,
		description:
			"Defines who can perform an action. true = everyone, false = nobody, string array = specific roles, function = custom logic. \nNOTE: Only enforced when using the @datrix/api package.",
	},
	PermissionFn: {
		group: "Permissions",
		signature: `type PermissionFn = (ctx: PermissionContext) => boolean | Promise<boolean>`,
		description:
			"Custom permission function. Receives the full request context and returns true to allow, false to deny. \nNOTE: Only enforced when using the @datrix/api package.",
	},
	PermissionContext: {
		group: "Permissions",
		signature: `interface PermissionContext {\n  readonly user:    AuthUser | undefined\n  readonly action:  PermissionAction\n  readonly record?: DatrixEntry        // existing record (update/delete)\n  readonly input?:  Partial<DatrixEntry> // incoming data (create/update)\n  readonly id?:     number | null\n}`,
		description:
			"Context passed to permission functions. user is undefined for unauthenticated requests.",
	},

	// ─── Adapter ──────────────────────────────────────────────────────────────────
	DatabaseAdapter: {
		group: "Adapter",
		signature: `interface DatabaseAdapter<TConfig = object> {\n  readonly name:   string\n  readonly config: TConfig\n  connect():                    Promise<void>\n  disconnect():                 Promise<void>\n  isConnected():                boolean\n  beginTransaction():           Promise<Transaction>\n  getTables():                  Promise<readonly string[]>\n  tableExists(name: string):    Promise<boolean>\n  executeQuery(query):          Promise<QueryResult>\n  createTable(schema):          Promise<void>\n  dropTable(name):              Promise<void>\n  alterTable(name, ops):        Promise<void>\n}`,
		description:
			"Interface all database adapters must implement. Passed as adapter in defineConfig().",
	},
	Transaction: {
		group: "Adapter",
		signature: `interface Transaction {\n  readonly id: string\n  commit():               Promise<void>\n  rollback():             Promise<void>\n  savepoint(name):        Promise<void>\n  rollbackTo(name):       Promise<void>\n  release(name):          Promise<void>\n  executeQuery(query):    Promise<QueryResult>\n  executeRawQuery(sql):   Promise<QueryResult>\n  createTable(schema):    Promise<void>\n  dropTable(name):        Promise<void>\n  alterTable(name, ops):  Promise<void>\n}`,
		description:
			"Wraps a database transaction. Supports query execution and schema operations atomically. Returned by DatabaseAdapter.beginTransaction().",
	},

	// ─── Plugin ───────────────────────────────────────────────────────────────────
	DatrixPlugin: {
		group: "Plugin",
		signature: `interface DatrixPlugin<TOptions = Record<string, unknown>> {\n  readonly name:    string\n  readonly version: string\n  readonly options: TOptions\n  init(context: PluginContext):                          Promise<void>\n  destroy():                                            Promise<void>\n  getSchemas?():                                        Promise<SchemaDefinition[]>\n  extendSchemas?(ctx: SchemaExtensionContext):           Promise<SchemaExtension[]>\n  onBeforeQuery?<T>(query: QueryObject<T>, ctx: QueryContext): Promise<QueryObject<T>>\n  onAfterQuery?<T>(result: T, ctx: QueryContext):        Promise<T>\n}`,
		description: "Interface all Datrix plugins must implement.",
	},
	PluginContext: {
		group: "Plugin",
		signature: `interface PluginContext {\n  readonly adapter: DatabaseAdapter\n  readonly schemas: SchemaRegistry\n  readonly config:  DatrixConfig\n}`,
		description:
			"Context provided to a plugin's init() method. Gives access to the adapter, schema registry, and configuration.",
	},
	QueryContext: {
		group: "Plugin",
		signature: `interface QueryContext {\n  readonly action:   QueryAction\n  readonly datrix:    IDatrix\n  readonly metadata: Record<string, unknown>\n  user?:             AuthUser\n}`,
		description:
			"Context passed to plugin hooks and schema lifecycle hooks. Gives access to the current action, the Datrix instance, shared metadata, and the authenticated user.",
	},
	SchemaExtensionContext: {
		group: "Plugin",
		signature: `interface SchemaExtensionContext {\n  readonly schemas:  readonly SchemaDefinition[]\n  extendAll(modifier):                         SchemaExtension[]\n  extendWhere(predicate, modifier):            SchemaExtension[]\n  extendByPattern(pattern, modifier):          SchemaExtension[]\n}`,
		description:
			"Context passed to a plugin's extendSchemas() hook. Provides helpers to extend all or a subset of schemas.",
	},
	SchemaExtension: {
		group: "Plugin",
		signature: `interface SchemaExtension {\n  readonly targetSchema:   string\n  readonly fields?:        Record<string, FieldDefinition>\n  readonly removeFields?:  string[]\n  readonly modifyFields?:  Record<string, Partial<FieldDefinition>>\n  readonly indexes?:       IndexDefinition[]\n}`,
		description:
			"Describes fields and indexes to add, remove, or modify on an existing schema. Returned from extendSchemas().",
	},

	QueryInsertObject: {
		group: "Plugin",
		signature: `interface QueryInsertObject<T> {\n  type:   "insert"\n  table:  string\n  data:   Partial<T>[]\n}`,
		description:
			"Query object passed to beforeCreate hooks. data contains the array of records to be inserted — modify it to change what gets written.",
		skipDocs: true,
	},
	QueryUpdateObject: {
		group: "Plugin",
		signature: `interface QueryUpdateObject<T> {\n  type:   "update"\n  table:  string\n  data:   Partial<T>\n  where?: WhereClause<T>\n}`,
		description:
			"Query object passed to beforeUpdate hooks. data contains the fields to update — modify it to change what gets written.",
		skipDocs: true,
	},
	QueryDeleteObject: {
		group: "Plugin",
		signature: `interface QueryDeleteObject<T> {\n  type:   "delete"\n  table:  string\n  where?: WhereClause<T>\n}`,
		description:
			"Query object passed to beforeDelete hooks. where determines which records are deleted — modify it to restrict or redirect the delete.",
		skipDocs: true,
	},
	QuerySelectObject: {
		group: "Plugin",
		signature: `interface QuerySelectObject<T> {\n  type:     "select"\n  table:    string\n  where?:   WhereClause<T>\n  select?:  SelectClause<T>\n  orderBy?: OrderByClause<T>\n  limit?:   number\n  offset?:  number\n}`,
		description:
			"Query object passed to beforeFind hooks. Modify where, limit, offset, or orderBy to control which records are returned.",
		skipDocs: true,
	},

	QueryAction: {
		group: "Plugin",
		signature: `type QueryAction =\n  | "findOne"\n  | "findMany"\n  | "count"\n  | "create"\n  | "createMany"\n  | "update"\n  | "updateMany"\n  | "delete"\n  | "deleteMany"`,
		description:
			"The CRUD operation being performed. Available in QueryContext inside plugin hooks.",
		skipDocs: true,
	},

	// ─── Schema registry ──────────────────────────────────────────────────────────
	SchemaRegistry: {
		group: "Schema registry",
		signature: `class SchemaRegistry {\n  get(name: string):    SchemaDefinition | undefined\n  has(name: string):    boolean\n  getAll():             readonly SchemaDefinition[]\n  getNames():           readonly string[]\n  readonly size:        number\n}`,
		description:
			"Registry that holds all registered schemas. Returned by getSchemas().",
	},

	// ─── Migration ────────────────────────────────────────────────────────────────
	MigrationSession: {
		group: "Migration",
		signature: `class MigrationSession {\n  tablesToCreate:  readonly SchemaDefinition[]\n  ambiguous:       readonly AmbiguousChange[]\n  hasAmbiguous:    boolean\n  resolveAmbiguous(id: string, action: AmbiguousActionType): void\n  getPlan():       MigrationPlan\n  apply():         Promise<readonly MigrationExecutionResult[]>\n}`,
		description:
			"Returned by beginMigrate(). Represents a diff session between current schemas and database state.",
	},
	AmbiguousChange: {
		group: "Migration",
		signature: `interface AmbiguousChange {\n  readonly id:          string   // e.g. "user.name->lastname"\n  readonly description: string\n  readonly options:     readonly AmbiguousActionType[]\n}`,
		description:
			"A schema change that Datrix cannot resolve automatically — typically a field rename vs. drop+add. Must be resolved with MigrationSession.resolveAmbiguous() before applying.",
	},
	AmbiguousActionType: {
		group: "Migration",
		signature: `type AmbiguousActionType =\n  | "rename"  // treat as a rename operation\n  | "drop"    // drop the old field and add the new one`,
		description:
			"Resolution for an ambiguous schema change. Passed to MigrationSession.resolveAmbiguous().",
	},
	AlterOperation: {
		group: "Migration",
		signature: `type AlterOperation =\n  | { type: "addColumn";     column: string; definition: FieldDefinition }\n  | { type: "dropColumn";    column: string }\n  | { type: "modifyColumn";  column: string; newDefinition: FieldDefinition }\n  | { type: "renameColumn";  from: string; to: string }\n  | { type: "addMetaField";  field: string; definition: FieldDefinition }\n  | { type: "dropMetaField"; field: string }\n  | { type: "modifyMetaField"; field: string; newDefinition: FieldDefinition }`,
		description:
			"Discriminated union of column-level DDL operations used in alterTable(). MetaField variants are for internal Datrix-managed columns.",
	},
	Migration: {
		group: "Migration",
		signature: `interface Migration {\n  readonly metadata:   MigrationMetadata\n  readonly operations: readonly MigrationOperation[]\n}`,
		description:
			"A single migration unit — metadata plus the list of DDL operations to execute.",
	},
	MigrationMetadata: {
		group: "Migration",
		signature: `interface MigrationMetadata {\n  readonly name:         string\n  readonly version:      string\n  readonly timestamp:    number\n  readonly description?: string\n  readonly author?:      string\n}`,
		description:
			"Descriptive metadata attached to a migration. version is used to track which migrations have been applied.",
	},
	MigrationOperation: {
		group: "Migration",
		signature: `type MigrationOperation =\n  | { type: "createTable";  schema: SchemaDefinition }\n  | { type: "dropTable";    tableName: string }\n  | { type: "alterTable";   tableName: string; operations: AlterOperation[] }\n  | { type: "createIndex";  tableName: string; index: IndexDefinition }\n  | { type: "dropIndex";    tableName: string; indexName: string }\n  | { type: "renameTable";  from: string; to: string }\n  | { type: "raw";          sql: string; params?: unknown[] }\n  | { type: "dataTransfer"; description: string }`,
		description:
			"Discriminated union of all DDL operations a migration can contain.",
	},
	MigrationStatus: {
		group: "Migration",
		signature: `type MigrationStatus =\n  | "pending"\n  | "running"\n  | "completed"\n  | "failed"`,
		description: "Execution state of a migration.",
	},
	MigrationPlan: {
		group: "Migration",
		signature: `interface MigrationPlan {\n  readonly migrations: readonly Migration[]\n  readonly target?:    string\n}`,
		description:
			"The list of migrations to execute, as returned by MigrationSession.getPlan(). target is undefined when targeting the latest version.",
	},
	MigrationExecutionResult: {
		group: "Migration",
		signature: `interface MigrationExecutionResult {\n  readonly migration:     Migration\n  readonly status:        MigrationStatus\n  readonly executionTime: number\n  readonly error?:        Error\n  readonly warnings?:     string[]\n}`,
		description:
			"Result of a single migration execution. status is one of 'pending' | 'running' | 'completed' | 'failed'.",
	},

	// ─── Config ───────────────────────────────────────────────────────────────────
	DatrixConfig: {
		group: "Config",
		signature: `interface DatrixConfig {\n  adapter:    DatabaseAdapter\n  schemas:    SchemaDefinition[]\n  plugins?:   DatrixPlugin[]\n  migration?: MigrationConfig\n  dev?:       DevConfig\n}`,
		description: "Top-level configuration object passed to defineConfig().",
	},
	MigrationConfig: {
		group: "Config",
		signature: `interface MigrationConfig {\n  auto?:      boolean  // run migrations on startup\n  directory?: string   // default: "./migrations"\n  modelName?: string   // tracking table name\n}`,
		description:
			"Controls migration behavior. auto defaults to false in production.",
	},
	DevConfig: {
		group: "Config",
		signature: `interface DevConfig {\n  logging?:         boolean  // detailed query logging\n  validateQueries?: boolean  // validate queries before execution\n  prettyErrors?:    boolean  // pretty-print errors with stack traces\n}`,
		description:
			"Development mode options. All options default to false in production.",
	},

	// ─── API ──────────────────────────────────────────────────────────────────────
	ApiConfig: {
		group: "API",
		signature: `interface ApiConfig<TRole extends string = string> {\n  prefix?:           string       // route prefix — default: '/api'\n  defaultPageSize?:  number       // default: 25\n  maxPageSize?:      number       // default: 100\n  maxPopulateDepth?: number       // default: 5\n  autoRoutes?:       boolean      // auto-generate CRUD routes — default: true\n  excludeSchemas?:   string[]     // schemas to exclude from auto-routes\n  auth?:             AuthConfig<TRole>\n  upload?:           IUpload\n}`,
		description: "Configuration for ApiPlugin. Pass to new ApiPlugin({ ... }).",
	},
	AuthConfig: {
		group: "API",
		signature: `interface AuthConfig<TRole extends string = string> {\n  roles:              readonly TRole[]\n  defaultRole:        TRole\n  defaultPermission?: SchemaPermission\n  jwt?:               JwtConfig\n  session?:           SessionConfig\n  password?:          PasswordConfig\n  authSchemaName?:    string  // default: 'authentication'\n  userSchema?: {\n    name?:  string  // default: 'user'\n    email?: string  // default: 'email'\n  }\n  endpoints?: {\n    login?:           string   // default: '/auth/login'\n    register?:        string   // default: '/auth/register'\n    logout?:          string   // default: '/auth/logout'\n    me?:              string   // default: '/auth/me'\n    disableRegister?: boolean  // default: false\n  }\n}`,
		description:
			"Authentication configuration block inside ApiConfig. Enables JWT and/or session auth, RBAC roles, and password policy.",
	},
	JwtConfig: {
		group: "API",
		signature: `interface JwtConfig {\n  secret:     string                    // min 32 characters\n  expiresIn?: string | number           // e.g. \"7d\", \"1h\" or seconds\n  algorithm?: \"HS256\" | \"HS512\"        // default: \"HS256\"\n  issuer?:    string                    // JWT iss claim\n  audience?:  string                    // JWT aud claim\n}`,
		description: "JWT signing options inside AuthConfig.",
	},
	SessionConfig: {
		group: "API",
		signature: `interface SessionConfig {\n  store?:       \"memory\" | SessionStore  // default: \"memory\"\n  maxAge?:      number  // session lifetime in seconds — default: 86400\n  checkPeriod?: number  // expired session cleanup interval — default: 3600\n  prefix?:      string  // session key prefix for memory store — default: \"sess:\"\n}`,
		description:
			"Session storage options inside AuthConfig. Pass a custom SessionStore instance for Redis, database, or any other backend.",
	},
	PasswordConfig: {
		group: "API",
		signature: `interface PasswordConfig {\n  iterations?: number  // PBKDF2 iterations — default: 100000\n  keyLength?:  number  // derived key length in bytes — default: 64\n  minLength?:  number  // minimum password length — default: 8\n}`,
		description: "Password hashing policy inside AuthConfig.",
	},
	SessionStore: {
		group: "API",
		signature: `interface SessionStore {\n  get(sessionId: string):                    Promise<SessionData | undefined>\n  set(sessionId: string, data: SessionData): Promise<void>\n  delete(sessionId: string):                 Promise<void>\n  cleanup():                                 Promise<number>\n  clear():                                   Promise<void>\n}`,
		description:
			"Interface for custom session backends. Implement this to use Redis, a database, or any other storage instead of the default in-memory store.",
	},
	SessionData: {
		group: "API",
		skipDocs: true,
		signature: `interface SessionData {\n  readonly id:             string\n  readonly userId:         number\n  readonly role:           string\n  readonly createdAt:      Date\n  readonly expiresAt:      Date\n  readonly lastAccessedAt: Date\n}`,
		description: "Shape of a session record stored by SessionStore.",
	},
	ParsedQuery: {
		group: "API",
		signature: `interface ParsedQuery<T extends DatrixEntry = DatrixRecord> {\n  select?:   SelectClause<T>\n  where?:    WhereClause<T>\n  populate?: PopulateClause<T>\n  orderBy?:  OrderByClause<T>\n  page?:     number\n  pageSize?: number\n}`,
		description:
			"Typed query object accepted by queryToParams and parsed by the server. Client and server share the same shape.",
	},

	// ─── Upload ───────────────────────────────────────────────────────────────────
	UploadOptions: {
		group: "Upload",
		signature: `interface UploadOptions<TResolutions extends string = string> {\n  provider:           StorageProvider\n  modelName?:         string            // default: \"media\"\n  maxSize?:           number            // max file size in bytes\n  allowedMimeTypes?:  string[]          // supports wildcards, e.g. \"image/*\"\n  format?:            ImageFormat       // convert all images to this format\n  quality?:           number            // 1–100 — default: 80\n  resolutions?:       Record<TResolutions, ResolutionConfig>\n  permission?:        SchemaPermission\n}`,
		description:
			"Options passed to new Upload({ ... }). Controls storage, validation, format conversion, and resolution variants.",
	},
	ImageFormat: {
		group: "Upload",
		signature: `type ImageFormat = \"webp\" | \"jpeg\" | \"png\" | \"avif\"`,
		description:
			"Target format for image conversion. All uploaded images are converted to this format before storage.",
	},
	ResolutionConfig: {
		group: "Upload",
		signature: `interface ResolutionConfig {\n  width:   number\n  height?: number   // omit to preserve aspect ratio\n  fit?:    ResizeFit\n}`,
		description:
			"Config for a single named resolution variant. height is optional — if omitted, aspect ratio is preserved.",
	},
	ResizeFit: {
		group: "Upload",
		signature: `type ResizeFit =\n  | \"cover\"    // crop to fill the box exactly\n  | \"contain\"  // fit within the box, letterbox if needed\n  | \"fill\"     // stretch to fill — ignores aspect ratio\n  | \"inside\"   // resize so both dimensions fit inside the box\n  | \"outside\"  // resize so one dimension fills the box`,
		description:
			"Sharp fit mode used when both width and height are set on a ResolutionConfig.",
	},
	LocalProviderOptions: {
		group: "Upload",
		signature: `interface LocalProviderOptions {\n  basePath:         string   // directory to write files into\n  baseUrl:          string   // public URL prefix\n  ensureDirectory?: boolean  // create basePath if missing — default: true\n}`,
		description: "Options for LocalStorageProvider.",
	},
	S3ProviderOptions: {
		group: "Upload",
		signature: `interface S3ProviderOptions {\n  bucket:          string\n  region:          string\n  accessKeyId:     string\n  secretAccessKey: string\n  endpoint?:       string  // custom endpoint for R2 / MinIO\n  pathPrefix?:     string  // optional key prefix\n}`,
		description:
			"Options for S3StorageProvider. Compatible with AWS S3, Cloudflare R2, MinIO, and any S3-compatible storage.",
	},
	StorageProvider: {
		group: "Upload",
		signature: `interface StorageProvider {\n  readonly name: string\n  upload(file: UploadFile):   Promise<UploadResult>\n  delete(key: string):        Promise<void>\n  getUrl(key: string):        string\n  exists(key: string):        Promise<boolean>\n}`,
		description:
			"Interface all storage backends must implement. Implement this to add a custom storage provider.",
	},
	MediaEntry: {
		group: "Upload",
		signature: `interface MediaEntry<TResolutions extends string = string> extends DatrixEntry {\n  filename:     string\n  originalName: string\n  mimeType:     string\n  size:         number\n  key:          string\n  url:          string  // injected at response time, not stored in DB\n  variants:     MediaVariants<TResolutions> | null\n}`,
		description:
			"Shape of a media record. key is stored in the database — url is derived at response time via the configured provider.",
	},
	MediaVariant: {
		group: "Upload",
		signature: `interface MediaVariant {\n  key:      string\n  url:      string  // injected at response time, not stored in DB\n  width:    number\n  height:   number\n  size:     number\n  mimeType: string\n}`,
		description:
			"A single processed resolution variant. Available in MediaEntry.variants under the resolution name.",
	},
};

/**
 * Normalize a type token to look up in TYPE_DEFINITIONS.
 * Strips generic parameters: "RawCrudOptions<T>" → "RawCrudOptions"
 */
export function normalizeTypeName(token: string): string {
	return token.replace(/<.*>/, "").trim();
}
