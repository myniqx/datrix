/**
 * MongoDB Nested Where Resolver
 *
 * Resolves relation-based WHERE conditions by performing
 * lookup queries to find matching parent IDs.
 *
 * MongoDB has no JOINs, so filtering by related record fields
 * requires pre-resolving: query the target collection first,
 * collect matching IDs, then filter the source collection.
 *
 * Supports:
 * - belongsTo: user.organization.name → lookup org IDs → filter by organizationId
 * - hasMany: organization.departments.name → lookup dept orgIds → filter by id
 * - manyToMany: user.roles.name → lookup junction → filter by id
 * - Deep nesting: user.department.organization.country → chained lookups
 */

import type { Document, Filter } from "mongodb";
import type { SchemaRegistry } from "forja-core/schema";
import type { SchemaDefinition } from "forja-types/core/schema";
import type { MongoClient } from "./mongo-client";

/**
 * A relation filter extracted from WHERE clause.
 * Instead of being applied directly to the filter (which doesn't work
 * in MongoDB for cross-collection relations), these are resolved
 * into ID lists via lookup queries.
 */
export interface RelationFilter {
	readonly relationName: string;
	readonly conditions: Filter<Document>;
}

/**
 * Resolve relation-based WHERE conditions into concrete ID filters.
 *
 * Extracts relation fields from the filter, performs lookup queries
 * to find matching parent IDs, and replaces relation conditions
 * with {field: {$in: [matchedIds]}}.
 *
 * @returns Cleaned filter with relation conditions resolved to ID filters
 */
export async function resolveNestedWhere(
	filter: Filter<Document>,
	tableName: string,
	client: MongoClient,
	schemaRegistry: SchemaRegistry,
): Promise<Filter<Document>> {
	const modelName = schemaRegistry.findModelByTableName(tableName);
	if (!modelName) return filter;
	const schema = schemaRegistry.get(modelName);
	if (!schema) return filter;

	const resolvedFilter: Record<string, unknown> = {};

	for (const [key, value] of Object.entries(filter)) {
		// Handle logical operators recursively
		if (key === "$and" || key === "$or") {
			const conditions = value as Filter<Document>[];
			const resolvedConditions: Filter<Document>[] = [];
			for (const condition of conditions) {
				const resolved = await resolveNestedWhere(
					condition,
					tableName,
					client,
					schemaRegistry,
				);
				resolvedConditions.push(resolved);
			}
			resolvedFilter[key] = resolvedConditions;
			continue;
		}

		if (key === "$nor") {
			const conditions = value as Filter<Document>[];
			const resolvedConditions: Filter<Document>[] = [];
			for (const condition of conditions) {
				const resolved = await resolveNestedWhere(
					condition,
					tableName,
					client,
					schemaRegistry,
				);
				resolvedConditions.push(resolved);
			}
			resolvedFilter[key] = resolvedConditions;
			continue;
		}

		// Check if this key is a relation field with nested conditions
		const field = schema.fields[key];
		if (field && field.type === "relation" && isNestedCondition(value)) {
			const relation = field as {
				kind: string;
				model: string;
				foreignKey?: string;
				through?: string;
			};

			const matchedIds = await resolveRelationIds(
				relation,
				schema,
				value as Filter<Document>,
				client,
				schemaRegistry,
			);

			// Determine which field to filter on based on relation kind
			if (relation.kind === "belongsTo") {
				// FK is on source table → filter source by FK in matched target IDs
				resolvedFilter[relation.foreignKey!] = { $in: matchedIds };
			} else if (relation.kind === "hasOne" || relation.kind === "hasMany") {
				// FK is on target table → matched IDs are source IDs
				resolvedFilter["id"] = mergeIdFilter(resolvedFilter["id"], matchedIds);
			} else if (relation.kind === "manyToMany") {
				// Junction table → matched IDs are source IDs
				resolvedFilter["id"] = mergeIdFilter(resolvedFilter["id"], matchedIds);
			}
			continue;
		}

		// Regular field — keep as-is
		resolvedFilter[key] = value;
	}

	return resolvedFilter as Filter<Document>;
}

/**
 * Resolve relation conditions to matching parent IDs.
 */
async function resolveRelationIds(
	relation: {
		readonly kind: string;
		readonly model: string;
		readonly foreignKey?: string;
		readonly through?: string;
	},
	sourceSchema: SchemaDefinition,
	conditions: Filter<Document>,
	client: MongoClient,
	schemaRegistry: SchemaRegistry,
): Promise<readonly number[]> {
	const targetSchema = schemaRegistry.get(relation.model);
	if (!targetSchema) return [];

	const targetCollection =
		targetSchema.tableName ?? relation.model.toLowerCase();

	// Recursively resolve any nested relation conditions in target
	const resolvedConditions = await resolveNestedWhere(
		conditions,
		targetCollection,
		client,
		schemaRegistry,
	);

	if (relation.kind === "belongsTo") {
		return resolveBelongsTo(targetCollection, resolvedConditions, client);
	}

	if (relation.kind === "hasOne" || relation.kind === "hasMany") {
		return resolveHasOneOrMany(
			targetCollection,
			relation.foreignKey!,
			resolvedConditions,
			client,
		);
	}

	if (relation.kind === "manyToMany") {
		return resolveManyToMany(
			targetCollection,
			relation.through!,
			sourceSchema.name,
			relation.model,
			resolvedConditions,
			client,
		);
	}

	return [];
}

