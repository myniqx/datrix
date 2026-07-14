/**
 * Schema Registry Implementation
 *
 * Manages schema registration, retrieval, and validation.
 * Central store for all schemas in the application.
 */

import type {
	FieldDefinition,
	FileField,
	FileFieldOptions,
	DatrixEntry,
	ISchemaRegistry,
	RelationField,
	SchemaDefinition,
	SchemaValidationError,
} from "../types/core/schema";
import {
	validateSchemaDefinition,
	sortSchemasByDependency,
	RESERVED_FIELDS,
} from "../types/core/schema";
import { DATRIX_META_MODEL } from "../types/core/constants";
import { QuerySelect } from "../types/core/query-builder";
import { pluralize } from "./pluralize";

/**
 * Schema registry error
 */
export class SchemaRegistryError extends Error {
	readonly code: string;
	readonly schemaName: string | undefined;
	readonly details: unknown | undefined;

	constructor(
		message: string,
		options?: {
			code?: string;
			schemaName?: string;
			details?: unknown;
		},
	) {
		super(message);
		this.name = "SchemaRegistryError";
		this.code = options?.code ?? "UNKNOWN";
		this.schemaName = options?.schemaName;
		this.details = options?.details;
	}
}

/**
 * Schema registry configuration
 */
export interface SchemaRegistryConfig {
	readonly strict: boolean | undefined;
	readonly allowOverwrite: boolean | undefined;
	readonly validateRelations: boolean | undefined;
}

/**
 * Performance cache for expensive operations
 */
interface RegistryCache {
	relatedSchemas: Map<string, readonly string[]>;
	referencingSchemas: Map<string, readonly string[]>;
	fieldTypeIndex: Map<string, readonly SchemaDefinition[]>;
	selectFields: Map<string, readonly string[]>;
	tableNames: Map<string, string>;
}

/**
 * Schema registry implementation
 */
export class SchemaRegistry implements ISchemaRegistry {
	private readonly schemas: Map<string, SchemaDefinition> = new Map();
	private readonly config: Required<SchemaRegistryConfig>;
	private locked = false;
	private cache: RegistryCache = {
		relatedSchemas: new Map(),
		referencingSchemas: new Map(),
		fieldTypeIndex: new Map(),
		selectFields: new Map(),
		tableNames: new Map(),
	};

	constructor(config?: SchemaRegistryConfig) {
		this.config = {
			strict: config?.strict ?? true,
			allowOverwrite: config?.allowOverwrite ?? false,
			validateRelations: config?.validateRelations ?? true,
		};
	}

	/**
	 * Invalidate performance cache
	 */
	private invalidateCache(): void {
		this.cache.relatedSchemas.clear();
		this.cache.referencingSchemas.clear();
		this.cache.fieldTypeIndex.clear();
		this.cache.selectFields.clear();
		this.cache.tableNames.clear();
	}

	/**
	 * Register a schema
	 * Adds reserved fields (id, createdAt, updatedAt)
	 * Does NOT process relations - call finalizeRegistry() after all schemas are registered
	 */
	register(schema: SchemaDefinition): SchemaDefinition {
		if (this.locked) {
			throw new SchemaRegistryError("Registry is locked", {
				code: "REGISTRY_LOCKED",
			});
		}

		if (!schema.name || schema.name.trim() === "") {
			throw new SchemaRegistryError("Schema name is required", {
				code: "INVALID_SCHEMA_NAME",
			});
		}

		if (this.schemas.has(schema.name) && !this.config.allowOverwrite) {
			throw new SchemaRegistryError(
				`Schema already registered: ${schema.name}`,
				{
					code: "DUPLICATE_SCHEMA",
					schemaName: schema.name,
				},
			);
		}

		for (const reservedField of RESERVED_FIELDS) {
			if (reservedField in schema.fields) {
				throw new SchemaRegistryError(
					`Field '${reservedField}' is reserved and cannot be defined manually in schema '${schema.name}'`,
					{
						code: "RESERVED_FIELD_NAME",
						schemaName: schema.name,
						details: { field: reservedField },
					},
				);
			}
		}

		if (this.config.strict) {
			const validation = validateSchemaDefinition(schema);
			if (!validation.valid) {
				throw new SchemaRegistryError(
					`Schema validation failed: ${schema.name}`,
					{
						code: "VALIDATION_FAILED",
						schemaName: schema.name,
						details: validation.errors,
					},
				);
			}
		}

		const transformedFields = this.transformFileFields(schema.fields);

		// Junction tables intentionally never carry timestamps — re-registering
		// one (e.g. via fromJSON) must not inject createdAt/updatedAt.
		const timestampFields = schema._isJunctionTable
			? {}
			: {
					createdAt: {
						type: "date" as const,
						required: true,
					},
					updatedAt: {
						type: "date" as const,
						required: true,
					},
				};

		const enhancedFields = {
			id: {
				type: "number" as const,
				primary: true,
				autoIncrement: true,
				required: true,
			},
			...transformedFields,
			...timestampFields,
		};

		const storedSchema = {
			...schema,
			tableName: schema.tableName ?? pluralize(schema.name.toLowerCase()),
			fields: enhancedFields,
		};

		this.schemas.set(schema.name, storedSchema);
		this.invalidateCache();

		return storedSchema;
	}

