/**
 * Type definitions for hover tooltips in docs.
 * Each key is a type name (with or without generics), value is the popup content.
 */

export interface TypeDefinition {
	signature: string;
	description?: string;
	/** Link to the full docs page, e.g. "/docs/core/types#whereclause" */
	docsPath?: string;
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
	ForjaEntry: {
		group: "Core",
		signature: `interface ForjaEntry {\n  id:        number\n  createdAt: Date\n  updatedAt: Date\n}`,
		description:
			"Base type every record extends. Fields are injected automatically and cannot be written manually.",
		docsPath: "/docs/core/types#forjaentry",
	},
	RawCrudOptions: {
		group: "Core",
		signature: `interface RawCrudOptions<T> {\n  select?:   SelectClause<T>\n  populate?: PopulateClause<T>\n}`,
		description:
			"Options for single-record operations (findOne, findById, create, update, delete).",
		docsPath: "/docs/core/types#rawcrudoptions",
	},
	RawFindManyOptions: {
		group: "Core",
		signature: `interface RawFindManyOptions<T> extends RawCrudOptions<T> {\n  where?:   WhereClause<T>\n  orderBy?: OrderByClause<T>\n  limit?:   number\n  offset?:  number\n}`,
		description:
			"Options for findMany. Extends RawCrudOptions with filtering and pagination.",
		docsPath: "/docs/core/types#rawfindmanyoptions",
	},
	FallbackInput: {
		group: "Core",
		signature: `type FallbackInput = {\n  [key: string]: string | number | boolean | Date | null | AnyRelationInput\n}`,
		description:
			"Default input type when no generic is provided. Allows any scalar or relation value.",
		docsPath: "/docs/core/types#fallbackinput",
	},

	// ─── Query ────────────────────────────────────────────────────────────────────
	WhereClause: {
		group: "Query",
		signature: `type WhereClause<T> =\n  | { [K in keyof T]?: ComparisonOperators<T[K]> | T[K] }\n  | { $and: WhereClause<T>[] }\n  | { $or:  WhereClause<T>[] }\n  | { $not: WhereClause<T> }`,
		description:
			"Filter expression. Supports direct values, comparison operators ($eq, $gt, $in…), logical operators ($and, $or, $not), and nested relation conditions.",
		docsPath: "/docs/core/types#whereclause",
	},
	ComparisonOperators: {
		group: "Query",
		signature: `type ComparisonOperators<T> = {\n  $eq?:         T\n  $ne?:         T\n  $gt?:         T        // number | Date only\n  $gte?:        T        // number | Date only\n  $lt?:         T        // number | Date only\n  $lte?:        T        // number | Date only\n  $in?:         T[]\n  $nin?:        T[]\n  $like?:       string   // string only\n  $ilike?:      string   // string only\n  $startsWith?: string   // string only\n  $endsWith?:   string   // string only\n  $contains?:   string   // string only\n  $exists?:     boolean\n  $null?:       boolean\n  $notNull?:    boolean\n}`,
		description:
			"Field-level comparison operators for WhereClause. Operators are type-aware — $gt/$lt are only valid for number/Date fields, $like/$contains only for strings.",
		docsPath: "/docs/core/types#comparisonoperators",
	},
	SelectClause: {
		group: "Query",
		signature: `type SelectClause<T> =\n  | (keyof T)[]\n  | keyof T\n  | "*"`,
		description:
			'Fields to return. Use "*" for all fields. Relation fields cannot appear here — use populate instead.',
		docsPath: "/docs/core/types#selectclause",
	},
	PopulateClause: {
		group: "Query",
		signature: `type PopulateClause<T> =\n  | true\n  | "*"\n  | string[]\n  | { [relation: string]: true | PopulateOptions }`,
		description:
			'Relations to load alongside the main record. Supports true, "*", array of names, or object with per-relation options.',
		docsPath: "/docs/core/types#populateclause",
	},
	PopulateOptions: {
		group: "Query",
		signature: `type PopulateOptions<T> = {\n  select?:   SelectClause<T>\n  where?:    WhereClause<T>\n  populate?: PopulateClause<T>\n  limit?:    number\n  offset?:   number\n  orderBy?:  OrderByClause<T>\n}`,
		description:
			"Per-relation populate options. Used as the value in an object-form PopulateClause.",
		docsPath: "/docs/core/types#populateoptions",
	},
	OrderByClause: {
		group: "Query",
		signature: `type OrderByClause<T> =\n  | { field: keyof T; direction: "asc" | "desc"; nulls?: "first" | "last" }[]\n  | { [K in keyof T]?: "asc" | "desc" }\n  | string[]`,
		description:
			'Sort order. Three formats: full object array, shorthand object, or string array ("-field" for desc).',
		docsPath: "/docs/core/types#orderbyclause",
	},

