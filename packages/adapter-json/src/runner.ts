import {
	WhereClause,
	FallbackOrderByItem,
	ComparisonOperators,
	QuerySelectObject,
	QuerySelect,
	QueryCountObject,
} from "forja-types/core/query-builder";
import {
	ForjaEntry,
	ForjaRecord,
	RelationField,
	SchemaDefinition,
} from "forja-types/core/schema";
import { JsonTableFile } from "./types";
import type { JsonAdapter } from "./adapter";
import {
	throwInvalidRelationWhereSyntax,
	throwInvalidWhereField,
} from "forja-types/errors/adapter/adapter-helpers";

export class JsonQueryRunner {
	private schema: SchemaDefinition | undefined;

	constructor(
		private table: JsonTableFile,
		private adapter: JsonAdapter,
		schema?: SchemaDefinition,
	) {
		this.schema = schema;
	}

	get tableData(): JsonTableFile {
		return this.table;
	}

	get tableSchema(): SchemaDefinition | undefined {
		return this.schema;
	}

	get adapterRef(): JsonAdapter {
		return this.adapter;
	}

	async run<T extends ForjaEntry = ForjaRecord>(
		query: QuerySelectObject<T> | QueryCountObject<T>,
	): Promise<Partial<T>[]> {
		let result = this.table.data as T[];

		// 1. Filter (async for nested relation WHERE support)
		if (query.where) {
			const matchResults = await Promise.all(
				result.map((item) => this.match(item, query.where!)),
			);
			result = result.filter((_, i) => matchResults[i]);
		} else if (
			query.type === "select" &&
			query.orderBy &&
			query.orderBy.length > 0
		) {
			// No filter but need sort - must copy to avoid mutating original
			result = [...result];
		}

		if (query.type === "count") {
			return result;
		}

		// 3. Project & Distinct
		if (query.select || query.distinct) {
			result = this.project(result, query.select, query.distinct) as T[];
		}

		// 4. Sort (mutates array in-place)
		if (query.orderBy && query.orderBy.length > 0) {
			result.sort((a, b) => this.sort(a as Record<string, unknown>, b as Record<string, unknown>, query.orderBy!));
		}

		// 5. Offset/Limit
		const offset = query.offset ?? 0;

		if (query.limit !== undefined) {
			result = result.slice(offset, offset + query.limit);
		} else if (offset > 0) {
			result = result.slice(offset);
		}

		return result;
	}

	/**
	 * Run query without projection (for populate workflow)
	 * Applies WHERE, ORDER BY, OFFSET, LIMIT but keeps all fields
	 */
	async filterAndSort<T extends ForjaEntry>(
		query: QuerySelectObject<T>,
	): Promise<T[]> {
		let result = this.table.data as T[];

		// 1. Filter (async for nested relation WHERE support)
		if (query.where) {
			const matchResults = await Promise.all(
				result.map((item) => this.match(item, query.where!)),
			);
			result = result.filter((_, i) => matchResults[i]);
		} else if (query.orderBy && query.orderBy.length > 0) {
			// No filter but need sort - must copy to avoid mutating original
			result = [...result];
		}

		// 2. Sort (mutates array in-place)
		if (query.orderBy && query.orderBy.length > 0) {
			result.sort((a, b) => this.sort(a as Record<string, unknown>, b as Record<string, unknown>, query.orderBy!));
		}

		// 3. Offset/Limit
		const offset = query.offset ?? 0;

		if (query.limit !== undefined) {
			result = result.slice(offset, offset + query.limit);
		} else if (offset > 0) {
			result = result.slice(offset);
		}

		return result;
	}

	// Exposed for Adapter's RETURNING clause usage
	public projectData<T extends ForjaEntry>(
		data: T[],
		select?: QuerySelect<T>,
		distinct?: boolean,
	): Partial<T>[] {
		return this.project(data, select, distinct);
	}