	/**
	 * Replace an already-registered schema in place (internal).
	 *
	 * Used by plugin schema extensions: the input is a schema previously
	 * returned by `get()`, so it already carries the reserved fields and
	 * tableName. Bypasses the duplicate/reserved-field checks of `register()`
	 * but still runs strict validation and file-field transformation.
	 */
	replace(schema: SchemaDefinition): SchemaDefinition {
		if (this.locked) {
			throw new SchemaRegistryError("Registry is locked", {
				code: "REGISTRY_LOCKED",
			});
		}

		if (!schema.name || !this.schemas.has(schema.name)) {
			throw new SchemaRegistryError(
				`Cannot replace unregistered schema: ${schema.name}`,
				{
					code: "SCHEMA_NOT_FOUND",
					schemaName: schema.name,
				},
			);
		}

		if (this.config.strict) {
			const validation = validateSchemaDefinition(schema);
			if (!validation.valid) {
				throw new SchemaRegistryError(
					`Schema validation failed: ${schema.name}`,
					{
						code: "VALIDATION_FAILED",
						schemaName: schema.name,
						details: validation.errors,
					},
				);
			}
		}

		const storedSchema = {
			...schema,
			tableName: schema.tableName ?? pluralize(schema.name.toLowerCase()),
			fields: this.transformFileFields(schema.fields),
		};

		this.schemas.set(schema.name, storedSchema);
		this.invalidateCache();

		return storedSchema;
	}

	/**
	 * Register multiple schemas
	 * Call finalizeRegistry() after all schemas are registered to process relations
	 */
	registerMany(schemas: readonly SchemaDefinition[]): void {
		for (const schema of schemas) {
			this.register(schema);
		}
	}

	/**
	 * Finalize registry after all schemas are registered
	 * Processes relations and creates junction tables
	 * Call this after:
	 * 1. User schemas registered
	 * 2. Plugin schemas registered
	 * 3. Plugin schema extensions applied
	 */
	finalizeRegistry(): void {
		this.processRelations();

		if (this.config.validateRelations) {
			this.validateRelations();
		}

		this.sortByDependencies();

		// processRelations/createJunctionTable write to the schema map directly,
		// bypassing register() — drop caches built before finalization.
		this.invalidateCache();
	}

	/**
	 * Topological sort schemas by FK dependencies.
	 * Schemas that are referenced by others come first.
	 * Rebuilds the internal Map in dependency order.
	 */
	private sortByDependencies(): void {
		const allSchemas = Array.from(this.schemas.values());
		const sorted = sortSchemasByDependency(allSchemas);

		// Rebuild Map in sorted order, _datrix always first
		const entries = new Map<string, SchemaDefinition>();

		const metaSchema = this.schemas.get(DATRIX_META_MODEL);
		if (metaSchema) {
			entries.set(DATRIX_META_MODEL, metaSchema);
		}

		for (const schema of sorted) {
			if (schema.name === DATRIX_META_MODEL) continue;
			entries.set(schema.name, schema);
		}

		this.schemas.clear();
		for (const [name, schema] of entries) {
			this.schemas.set(name, schema);
		}
	}