/**
 * BelongsTo: find target IDs that match conditions.
 * Caller will filter source by FK $in these IDs.
 */
async function resolveBelongsTo(
	targetCollection: string,
	conditions: Filter<Document>,
	client: MongoClient,
): Promise<readonly number[]> {
	const col = client.getCollection(targetCollection);
	const sessionOpts = client.sessionOptions();

	const docs = await client.execute(`nestedWhere:${targetCollection}`, () =>
		col
			.find(conditions, {
				...sessionOpts,
				projection: { _id: 0, id: 1 },
			})
			.toArray(),
	);

	return docs.map((d) => d["id"] as number);
}

/**
 * HasOne/HasMany: find FK values in target that match conditions.
 * These FK values are the source IDs.
 */
async function resolveHasOneOrMany(
	targetCollection: string,
	foreignKey: string,
	conditions: Filter<Document>,
	client: MongoClient,
): Promise<readonly number[]> {
	const col = client.getCollection(targetCollection);
	const sessionOpts = client.sessionOptions();

	const docs = await client.execute(`nestedWhere:${targetCollection}`, () =>
		col
			.find(conditions, {
				...sessionOpts,
				projection: { _id: 0, [foreignKey]: 1 },
			})
			.toArray(),
	);

	const ids = new Set<number>();
	for (const doc of docs) {
		const fk = doc[foreignKey] as number | undefined;
		if (fk != null) ids.add(fk);
	}
	return [...ids];
}

/**
 * ManyToMany: find target IDs matching conditions,
 * then look up junction table to get source IDs.
 */
async function resolveManyToMany(
	targetCollection: string,
	junctionCollection: string,
	sourceModelName: string,
	targetModelName: string,
	conditions: Filter<Document>,
	client: MongoClient,
): Promise<readonly number[]> {
	const sourceFK = `${sourceModelName}Id`;
	const targetFK = `${targetModelName}Id`;

	// Step 1: find matching target IDs
	const targetCol = client.getCollection(targetCollection);
	const sessionOpts = client.sessionOptions();

	const targetDocs = await client.execute(
		`nestedWhere:${targetCollection}`,
		() =>
			targetCol
				.find(conditions, {
					...sessionOpts,
					projection: { _id: 0, id: 1 },
				})
				.toArray(),
	);

	const targetIds = targetDocs.map((d) => d["id"] as number);
	if (targetIds.length === 0) return [];

	// Step 2: find source IDs from junction
	const junctionCol = client.getCollection(junctionCollection);
	const junctionDocs = await client.execute(
		`nestedWhere:${junctionCollection}`,
		() =>
			junctionCol
				.find(
					{ [targetFK]: { $in: targetIds } },
					{ ...sessionOpts, projection: { _id: 0, [sourceFK]: 1 } },
				)
				.toArray(),
	);

	const sourceIds = new Set<number>();
	for (const doc of junctionDocs) {
		const fk = doc[sourceFK] as number | undefined;
		if (fk != null) sourceIds.add(fk);
	}
	return [...sourceIds];
}

/**
 * Logical operators that can appear as top-level keys in nested relation conditions.
 * These are NOT field-level comparison operators like $eq, $gt, etc.
 */
const LOGICAL_OPERATORS = new Set(["$and", "$or", "$nor", "$not"]);

/**
 * Check if a value looks like nested relation conditions
 * (object with field conditions, not a comparison operator or primitive)
 */
function isNestedCondition(value: unknown): boolean {
	if (
		typeof value !== "object" ||
		value === null ||
		Array.isArray(value) ||
		value instanceof Date
	) {
		return false;
	}
	const keys = Object.keys(value as Record<string, unknown>);
	if (keys.length === 0) return false;

	// If any key is a logical operator ($and, $or, etc.), this is a nested condition
	// because logical operators wrapping field conditions belong to the relation
	if (keys.some((k) => LOGICAL_OPERATORS.has(k))) return true;

	// If all keys start with $, it's field-level comparison operators ($eq, $gt, etc.)
	const allOperators = keys.every((k) => k.startsWith("$"));
	return !allOperators;
}

/**
 * Merge an $in ID filter when multiple relations resolve to the same "id" field.
 * Uses intersection so both conditions must be satisfied.
 */
function mergeIdFilter(
	existing: unknown,
	newIds: readonly number[],
): Record<string, unknown> {
	if (!existing) {
		return { $in: newIds };
	}

	// Intersect with existing $in
	const existingIn = (existing as { $in?: number[] }).$in;
	if (existingIn) {
		const newSet = new Set(newIds);
		const intersection = existingIn.filter((id) => newSet.has(id));
		return { $in: intersection };
	}

	return { $in: newIds };
}