	// ─── Schema ───────────────────────────────────────────────────────────────────
	SchemaDefinition: {
		group: "Schema",
		signature: `interface SchemaDefinition {\n  name:        string\n  fields:      Record<string, FieldDefinition>\n  indexes?:    IndexDefinition[]\n  hooks?:      LifecycleHooks\n  timestamps?: boolean\n  softDelete?: boolean\n  tableName?:  string\n  permission?: SchemaPermission\n}`,
		description:
			"Defines a database table's structure, constraints, and access rules. Pass the result of defineSchema() to schemas[] in defineConfig().",
		docsPath: "/docs/core/types#schemadefinition",
	},
	FieldDefinition: {
		group: "Schema",
		signature: `type FieldDefinition =\n  | StringField\n  | NumberField\n  | BooleanField\n  | DateField\n  | JsonField\n  | EnumField\n  | ArrayField\n  | RelationField\n  | FileField`,
		description:
			"Discriminated union of all field type interfaces. The type property on each determines which options are available.",
		docsPath: "/docs/core/types#fielddefinition",
	},
	StringField: {
		group: "Schema",
		signature: `interface StringField {\n  type:          "string"\n  required?:     boolean\n  default?:      string\n  unique?:       boolean\n  minLength?:    number\n  maxLength?:    number\n  pattern?:      RegExp\n  validator?:    (value: string) => true | string\n  errorMessage?: string\n  description?:  string\n  permission?:   FieldPermission\n}`,
		description:
			"String field definition. Use minLength/maxLength for length constraints, pattern for regex validation, validator for custom logic.",
		docsPath: "/docs/core/types#stringfield",
	},
	NumberField: {
		group: "Schema",
		signature: `interface NumberField {\n  type:           "number"\n  required?:      boolean\n  default?:       number\n  unique?:        boolean\n  min?:           number\n  max?:           number\n  integer?:       boolean\n  autoIncrement?: boolean\n  validator?:     (value: number) => true | string\n  description?:   string\n  permission?:    FieldPermission\n}`,
		description:
			"Number field definition. Set integer: true to disallow decimals. autoIncrement is typically only used for the primary key.",
		docsPath: "/docs/core/types#numberfield",
	},
	BooleanField: {
		group: "Schema",
		signature: `interface BooleanField {\n  type:         "boolean"\n  required?:    boolean\n  default?:     boolean\n  description?: string\n  permission?:  FieldPermission\n}`,
		description: "Boolean field definition.",
		docsPath: "/docs/core/types#booleanfield",
	},
	DateField: {
		group: "Schema",
		signature: `interface DateField {\n  type:         "date"\n  required?:    boolean\n  default?:     Date\n  min?:         Date\n  max?:         Date\n  description?: string\n  permission?:  FieldPermission\n}`,
		description: "Date field definition.",
		docsPath: "/docs/core/types#datefield",
	},
	JsonField: {
		group: "Schema",
		signature: `interface JsonField {\n  type:         "json"\n  required?:    boolean\n  default?:     Record<string, unknown>\n  schema?:      Record<string, unknown>  // JSON schema validation\n  description?: string\n  permission?:  FieldPermission\n}`,
		description:
			"JSON field definition. Stored as a JSON column. Optionally validated against a JSON schema.",
		docsPath: "/docs/core/types#jsonfield",
	},
	EnumField: {
		group: "Schema",
		signature: `interface EnumField {\n  type:         "enum"\n  required?:    boolean\n  default?:     string\n  values:       readonly string[]  // allowed values\n  description?: string\n  permission?:  FieldPermission\n}`,
		description:
			"Enum field definition. values defines the complete set of allowed string literals.",
		docsPath: "/docs/core/types#enumfield",
	},
	ArrayField: {
		group: "Schema",
		signature: `interface ArrayField {\n  type:         "array"\n  required?:    boolean\n  items:        FieldDefinition  // type of each element\n  minItems?:    number\n  maxItems?:    number\n  unique?:      boolean          // all items must be unique\n  description?: string\n  permission?:  FieldPermission\n}`,
		description:
			"Array field definition. items defines the type of each element — can be any FieldDefinition including nested objects.",
		docsPath: "/docs/core/types#arrayfield",
	},
	RelationField: {
		group: "Schema",
		signature: `interface RelationField {\n  type:        "relation"\n  required?:   boolean\n  model:       string      // target schema name\n  kind:        RelationKind\n  foreignKey?: string      // defaults to fieldName + "Id"\n  through?:    string      // join table for manyToMany\n  onDelete?:   "cascade" | "setNull" | "restrict"\n  onUpdate?:   "cascade" | "restrict"\n  description?: string\n  permission?:  FieldPermission\n}`,
		description:
			"Relation field definition. kind determines the cardinality. For manyToMany, a junction table is auto-generated if through is omitted.",
		docsPath: "/docs/core/types#relationfield",
	},
	RelationKind: {
		group: "Schema",
		signature: `type RelationKind =\n  | "hasOne"     // 1:1  — this model owns the FK on the other side\n  | "hasMany"    // 1:N  — other model holds the FK\n  | "belongsTo"  // N:1  — this model holds the FK\n  | "manyToMany" // N:N  — junction table`,
		description: "Defines the cardinality of a relation field.",
		docsPath: "/docs/core/types#relationkind",
	},
	FileField: {
		group: "Schema",
		signature: `interface FileField {\n  type:          "file"\n  required?:     boolean\n  allowedTypes?: string[]  // MIME types, e.g. ["image/png"]\n  maxSize?:      number    // bytes\n  multiple?:     boolean\n  description?:  string\n  permission?:   FieldPermission\n}`,
		description:
			"File field definition. Requires the upload plugin to be configured.",
		docsPath: "/docs/core/types#filefield",
	},
	IndexDefinition: {
		group: "Schema",
		signature: `interface IndexDefinition {\n  name?:   string\n  fields:  readonly string[]\n  unique?: boolean\n  type?:   "btree" | "hash" | "gist" | "gin"\n}`,
		description:
			"Defines a database index on one or more fields. Pass to indexes[] in SchemaDefinition.",
		docsPath: "/docs/core/types#indexdefinition",
	},
	HookContext: {
		group: "Schema",
		signature: `interface HookContext {\n  readonly schema:   SchemaDefinition\n  readonly metadata: Record<string, unknown>\n}`,
		description:
			"Context passed to every lifecycle hook. metadata is mutable and shared between the before and after hook of the same operation — use it to pass data across the two phases.",
		docsPath: "/docs/core/setup#lifecycle-hooks",
	},
	LifecycleHooks: {
		group: "Schema",
		signature: `interface LifecycleHooks<T extends ForjaEntry = ForjaEntry> {\n  // write — before hooks return modified data, after hooks return modified record\n  beforeCreate?: (data: Partial<T>, ctx: HookContext) => Promise<Partial<T>> | Partial<T>\n  afterCreate?:  (data: T,          ctx: HookContext) => Promise<T> | T\n\n  beforeUpdate?: (data: Partial<T>, ctx: HookContext) => Promise<Partial<T>> | Partial<T>\n  afterUpdate?:  (data: T,          ctx: HookContext) => Promise<T> | T\n\n  // beforeDelete returns the id to delete (allows redirect to a different id)\n  beforeDelete?: (id: number,       ctx: HookContext) => Promise<number> | number\n  afterDelete?:  (id: number,       ctx: HookContext) => Promise<void>   | void\n\n  // read — beforeFind returns modified query, afterFind returns modified results\n  beforeFind?:   (query: QuerySelectObject<T>, ctx: HookContext) => Promise<QuerySelectObject<T>> | QuerySelectObject<T>\n  afterFind?:    (results: T[],                ctx: HookContext) => Promise<T[]> | T[]\n}`,
		description:
			"Schema lifecycle hooks. Defined in the hooks field of SchemaDefinition. Hooks run after plugin hooks and only for non-raw queries. Return values replace the current data/query/result.",
		docsPath: "/docs/core/setup#lifecycle-hooks",
	},