	/**
	 * Get schema by name
	 */
	get(name: string): SchemaDefinition | undefined {
		return this.schemas.get(name);
	}

	/**
	 * Get schema by model name with resolved table name
	 */
	getWithTableName(
		modelName: string,
	): { schema: SchemaDefinition; tableName: string } | undefined {
		const schema = this.get(modelName);
		if (!schema) return undefined;
		return {
			schema,
			tableName: schema.tableName ?? pluralize(modelName.toLowerCase()),
		};
	}

	/**
	 * Get schema by table name
	 */
	getByTableName(
		tableName: string,
	): { schema: SchemaDefinition; tableName: string } | undefined {
		const modelName = this.findModelByTableName(tableName);
		if (!modelName) return undefined;
		return this.getWithTableName(modelName);
	}

	/**
	 * Check if schema exists
	 */
	has(name: string): boolean {
		return this.schemas.has(name);
	}

	/**
	 * Get all schemas
	 */
	getAll(): readonly SchemaDefinition[] {
		return Array.from(this.schemas.values());
	}

	/**
	 * Get schema names
	 */
	getNames(): readonly string[] {
		return Array.from(this.schemas.keys());
	}

	/**
	 * Get schema count
	 */
	get size(): number {
		return this.schemas.size;
	}

	/**
	 * Find model name by table name
	 */
	findModelByTableName(tableName: string | null): string | null {
		if (!tableName) return null;

		// O(1) lookup via cached tableName → modelName index (rebuilt lazily
		// after any cache invalidation).
		if (this.cache.tableNames.size === 0 && this.schemas.size > 0) {
			for (const [modelName, schema] of this.schemas.entries()) {
				const schemaTableName =
					schema.tableName ?? pluralize(modelName.toLowerCase());
				this.cache.tableNames.set(schemaTableName, modelName);
			}
		}

		return this.cache.tableNames.get(tableName) ?? null;
	}

	/**
	 * Get schemas with relations
	 */
	getSchemasWithRelations(): readonly SchemaDefinition[] {
		return this.getAll().filter((schema) =>
			Object.values(schema.fields).some((field) => field.type === "relation"),
		);
	}

	/**
	 * Get related schemas for a given schema (cached)
	 */
	getRelatedSchemas(schemaName: string): readonly string[] {
		const cached = this.cache.relatedSchemas.get(schemaName);
		if (cached) return cached;

		const schema = this.get(schemaName);
		if (!schema) return [];

		const related: string[] = [];
		for (const field of Object.values(schema.fields)) {
			if (field.type === "relation") {
				const relationField = field as RelationField;
				if (!related.includes(relationField.model)) {
					related.push(relationField.model);
				}
			}
		}

		this.cache.relatedSchemas.set(schemaName, related);
		return related;
	}

	/**
	 * Get schemas that reference a given schema (cached)
	 */
	getReferencingSchemas(schemaName: string): readonly string[] {
		const cached = this.cache.referencingSchemas.get(schemaName);
		if (cached) return cached;

		const referencing: string[] = [];
		for (const [name, schema] of this.schemas.entries()) {
			for (const field of Object.values(schema.fields)) {
				if (field.type === "relation") {
					const relationField = field as RelationField;
					if (relationField.model === schemaName) {
						referencing.push(name);
						break;
					}
				}
			}
		}

		this.cache.referencingSchemas.set(schemaName, referencing);
		return referencing;
	}

	/**
	 * Find schemas by field type (cached)
	 */
	findByFieldType(fieldType: string): readonly SchemaDefinition[] {
		const cached = this.cache.fieldTypeIndex.get(fieldType);
		if (cached) return cached;

		const result = this.getAll().filter((schema) =>
			Object.values(schema.fields).some((field) => field.type === fieldType),
		);

		this.cache.fieldTypeIndex.set(fieldType, result);
		return result;
	}