	private project<T extends ForjaEntry>(
		data: T[],
		select?: QuerySelect<T>,
		distinct?: boolean,
	): Partial<T>[] {
		let result: any[] = data;

		// Projection
		if (select && (select as unknown as string) !== "*") {
			result = data.map((item) => {
				const projected: any = {};
				for (const field of select) {
					projected[field] = item[field];
					if (projected[field] === undefined) {
						projected[field] = null;
					}
				}
				return projected;
			});
		}

		// Distinct
		if (distinct) {
			const seen = new Set<string>();
			result = result.filter((item) => {
				const key = JSON.stringify(item); // Simple serialization for distinct check
				if (seen.has(key)) return false;
				seen.add(key);
				return true;
			});
		}

		return result;
	}

	/**
	 * Match WHERE clause against an item
	 *
	 * **NEW:** Now supports nested relation WHERE queries!
	 *
	 * @param item - The record to match against
	 * @param where - WHERE clause (may contain nested relation conditions)
	 * @param overrideSchema - Optional schema to use instead of this.table.schema (for nested relation matching)
	 * @returns True if item matches all conditions
	 *
	 * @example
	 * ```ts
	 * // Simple WHERE
	 * await match(item, { price: { $gt: 10 } })
	 *
	 * // Nested relation WHERE
	 * await match(item, {
	 *   author: {  // Relation field
	 *     verified: { $eq: true }
	 *   }
	 * })
	 * ```
	 */
	private async match<T extends ForjaEntry>(
		item: any,
		where: WhereClause<T>,
		overrideSchema?: SchemaDefinition,
	): Promise<boolean> {
		const schema = overrideSchema ?? this.schema;

		for (const [key, value] of Object.entries(where)) {
			// Handle logical operators
			if (key === "$and") {
				const results = await Promise.all(
					(value as WhereClause<T>[]).map((cond) =>
						this.match(item, cond, schema),
					),
				);
				if (!results.every((r) => r)) return false;
				continue;
			}
			if (key === "$or") {
				const results = await Promise.all(
					(value as WhereClause<T>[]).map((cond) =>
						this.match(item, cond, schema),
					),
				);
				if (!results.some((r) => r)) return false;
				continue;
			}
			if (key === "$not") {
				if (await this.match(item, value as WhereClause<T>, schema))
					return false;
				continue;
			}

			// ✨ NEW: Check if this field is a RELATION
			const fieldDef = schema?.fields?.[key];
			if (fieldDef?.type === "relation") {
				// This is a nested relation WHERE!
				const matched = await this.matchRelation(
					item,
					key,
					value as WhereClause<T>,
					fieldDef,
				);
				if (!matched) {
					return false;
				}
				continue;
			}

			// Regular field matching (existing logic)
			// Validate that field exists in schema (catch typos and invalid fields)
			if (schema && !schema.fields[key]) {
				throwInvalidWhereField({
					adapter: "json",
					field: key,
					schemaName: schema.name,
					availableFields: Object.keys(schema.fields),
				});
			}

			const itemValue = item[key];

			if (value === null) {
				if (itemValue !== null && itemValue !== undefined) return false;
			} else if (
				typeof value === "object" &&
				!Array.isArray(value) &&
				!(value instanceof Date)
			) {
				// Check if this is a ComparisonOperators object or nested WHERE
				// If it has operator keys ($eq, $gt, etc.), it's operators
				const isOperators = Object.keys(value).some((k) => k.startsWith("$"));
				if (isOperators) {
					// Operators
					if (
						!this.matchOperators(itemValue, value as ComparisonOperators, key)
					)
						return false;
				} else {
					// Not operators and not a relation - treat as direct equality
					if (!this.compareValues(itemValue, value, key)) return false;
				}
			} else {
				// Direct equality - type-aware comparison
				if (!this.compareValues(itemValue, value, key)) return false;
			}
		}
		return true;
	}