	// ─── Permissions ──────────────────────────────────────────────────────────────
	SchemaPermission: {
		group: "Permissions",
		signature: `interface SchemaPermission {\n  create?: PermissionValue\n  read?:   PermissionValue\n  update?: PermissionValue\n  delete?: PermissionValue\n}`,
		description:
			"Schema-level access control. Each action accepts true, false, a role array, a function, or a mixed array of roles and functions.",
		docsPath: "/docs/core/types#schemapermission",
	},
	FieldPermission: {
		group: "Permissions",
		signature: `interface FieldPermission {\n  read?:  PermissionValue\n  write?: PermissionValue\n}`,
		description:
			"Field-level access control. read: if denied, field is stripped from the response. write: if denied, returns 403.",
		docsPath: "/docs/core/types#fieldpermission",
	},
	PermissionValue: {
		group: "Permissions",
		signature: `type PermissionValue =\n  | boolean\n  | readonly string[]                    // role names\n  | PermissionFn                         // (ctx) => boolean\n  | readonly (string | PermissionFn)[]   // role OR function (OR logic)`,
		description:
			"Defines who can perform an action. true = everyone, false = nobody, string array = specific roles, function = custom logic.",
		docsPath: "/docs/core/types#permissionvalue",
	},
	PermissionFn: {
		group: "Permissions",
		signature: `type PermissionFn = (ctx: PermissionContext) => boolean | Promise<boolean>`,
		description:
			"Custom permission function. Receives the full request context and returns true to allow, false to deny.",
		docsPath: "/docs/core/types#permissionfn",
	},
	PermissionContext: {
		group: "Permissions",
		signature: `interface PermissionContext {\n  readonly user:    AuthUser | undefined\n  readonly action:  PermissionAction\n  readonly record?: ForjaEntry        // existing record (update/delete)\n  readonly input?:  Partial<ForjaEntry> // incoming data (create/update)\n  readonly id?:     number | null\n}`,
		description:
			"Context passed to permission functions. user is undefined for unauthenticated requests.",
		docsPath: "/docs/core/types#permissioncontext",
	},

