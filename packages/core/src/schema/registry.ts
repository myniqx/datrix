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
	ForjaEntry,
	ISchemaRegistry,
	RelationField,
	SchemaDefinition,
	SchemaValidationError,
} from "forja-types/core/schema";
import {
	validateSchemaDefinition,
	RESERVED_FIELDS,
} from "forja-types/core/schema";
import { FORJA_META_MODEL } from "forja-types/core/constants";
import { QuerySelect } from "forja-types/core/query-builder";

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

		const enhancedFields = {
			id: {
				type: "number" as const,
				primary: true,
				autoIncrement: true,
				required: true,
			},
			...transformedFields,
			createdAt: {
				type: "date" as const,
				required: true,
			},
			updatedAt: {
				type: "date" as const,
				required: true,
			},
		};

		const storedSchema = {
			...schema,
			tableName: schema.tableName ?? this.pluralize(schema.name.toLowerCase()),
			fields: enhancedFields,
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
	}

	/**
	 * Topological sort schemas by FK dependencies.
	 * Schemas that are referenced by others come first.
	 * Rebuilds the internal Map in dependency order.
	 */
	private sortByDependencies(): void {
		// Build dependency graph: schema tableName -> set of referenced tableNames
		const tableToName = new Map<string, string>();
		const deps = new Map<string, Set<string>>();

		for (const [name, schema] of this.schemas) {
			const tableName = schema.tableName ?? name;
			tableToName.set(tableName, name);
			deps.set(name, new Set());
		}

		for (const [name, schema] of this.schemas) {
			for (const field of Object.values(schema.fields)) {
				if (field.type !== "number") continue;
				const ref = (field as { references?: { table: string } }).references;
				if (!ref) continue;

				const depName = tableToName.get(ref.table);
				if (depName && depName !== name) {
					deps.get(name)!.add(depName);
				}
			}
		}

		// Kahn's algorithm
		const inDegree = new Map<string, number>();
		for (const name of deps.keys()) {
			inDegree.set(name, 0);
		}
		for (const depSet of deps.values()) {
			for (const dep of depSet) {
				inDegree.set(dep, (inDegree.get(dep) ?? 0) + 1);
			}
		}

		const queue: string[] = [];
		for (const [name, degree] of inDegree) {
			if (degree === 0) queue.push(name);
		}

		const sorted: string[] = [];
		while (queue.length > 0) {
			const current = queue.shift()!;
			sorted.push(current);
			for (const dep of deps.get(current) ?? []) {
				const newDegree = (inDegree.get(dep) ?? 1) - 1;
				inDegree.set(dep, newDegree);
				if (newDegree === 0) queue.push(dep);
			}
		}

		// Reverse: dependencies first
		sorted.reverse();

		// Rebuild Map in sorted order, _forja always first
		const entries = new Map<string, SchemaDefinition>();

		const metaSchema = this.schemas.get(FORJA_META_MODEL);
		if (metaSchema) {
			entries.set(FORJA_META_MODEL, metaSchema);
		}

		for (const name of sorted) {
			if (name === FORJA_META_MODEL) continue;
			entries.set(name, this.schemas.get(name)!);
		}
		// Add any remaining (circular deps fallback)
		for (const [name, schema] of this.schemas) {
			if (!entries.has(name)) entries.set(name, schema);
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
			tableName: schema.tableName ?? this.pluralize(modelName.toLowerCase()),
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
		for (const [modelName, schema] of this.schemas.entries()) {
			const schemaTableName =
				schema.tableName ?? this.pluralize(modelName.toLowerCase());
			if (schemaTableName === tableName) {
				return modelName;
			}
		}
		return null;
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
	getCachedSelectFields<T extends ForjaEntry>(
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
							this.pluralize(relation.model.toLowerCase());
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
					const targetFields = { ...targetSchema.fields };

					if (!(foreignKey in targetFields)) {
						const sourceTableName =
							schema.tableName ?? this.pluralize(schemaName.toLowerCase());
						targetFields[foreignKey] = {
							type: "number",
							required: false,
							hidden: true,
							references: {
								table: sourceTableName,
								column: "id",
								onDelete: relation.onDelete ?? "setNull",
								onUpdate: relation.onUpdate,
							},
						};
					}

					this.schemas.set(relation.model, {
						...targetSchema,
						fields: targetFields,
					});

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

		const sourceFk = `${schemaName}Id`;
		const targetFk = `${relation.model}Id`;

		const junctionSchema: SchemaDefinition = {
			name: junctionTableName,
			tableName: junctionTableName,
			fields: {
				id: { type: "number", required: false, autoIncrement: true },
				[schemaName]: {
					type: "relation",
					kind: "belongsTo",
					model: schemaName,
					foreignKey: sourceFk,
					required: true,
				} as RelationField,
				[relation.model]: {
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
						table: this.pluralize(schemaName.toLowerCase()),
						column: "id",
						onDelete: "cascade" as const,
					},
				},
				[targetFk]: {
					type: "number",
					required: true,
					hidden: true,
					references: {
						table: this.pluralize(relation.model.toLowerCase()),
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
	 * Enhanced pluralization with common English rules
	 */
	private pluralize(word: string): string {
		const irregulars: Record<string, string> = {
			person: "people",
			child: "children",
			man: "men",
			woman: "women",
			tooth: "teeth",
			foot: "feet",
			mouse: "mice",
			goose: "geese",
			ox: "oxen",
			datum: "data",
			index: "indices",
			vertex: "vertices",
			matrix: "matrices",
			status: "statuses",
			quiz: "quizzes",
		};

		const lower = word.toLowerCase();
		const irregular = irregulars[lower];
		if (irregular) {
			const firstChar = word.charAt(0);
			return firstChar === firstChar.toUpperCase()
				? irregular.charAt(0).toUpperCase() + irregular.slice(1)
				: irregular;
		}

		if (
			word.endsWith("ss") ||
			lower === "data" ||
			lower === "information" ||
			lower === "equipment"
		) {
			return word;
		}

		if (word.endsWith("y") && word.length > 1) {
			const beforeY = word[word.length - 2];
			if (beforeY && !"aeiou".includes(beforeY.toLowerCase())) {
				return word.slice(0, -1) + "ies";
			}
		}

		if (word.endsWith("f")) {
			return word.slice(0, -1) + "ves";
		}
		if (word.endsWith("fe")) {
			return word.slice(0, -2) + "ves";
		}

		if (word.endsWith("o") && word.length > 1) {
			const beforeO = word[word.length - 2];
			if (beforeO && !"aeiou".includes(beforeO.toLowerCase())) {
				return word + "es";
			}
		}

		if (
			word.endsWith("ch") ||
			word.endsWith("sh") ||
			word.endsWith("s") ||
			word.endsWith("ss") ||
			word.endsWith("x") ||
			word.endsWith("z")
		) {
			return word + "es";
		}

		return word + "s";
	}

	/**
	 * Export schemas as JSON
	 */
	toJSON(): Record<string, SchemaDefinition> {
		const autoFields = new Set(["id", "createdAt", "updatedAt"]);
		const result: Record<string, SchemaDefinition> = {};

		for (const [name, schema] of this.schemas) {
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