	/**
	 * Match nested relation WHERE
	 *
	 * Loads the related record(s) and recursively matches the nested WHERE clause.
	 *
	 * @param item - Current record
	 * @param relationName - Name of the relation field
	 * @param relationWhere - Nested WHERE clause for the relation
	 * @param relationField - Relation field definition
	 * @returns True if relation matches
	 */
	private async matchRelation<T extends ForjaEntry>(
		item: any,
		relationName: string,
		relationWhere: WhereClause<T>,
		relationField: RelationField,
	): Promise<boolean> {
		const foreignKey = relationField.foreignKey!;
		const targetModelName = relationField.model;
		const kind = relationField.kind;

		// Validate: Ensure relationWhere is not using comparison operators directly
		// Valid:   { user: { id: { $eq: 1 } } }
		// Valid:   { user: { $and: [{ id: { $eq: 1 } }] } } (logical operator)
		// Invalid: { user: { $eq: 1 } } (comparison operator)
		if (typeof relationWhere === "object" && relationWhere !== null) {
			const keys = Object.keys(relationWhere);
			const logicalOps = new Set(["$and", "$or", "$not"]);
			const hasOnlyComparisonOperators =
				keys.length > 0 &&
				keys.every((k) => k.startsWith("$")) &&
				!keys.some((k) => logicalOps.has(k));

			if (hasOnlyComparisonOperators) {
				throwInvalidRelationWhereSyntax({
					adapter: "json",
					relationName,
					schemaName: this.schema?.name ?? "unknown",
					foreignKey,
				});
			}
		}

		// Get related ID(s) from current record
		if (kind === "belongsTo" || kind === "hasOne") {
			// Single relation - check FK value
			const relatedId = item[foreignKey];
			if (relatedId === null || relatedId === undefined) {
				// No relation - doesn't match
				return false;
			}

			// Get target schema for validation
			const targetSchema =
				await this.adapter.getSchemaByModelName(targetModelName);
			if (!targetSchema) {
				return false;
			}

			// Load related record
			const relatedRecord = await this.loadRelatedRecord(
				targetModelName,
				relatedId,
			);
			if (!relatedRecord) {
				return false;
			}

			// Recursively match nested WHERE on related record with target schema
			return await this.match(relatedRecord, relationWhere, targetSchema);
		}

		if (kind === "hasMany") {
			// Target table holds the FK pointing back to this record
			const sourceId = item["id"] as number | string | undefined;
			if (sourceId === null || sourceId === undefined) {
				return false;
			}

			const targetSchema =
				await this.adapter.getSchemaByModelName(targetModelName);
			if (!targetSchema) {
				return false;
			}

			// The FK stored in relationField may use the default naming (schemaName + "Id"),
			// but the actual column in the target table may have a different name (e.g. "authorId"
			// instead of "userId"). Find the real FK by looking at the target schema's belongsTo
			// field that references the current model.
			const currentModelName = this.schema?.name ?? "";
			const resolvedForeignKey = this.resolveForeignKeyInTarget(
				targetSchema,
				currentModelName,
				foreignKey,
			);

			const targetTable =
				targetSchema.tableName ?? targetModelName.toLowerCase();
			const targetTableData = await this.adapter.getCachedTable(targetTable);
			if (!targetTableData) {
				return false;
			}

			// Find any related record matching the nested WHERE
			const relatedRecords = (
				targetTableData.data as Record<string, unknown>[]
			).filter(
				(r) =>
					r[resolvedForeignKey] === sourceId ||
					r[resolvedForeignKey] === Number(sourceId),
			);

			for (const related of relatedRecords) {
				const matches = await this.match(related, relationWhere, targetSchema);
				if (matches) return true;
			}
			return false;
		}

		if (kind === "manyToMany") {
			// Junction table bridges this record and target records
			const junctionTableName = relationField.through;
			if (!junctionTableName) {
				return false;
			}

			const sourceId = item["id"] as number | string | undefined;
			if (sourceId === null || sourceId === undefined) {
				return false;
			}

			const junctionTableData =
				await this.adapter.getCachedTable(junctionTableName);
			if (!junctionTableData) {
				return false;
			}

			// Determine FK column names in junction table (e.g. userId, roleId)
			const currentModelName = this.schema?.name ?? "";
			const sourceFK = `${currentModelName}Id`;
			const targetFK = `${targetModelName}Id`;

			// Collect target IDs from junction rows matching this source
			const targetIds = (junctionTableData.data as Record<string, unknown>[])
				.filter((row) => {
					const rowSourceId = row[sourceFK];
					return rowSourceId === sourceId || rowSourceId === Number(sourceId);
				})
				.map((row) => {
					const rawId = row[targetFK];
					return typeof rawId === "string" ? Number(rawId) : (rawId as number);
				})
				.filter((id): id is number => id !== null && id !== undefined);

			if (targetIds.length === 0) {
				return false;
			}

			const targetSchema =
				await this.adapter.getSchemaByModelName(targetModelName);
			if (!targetSchema) {
				return false;
			}

			const targetTable =
				targetSchema.tableName ?? targetModelName.toLowerCase();
			const targetTableData = await this.adapter.getCachedTable(targetTable);
			if (!targetTableData) {
				return false;
			}

			// Check if any target record matches the nested WHERE
			const targetRecords = (
				targetTableData.data as Record<string, unknown>[]
			).filter((r) => targetIds.includes(r["id"] as number));

			for (const target of targetRecords) {
				const matches = await this.match(target, relationWhere, targetSchema);
				if (matches) return true;
			}
			return false;
		}

		return false;
	}