	// ─── Adapter ──────────────────────────────────────────────────────────────────
	DatabaseAdapter: {
		group: "Adapter",
		signature: `interface DatabaseAdapter<TConfig = object> {\n  readonly name:   string\n  readonly config: TConfig\n  connect():                    Promise<void>\n  disconnect():                 Promise<void>\n  isConnected():                boolean\n  beginTransaction():           Promise<Transaction>\n  getTables():                  Promise<readonly string[]>\n  tableExists(name: string):    Promise<boolean>\n  executeQuery(query):          Promise<QueryResult>\n  createTable(schema):          Promise<void>\n  dropTable(name):              Promise<void>\n  alterTable(name, ops):        Promise<void>\n}`,
		description:
			"Interface all database adapters must implement. Passed as adapter in defineConfig().",
		docsPath: "/docs/core/types#databaseadapter",
	},
	AlterOperation: {
		group: "Adapter",
		signature: `type AlterOperation =\n  | { type: "addColumn";     column: string; definition: FieldDefinition }\n  | { type: "dropColumn";    column: string }\n  | { type: "modifyColumn";  column: string; newDefinition: FieldDefinition }\n  | { type: "renameColumn";  from: string; to: string }\n  | { type: "addMetaField";  field: string; definition: FieldDefinition }\n  | { type: "dropMetaField"; field: string }\n  | { type: "modifyMetaField"; field: string; newDefinition: FieldDefinition }`,
		description:
			"Discriminated union of column-level DDL operations used in alterTable(). MetaField variants are for internal Forja-managed columns.",
		docsPath: "/docs/core/types#alteroperation",
	},
	Transaction: {
		group: "Adapter",
		signature: `interface Transaction {\n  readonly id: string\n  commit():               Promise<void>\n  rollback():             Promise<void>\n  savepoint(name):        Promise<void>\n  rollbackTo(name):       Promise<void>\n  release(name):          Promise<void>\n  executeQuery(query):    Promise<QueryResult>\n  executeRawQuery(sql):   Promise<QueryResult>\n  createTable(schema):    Promise<void>\n  dropTable(name):        Promise<void>\n  alterTable(name, ops):  Promise<void>\n}`,
		description:
			"Wraps a database transaction. Supports query execution and schema operations atomically. Returned by DatabaseAdapter.beginTransaction().",
		docsPath: "/docs/core/types#transaction",
	},