	/**
	 * Get cached SELECT fields for a model (wildcard "*" expansion)
	 *
	 * Returns all selectable fields for a model, excluding:
	 * - Hidden fields (e.g., foreign keys)
	 * - Relation fields (use populate for these)
	 */
	getCachedSelectFields<T extends DatrixEntry>(
		modelName: string,
	): QuerySelect<T> {
		const schema = this.get(modelName);
		if (!schema) {
			throw new SchemaRegistryError(`Schema not found: ${modelName}`, {
				code: "SCHEMA_NOT_FOUND",
			});
		}

		const cached = this.cache.selectFields.get(modelName);
		if (cached) return cached as QuerySelect<T>;

		const cleanFields: string[] = [];
		for (const [fieldName, fieldDef] of Object.entries(schema.fields)) {
			if ((fieldDef as { hidden?: boolean }).hidden) continue;
			if (fieldDef.type === "relation") continue;
			cleanFields.push(fieldName);
		}

		this.cache.selectFields.set(modelName, cleanFields);
		return cleanFields as QuerySelect<T>;
	}

	/**
	 * Validate all relations
	 */
	validateRelations(): void {
		const errors: SchemaValidationError[] = [];

		for (const [, schema] of this.schemas.entries()) {
			for (const [fieldName, field] of Object.entries(schema.fields)) {
				if (field.type === "relation") {
					const relationField = field as RelationField;
					if (!this.has(relationField.model)) {
						errors.push({
							field: fieldName,
							message: `Relation target not found: ${relationField.model}`,
							code: "INVALID_RELATION_TARGET",
						});
					}
				}
			}
		}

		if (errors.length > 0) {
			throw new SchemaRegistryError("Relation validation failed", {
				code: "INVALID_RELATIONS",
				details: errors,
			});
		}
	}

	/**
	 * Clear all schemas
	 */
	clear(): void {
		if (this.locked) {
			throw new SchemaRegistryError("Cannot clear locked registry", {
				code: "REGISTRY_LOCKED",
			});
		}
		this.schemas.clear();
		this.invalidateCache();
	}

	/**
	 * Remove schema by name
	 */
	remove(name: string): boolean {
		if (this.locked) {
			throw new SchemaRegistryError("Cannot remove from locked registry", {
				code: "REGISTRY_LOCKED",
			});
		}

		const removed = this.schemas.delete(name);
		if (removed) {
			this.invalidateCache();
		}
		return removed;
	}

	/**
	 * Lock registry (prevent modifications)
	 */
	lock(): void {
		this.locked = true;
	}

	/**
	 * Unlock registry
	 */
	unlock(): void {
		this.locked = false;
	}

	/**
	 * Check if registry is locked
	 */
	isLocked(): boolean {
		return this.locked;
	}

	/**
	 * Transform file fields into relation fields (Pass 0)
	 * Called during register() before reserved fields are added.
	 *
	 * FileField { type: "file", multiple: false } → RelationField { kind: "belongsTo", model: "media", fileOptions: {...} }
	 * FileField { type: "file", multiple: true }  → RelationField { kind: "hasMany",   model: "media", fileOptions: {...} }
	 *
	 * Upload config is NOT required here — that check is in ApiPlugin.
	 * Core only transforms the type so adapters/migrations see a plain relation.
	 */
	private transformFileFields(
		fields: Record<string, FieldDefinition>,
	): Record<string, FieldDefinition> {
		const result: Record<string, FieldDefinition> = {};

		for (const [fieldName, field] of Object.entries(fields)) {
			if (field.type !== "file") {
				result[fieldName] = field;
				continue;
			}

			const fileField = field as FileField;

			const fileOptions: FileFieldOptions = {
				...(fileField.allowedTypes !== undefined && {
					allowedTypes: fileField.allowedTypes,
				}),
				...(fileField.maxSize !== undefined && {
					maxSize: fileField.maxSize,
				}),
			};

			const hasFileOptions = Object.keys(fileOptions).length > 0;

			const relationField: RelationField = {
				type: "relation",
				model: "media",
				kind: fileField.multiple ? "hasMany" : "belongsTo",
				...(fileField.required !== undefined && {
					required: fileField.required,
				}),
				...(hasFileOptions && { fileOptions }),
			};

			result[fieldName] = relationField;
		}

		return result;
	}