	/**
	 * Load a related record from adapter's cache
	 *
	 * Uses getCachedTable which reads from cache or disk if needed.
	 *
	 * @param modelName - Target model name
	 * @param id - Record ID to load
	 * @returns Related record or null
	 */
	private async loadRelatedRecord(
		modelName: string,
		id: string | number,
	): Promise<Record<string, unknown> | null> {
		try {
			// Get target schema from adapter (cache-aware, no Forja dependency)
			const targetSchema = await this.adapter.getSchemaByModelName(modelName);
			if (!targetSchema) {
				return null;
			}

			const targetTable = targetSchema.tableName ?? modelName.toLowerCase();

			// Get table data from adapter's cache (async - reads from disk if cache stale)
			const tableData = await this.adapter.getCachedTable(targetTable);
			if (!tableData) {
				return null;
			}

			// Find record by ID
			const relatedData = tableData.data as Record<string, unknown>[];
			const record = relatedData.find((r) => r["id"] === id);

			return record ?? null;
		} catch {
			return null;
		}
	}

	/**
	 * Resolve the actual FK column name in a target schema for a hasMany/hasOne relation.
	 *
	 * Registry generates a default FK using "sourceModelName + Id", but the target schema
	 * may have a belongsTo field with a custom FK name (e.g. "authorId" instead of "userId").
	 * This method finds the correct FK by scanning the target schema's belongsTo fields.
	 */
	private resolveForeignKeyInTarget(
		targetSchema: SchemaDefinition,
		sourceModelName: string,
		fallbackForeignKey: string,
	): string {
		for (const fieldDef of Object.values(targetSchema.fields)) {
			if (fieldDef.type !== "relation") continue;
			const rel = fieldDef as import("forja-types/core/schema").RelationField;
			if (rel.kind !== "belongsTo" && rel.kind !== "hasOne") continue;
			if (rel.model !== sourceModelName) continue;
			if (rel.foreignKey) return rel.foreignKey;
		}
		return fallbackForeignKey;
	}

	private compareValues(
		itemValue: any,
		queryValue: any,
		fieldName: string,
	): boolean {
		const schema = this.schema as any;
		const fieldDef = schema?.fields?.[fieldName];

		// No schema or field definition - use strict equality
		if (!fieldDef) {
			return itemValue === queryValue;
		}

		// Type coercion based on field type
		const fieldType = fieldDef.type;

		if (fieldType === "number") {
			const itemNum = Number(itemValue);
			const queryNum = Number(queryValue);
			return !isNaN(itemNum) && !isNaN(queryNum) && itemNum === queryNum;
		}

		if (fieldType === "string") {
			return String(itemValue) === String(queryValue);
		}

		if (fieldType === "boolean") {
			return Boolean(itemValue) === Boolean(queryValue);
		}

		// Default: strict equality
		return itemValue === queryValue;
	}