	// ─── Plugin ───────────────────────────────────────────────────────────────────
	ForjaPlugin: {
		group: "Plugin",
		signature: `interface ForjaPlugin<TOptions = Record<string, unknown>> {\n  readonly name:    string\n  readonly version: string\n  readonly options: TOptions\n  init(context: PluginContext):                          Promise<void>\n  destroy():                                            Promise<void>\n  getSchemas?():                                        Promise<SchemaDefinition[]>\n  extendSchemas?(ctx: SchemaExtensionContext):           Promise<SchemaExtension[]>\n  onBeforeQuery?<T>(query: QueryObject<T>, ctx: QueryContext): Promise<QueryObject<T>>\n  onAfterQuery?<T>(result: T, ctx: QueryContext):        Promise<T>\n}`,
		description: "Interface all Forja plugins must implement.",
		docsPath: "/docs/core/types#forjaplugin",
	},
	PluginContext: {
		group: "Plugin",
		signature: `interface PluginContext {\n  readonly adapter: DatabaseAdapter\n  readonly schemas: SchemaRegistry\n  readonly config:  ForjaConfig\n}`,
		description:
			"Context provided to a plugin's init() method. Gives access to the adapter, schema registry, and configuration.",
		docsPath: "/docs/core/types#plugincontext",
	},
	QueryContext: {
		group: "Plugin",
		signature: `interface QueryContext {\n  readonly action:   QueryAction\n  readonly schema:   SchemaDefinition\n  readonly metadata: Record<string, unknown>\n  user?:             AuthUser\n}`,
		description:
			"Context passed to onBeforeQuery / onAfterQuery plugin hooks. Contains the action being performed and the schema being queried.",
		docsPath: "/docs/core/types#querycontext",
	},
	SchemaExtensionContext: {
		group: "Plugin",
		signature: `interface SchemaExtensionContext {\n  readonly schemas:  readonly SchemaDefinition[]\n  extendAll(modifier):                         SchemaExtension[]\n  extendWhere(predicate, modifier):            SchemaExtension[]\n  extendByPattern(pattern, modifier):          SchemaExtension[]\n}`,
		description:
			"Context passed to a plugin's extendSchemas() hook. Provides helpers to extend all or a subset of schemas.",
		docsPath: "/docs/core/types#schemaextensioncontext",
	},
	SchemaExtension: {
		group: "Plugin",
		signature: `interface SchemaExtension {\n  readonly targetSchema:   string\n  readonly fields?:        Record<string, FieldDefinition>\n  readonly removeFields?:  string[]\n  readonly modifyFields?:  Record<string, Partial<FieldDefinition>>\n  readonly indexes?:       IndexDefinition[]\n}`,
		description:
			"Describes fields and indexes to add, remove, or modify on an existing schema. Returned from extendSchemas().",
		docsPath: "/docs/core/types#schemaextension",
	},

	QueryAction: {
		group: "Plugin",
		signature: `type QueryAction =\n  | "findOne"\n  | "findMany"\n  | "count"\n  | "create"\n  | "createMany"\n  | "update"\n  | "updateMany"\n  | "delete"\n  | "deleteMany"`,
		description:
			"The CRUD operation being performed. Available in QueryContext inside plugin hooks.",
		docsPath: "/docs/core/types#queryaction",
	},

	// ─── Schema registry ──────────────────────────────────────────────────────────
	SchemaRegistry: {
		group: "Schema registry",
		signature: `class SchemaRegistry {\n  get(name: string):    SchemaDefinition | undefined\n  has(name: string):    boolean\n  getAll():             readonly SchemaDefinition[]\n  getNames():           readonly string[]\n  readonly size:        number\n}`,
		description:
			"Registry that holds all registered schemas. Returned by getSchemas().",
		docsPath: "/docs/core/types#schemaregistry",
	},