	/**
	 * Process relations (Pass 2)
	 * Add foreign keys for belongsTo/hasOne/hasMany
	 * Create junction tables for manyToMany
	 */
	private processRelations(): void {
		// Detect two hasOne/hasMany relations claiming the same FK column on the
		// same target model (e.g. `reviewer: hasOne User` + `editor: hasOne User`
		// both defaulting to `PostId`) — they would be indistinguishable.
		const claimedForeignKeys = new Map<string, string>();

		for (const [schemaName, schema] of this.schemas.entries()) {
			const enhancedFields = { ...schema.fields };

			for (const [fieldName, field] of Object.entries(schema.fields)) {
				if (field.type !== "relation") continue;

				const relation = field as RelationField;
				const targetSchema = this.schemas.get(relation.model);

				if (!targetSchema) {
					throw new SchemaRegistryError(
						`Relation target not found: ${relation.model} in schema ${schemaName}.${fieldName}`,
						{
							code: "INVALID_RELATION_TARGET",
							schemaName,
							details: { field: fieldName, target: relation.model },
						},
					);
				}

				if (relation.kind === "belongsTo") {
					const foreignKey = relation.foreignKey ?? `${fieldName}Id`;

					if (!(foreignKey in enhancedFields)) {
						const targetTableName =
							targetSchema.tableName ??
							pluralize(relation.model.toLowerCase());
						const isRequired = relation.required ?? false;
						const defaultOnDelete = isRequired ? "cascade" : "setNull";
						enhancedFields[foreignKey] = {
							type: "number",
							required: isRequired,
							hidden: true,
							references: {
								table: targetTableName,
								column: "id",
								onDelete: relation.onDelete ?? defaultOnDelete,
								onUpdate: relation.onUpdate,
							},
						};
					}

					enhancedFields[fieldName] = {
						...relation,
						foreignKey,
					};
				}

				if (relation.kind === "hasOne" || relation.kind === "hasMany") {
					const foreignKey = relation.foreignKey ?? `${schemaName}Id`;

					const claimKey = `${relation.model}.${foreignKey}`;
					const claimedBy = claimedForeignKeys.get(claimKey);
					if (claimedBy) {
						throw new SchemaRegistryError(
							`Foreign key collision: relations '${claimedBy}' and ` +
								`'${schemaName}.${fieldName}' both map to column ` +
								`'${foreignKey}' on model '${relation.model}'. ` +
								`Set an explicit 'foreignKey' on at least one of them.`,
							{
								code: "FOREIGN_KEY_COLLISION",
								schemaName,
								details: {
									field: fieldName,
									target: relation.model,
									foreignKey,
									conflictsWith: claimedBy,
								},
							},
						);
					}
					claimedForeignKeys.set(claimKey, `${schemaName}.${fieldName}`);

					// Self-relations must write the FK into enhancedFields — the final
					// schemas.set below would clobber a FK written via the target path.
					const isSelfRelation = relation.model === schemaName;
					const targetFields = isSelfRelation
						? enhancedFields
						: { ...targetSchema.fields };

					if (!(foreignKey in targetFields)) {
						const sourceTableName =
							schema.tableName ?? pluralize(schemaName.toLowerCase());
						targetFields[foreignKey] = {
							type: "number",
							required: false,
							hidden: true,
							// hasOne: at most one child row may point at a parent —
							// enforced at the DB level via a UNIQUE constraint.
							...(relation.kind === "hasOne" && { unique: true }),
							references: {
								table: sourceTableName,
								column: "id",
								onDelete: relation.onDelete ?? "setNull",
								onUpdate: relation.onUpdate,
							},
						};
					}

					if (!isSelfRelation) {
						this.schemas.set(relation.model, {
							...targetSchema,
							fields: targetFields,
						});
					}

					enhancedFields[fieldName] = {
						...relation,
						foreignKey,
					};
				}

				if (relation.kind === "manyToMany") {
					const junctionTableName =
						relation.through ??
						this.getJunctionTableName(schemaName, relation.model);

					this.createJunctionTable(schemaName, relation, junctionTableName);

					enhancedFields[fieldName] = {
						...relation,
						through: junctionTableName,
					};
				}
			}

			this.schemas.set(schemaName, {
				...schema,
				fields: enhancedFields,
			});
		}
	}