	private matchOperators(
		value: any,
		operators: ComparisonOperators,
		fieldName: string,
	): boolean {
		for (const [op, opValue] of Object.entries(operators)) {
			switch (op) {
				case "$eq":
					if (!this.compareValues(value, opValue, fieldName)) return false;
					break;
				case "$ne":
					if (this.compareValues(value, opValue, fieldName)) return false;
					break;
				case "$gt": {
					// NULL comparisons always return false (SQL behavior)
					if (value === null || value === undefined) return false;
					const coercedVal = this.coerceForComparison(value, fieldName);
					const coercedOp = this.coerceForComparison(opValue, fieldName);
					if (!((coercedVal as number) > (coercedOp as number))) return false;
					break;
				}
				case "$gte": {
					if (value === null || value === undefined) return false;
					const coercedVal = this.coerceForComparison(value, fieldName);
					const coercedOp = this.coerceForComparison(opValue, fieldName);
					if (!((coercedVal as number) >= (coercedOp as number))) return false;
					break;
				}
				case "$lt": {
					if (value === null || value === undefined) return false;
					const coercedVal = this.coerceForComparison(value, fieldName);
					const coercedOp = this.coerceForComparison(opValue, fieldName);
					if (!((coercedVal as number) < (coercedOp as number))) return false;
					break;
				}
				case "$lte": {
					if (value === null || value === undefined) return false;
					const coercedVal = this.coerceForComparison(value, fieldName);
					const coercedOp = this.coerceForComparison(opValue, fieldName);
					if (!((coercedVal as number) <= (coercedOp as number))) return false;
					break;
				}
				case "$in": {
					const coercedValue = this.coerceForComparison(value, fieldName);
					const coercedArray = (opValue as unknown[]).map((v) =>
						this.coerceForComparison(v, fieldName),
					);
					if (!coercedArray.includes(coercedValue)) return false;
					break;
				}
				case "$nin": {
					const coercedValue = this.coerceForComparison(value, fieldName);
					const coercedArray = (opValue as unknown[]).map((v) =>
						this.coerceForComparison(v, fieldName),
					);
					if (coercedArray.includes(coercedValue)) return false;
					break;
				}
				case "$exists":
					if (opValue && (value === undefined || value === null)) return false;
					if (!opValue && value !== undefined && value !== null) return false;
					break;
				case "$null":
					// Checks if value is null or undefined (no value)
					if (opValue && value !== null && value !== undefined) return false;
					if (!opValue && (value === null || value === undefined)) return false;
					break;
				case "$like":
				case "$ilike": {
					const pattern = (opValue as string)
						.replace(/%/g, ".*")
						.replace(/_/g, ".");
					const flags = op === "$ilike" ? "i" : "";
					const regex = new RegExp(`^${pattern}$`, flags);
					if (!regex.test(String(value ?? ""))) return false;
					break;
				}
				case "$contains":
					if (!String(value ?? "").includes(String(opValue))) return false;
					break;
				case "$notContains":
					if (String(value ?? "").includes(String(opValue))) return false;
					break;
				case "$startsWith":
					if (!String(value ?? "").startsWith(String(opValue))) return false;
					break;
				case "$endsWith":
					if (!String(value ?? "").endsWith(String(opValue))) return false;
					break;
				case "$notNull":
					// Checks if value is NOT null/undefined (has value)
					if (opValue && (value === null || value === undefined)) return false;
					if (!opValue && value !== null && value !== undefined) return false;
					break;
			}
		}
		return true;
	}

	private coerceForComparison(value: unknown, fieldName: string): unknown {
		// Preserve null/undefined as-is
		if (value === null || value === undefined) {
			return value;
		}

		const schema = this.schema as {
			fields?: Record<string, { type?: string }>;
		};
		const fieldDef = schema?.fields?.[fieldName];

		if (!fieldDef) return value;

		const fieldType = fieldDef.type;

		if (fieldType === "number") {
			const num = Number(value);
			return isNaN(num) ? value : num;
		}

		if (fieldType === "string") {
			return String(value);
		}

		return value;
	}

	private sort(
		a: Record<string, unknown>,
		b: Record<string, unknown>,
		orderBy: readonly FallbackOrderByItem[],
	): number {
		for (const order of orderBy) {
			const fieldName = order.field;
			const valA = this.coerceForComparison(a[fieldName], fieldName);
			const valB = this.coerceForComparison(b[fieldName], fieldName);

			if (valA === valB) continue;

			const direction = order.direction === "asc" ? 1 : -1;

			if (valA === null || valA === undefined)
				return order.nulls === "first" ? -1 : 1;
			if (valB === null || valB === undefined)
				return order.nulls === "first" ? 1 : -1;

			if (valA < valB) return -1 * direction;
			if (valA > valB) return 1 * direction;
		}
		return 0;
	}
}