	// ─── Migration ────────────────────────────────────────────────────────────────
	MigrationSession: {
		group: "Migration",
		signature: `class MigrationSession {\n  tablesToCreate:  readonly SchemaDefinition[]\n  ambiguous:       readonly AmbiguousChange[]\n  hasAmbiguous:    boolean\n  resolveAmbiguous(id: string, action: AmbiguousActionType): void\n  getPlan():       MigrationPlan\n  apply():         Promise<readonly MigrationExecutionResult[]>\n}`,
		description:
			"Returned by beginMigrate(). Represents a diff session between current schemas and database state.",
		docsPath: "/docs/core/types#migrationsession",
	},
	AmbiguousChange: {
		group: "Migration",
		signature: `interface AmbiguousChange {\n  readonly id:          string   // e.g. "user.name->lastname"\n  readonly description: string\n  readonly options:     readonly AmbiguousActionType[]\n}`,
		description:
			"A schema change that Forja cannot resolve automatically — typically a field rename vs. drop+add. Must be resolved with MigrationSession.resolveAmbiguous() before applying.",
		docsPath: "/docs/core/types#ambiguouschange",
	},
	AmbiguousActionType: {
		group: "Migration",
		signature: `type AmbiguousActionType =\n  | "rename"  // treat as a rename operation\n  | "drop"    // drop the old field and add the new one`,
		description:
			"Resolution for an ambiguous schema change. Passed to MigrationSession.resolveAmbiguous().",
		docsPath: "/docs/core/types#ambiguousactiontype",
	},
	Migration: {
		group: "Migration",
		signature: `interface Migration {\n  readonly metadata:   MigrationMetadata\n  readonly operations: readonly MigrationOperation[]\n}`,
		description:
			"A single migration unit — metadata plus the list of DDL operations to execute.",
		docsPath: "/docs/core/types#migration",
	},
	MigrationMetadata: {
		group: "Migration",
		signature: `interface MigrationMetadata {\n  readonly name:         string\n  readonly version:      string\n  readonly timestamp:    number\n  readonly description?: string\n  readonly author?:      string\n}`,
		description:
			"Descriptive metadata attached to a migration. version is used to track which migrations have been applied.",
		docsPath: "/docs/core/types#migrationmetadata",
	},
	MigrationOperation: {
		group: "Migration",
		signature: `type MigrationOperation =\n  | { type: "createTable";  schema: SchemaDefinition }\n  | { type: "dropTable";    tableName: string }\n  | { type: "alterTable";   tableName: string; operations: AlterOperation[] }\n  | { type: "createIndex";  tableName: string; index: IndexDefinition }\n  | { type: "dropIndex";    tableName: string; indexName: string }\n  | { type: "renameTable";  from: string; to: string }\n  | { type: "raw";          sql: string; params?: unknown[] }\n  | { type: "dataTransfer"; description: string }`,
		description:
			"Discriminated union of all DDL operations a migration can contain.",
		docsPath: "/docs/core/types#migrationoperation",
	},
	MigrationStatus: {
		group: "Migration",
		signature: `type MigrationStatus =\n  | "pending"\n  | "running"\n  | "completed"\n  | "failed"`,
		description: "Execution state of a migration.",
		docsPath: "/docs/core/types#migrationstatus",
	},
	MigrationPlan: {
		group: "Migration",
		signature: `interface MigrationPlan {\n  readonly migrations: readonly Migration[]\n  readonly target?:    string\n}`,
		description:
			"The list of migrations to execute, as returned by MigrationSession.getPlan(). target is undefined when targeting the latest version.",
		docsPath: "/docs/core/types#migrationplan",
	},
	MigrationExecutionResult: {
		group: "Migration",
		signature: `interface MigrationExecutionResult {\n  readonly migration:     Migration\n  readonly status:        MigrationStatus\n  readonly executionTime: number\n  readonly error?:        Error\n  readonly warnings?:     string[]\n}`,
		description:
			"Result of a single migration execution. status is one of 'pending' | 'running' | 'completed' | 'failed'.",
		docsPath: "/docs/core/types#migrationexecutionresult",
	},

	// ─── Config ───────────────────────────────────────────────────────────────────
	ForjaConfig: {
		group: "Config",
		signature: `interface ForjaConfig {\n  adapter:    DatabaseAdapter\n  schemas:    SchemaDefinition[]\n  plugins?:   ForjaPlugin[]\n  migration?: MigrationConfig\n  dev?:       DevConfig\n}`,
		description: "Top-level configuration object passed to defineConfig().",
		docsPath: "/docs/core/types#forjaconfig",
	},
	MigrationConfig: {
		group: "Config",
		signature: `interface MigrationConfig {\n  auto?:      boolean  // run migrations on startup\n  directory?: string   // default: "./migrations"\n  modelName?: string   // tracking table name\n}`,
		description:
			"Controls migration behavior. auto defaults to false in production.",
		docsPath: "/docs/core/types#migrationconfig",
	},
	DevConfig: {
		group: "Config",
		signature: `interface DevConfig {\n  logging?:         boolean  // detailed query logging\n  validateQueries?: boolean  // validate queries before execution\n  prettyErrors?:    boolean  // pretty-print errors with stack traces\n}`,
		description:
			"Development mode options. All options default to false in production.",
		docsPath: "/docs/core/types#devconfig",
	},
};

/**
 * Normalize a type token to look up in TYPE_DEFINITIONS.
 * Strips generic parameters: "RawCrudOptions<T>" → "RawCrudOptions"
 */
export function normalizeTypeName(token: string): string {
	return token.replace(/<.*>/, "").trim();
}