	/**
	 * Create junction table for manyToMany relation
	 */
	private createJunctionTable(
		schemaName: string,
		relation: RelationField,
		junctionTableName: string,
	): void {
		if (this.schemas.has(junctionTableName)) return;

		// FK references must point at the actual table names — a schema may
		// declare a custom tableName that differs from the pluralized model name.
		const sourceTableName =
			this.schemas.get(schemaName)?.tableName ??
			pluralize(schemaName.toLowerCase());
		const targetTableName =
			this.schemas.get(relation.model)?.tableName ??
			pluralize(relation.model.toLowerCase());

		// Self-referential manyToMany (e.g. User "friends" User) needs distinct
		// field/FK names — `${model}Id` would collide on both sides. The source
		// field is registered first; consumers rely on that order to tell the
		// two sides apart.
		const isSelfRelation = schemaName === relation.model;
		const sourceFieldName = isSelfRelation ? `source${schemaName}` : schemaName;
		const targetFieldName = isSelfRelation
			? `target${relation.model}`
			: relation.model;
		const sourceFk = `${sourceFieldName}Id`;
		const targetFk = `${targetFieldName}Id`;

		const junctionSchema: SchemaDefinition = {
			name: junctionTableName,
			tableName: junctionTableName,
			fields: {
				id: { type: "number", required: false, autoIncrement: true },
				[sourceFieldName]: {
					type: "relation",
					kind: "belongsTo",
					model: schemaName,
					foreignKey: sourceFk,
					required: true,
				} as RelationField,
				[targetFieldName]: {
					type: "relation",
					kind: "belongsTo",
					model: relation.model,
					foreignKey: targetFk,
					required: true,
				} as RelationField,
				[sourceFk]: {
					type: "number",
					required: true,
					hidden: true,
					references: {
						table: sourceTableName,
						column: "id",
						onDelete: "cascade" as const,
					},
				},
				[targetFk]: {
					type: "number",
					required: true,
					hidden: true,
					references: {
						table: targetTableName,
						column: "id",
						onDelete: "cascade" as const,
					},
				},
			},
			indexes: [
				{
					fields: [sourceFk, targetFk],
					unique: true,
				},
			],
			_isJunctionTable: true,
		};

		this.schemas.set(junctionTableName, junctionSchema);
	}

	/**
	 * Get junction table name for manyToMany relation
	 * Alphabetically sorted for consistency
	 */
	private getJunctionTableName(schema1: string, schema2: string): string {
		const sorted = [schema1, schema2].sort();
		return `${sorted[0]}_${sorted[1]}`;
	}

	/**
	 * Export schemas as JSON
	 *
	 * Junction schemas are excluded — they are fully derivable from the
	 * manyToMany relations and would otherwise round-trip with a different
	 * shape (re-injected timestamps they intentionally never had).
	 */
	toJSON(): Record<string, SchemaDefinition> {
		const autoFields = new Set(["id", "createdAt", "updatedAt"]);
		const result: Record<string, SchemaDefinition> = {};

		for (const [name, schema] of this.schemas) {
			if (schema._isJunctionTable) continue;
			const fields: Record<string, unknown> = {};
			for (const [fieldName, fieldDef] of Object.entries(schema.fields)) {
				if (autoFields.has(fieldName)) continue;
				fields[fieldName] = fieldDef;
			}
			result[name] = { ...schema, fields } as SchemaDefinition;
		}

		return result;
	}

	/**
	 * Import schemas from JSON
	 */
	fromJSON(data: Record<string, SchemaDefinition>): void {
		const schemas = Object.values(data);
		this.registerMany(schemas);
	}
}

/**
 * Global schema registry instance
 */
let globalRegistry: SchemaRegistry | undefined;

/**
 * Get global registry instance
 */
export function getGlobalRegistry(): SchemaRegistry {
	if (!globalRegistry) {
		globalRegistry = new SchemaRegistry();
	}
	return globalRegistry;
}

/**
 * Set global registry instance
 */
export function setGlobalRegistry(registry: SchemaRegistry): void {
	globalRegistry = registry;
}

/**
 * Reset global registry
 */
export function resetGlobalRegistry(): void {
	globalRegistry = undefined;
}
