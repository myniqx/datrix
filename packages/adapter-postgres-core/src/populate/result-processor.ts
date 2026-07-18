/**
 * PostgreSQL Result Processor
 *
 * Processes query results from populate operations.
 * Handles JSON parsing and nested structure creation.
 */

import type { QueryPopulate } from "@datrix/core";
import type { DatrixEntry, ISchemaRegistry } from "@datrix/core";
import { throwResultProcessingError } from "@datrix/core";
import { convertRowTypes, schemaNeedsConversion } from "../type-conversion";

/**
 * Result Processor Class
 *
 * Processes flat SQL results into nested structures with populated relations.
 */
export class ResultProcessor {
	constructor(private readonly schemaRegistry?: ISchemaRegistry) {}

	/**
	 * Process JSON aggregation results
	 *
	 * PostgreSQL json_agg() and row_to_json() return JSON strings.
	 * This method parses them and handles nested populate.
	 *
	 * @param rows - Raw rows from database
	 * @param populate - Populate clause
	 * @param tableName - Table name of `rows`, used to resolve the main
	 *   schema for Part 3 type conversion (date/number/json string coercion).
	 *   Optional so existing call sites without a table name keep working
	 *   (conversion is simply skipped in that case).
	 * @returns Processed rows with parsed JSON relations
	 */
	processJsonAggregation<T extends DatrixEntry>(
		rows: T[],
		populate: QueryPopulate<T>,
		tableName?: string,
	): readonly T[] {
		if (rows.length === 0) {
			return rows;
		}

		try {
			return rows.map((row) => this.processRow(row, populate, tableName));
		} catch (error) {
			throwResultProcessingError({
				adapter: "postgres",
				operation: "JSON aggregation parsing",
				cause: error instanceof Error ? error : undefined,
			});
		}
	}

	/**
	 * Process a single row
	 *
	 * @param tableName - Table name of `row`, used to resolve its schema for
	 *   Part 3 type conversion. Each recursive call resolves the TARGET
	 *   relation's table name so date/number/json fields inside populated
	 *   relations (which arrive as strings via row_to_json/jsonb_agg) are
	 *   coerced at every populate depth.
	 */
	private processRow<T extends DatrixEntry>(
		row: T,
		populate: QueryPopulate<T>,
		tableName?: string,
	): T {
		let processed = { ...row };

		const mainSchema = tableName
			? this.schemaRegistry?.getByTableName(tableName)?.schema
			: undefined;
		if (mainSchema && schemaNeedsConversion(mainSchema)) {
			processed = convertRowTypes(
				processed as unknown as Record<string, unknown>,
				mainSchema,
			) as T;
		}

		for (const [relationName, options] of Object.entries(populate)) {
			const value = processed[relationName as keyof T];

			// Skip if relation field doesn't exist or is already processed
			if (value === undefined) {
				continue;
			}

			// Parse JSON if it's a string
			if (typeof value === "string") {
				try {
					processed[relationName as keyof T] = JSON.parse(value) as T[keyof T];
				} catch {
					// Not JSON, leave as is
				}
			}

			// Check if the relation is a LEFT JOIN with no match.
			// If "id" was selected, it is never null for a real row, so decide by
			// id alone. Only fall back to the all-fields-null heuristic when "id"
			// was not selected (it would otherwise misclassify a legitimate row
			// whose selected fields are all null, e.g. select: ["bio"]).
			const relationValue = processed[relationName as keyof T];
			if (
				relationValue &&
				typeof relationValue === "object" &&
				!Array.isArray(relationValue)
			) {
				const isNoMatch =
					"id" in relationValue
						? (relationValue as Record<string, unknown>)["id"] === null
						: Object.values(relationValue).every(
								(v) => v === null || v === undefined,
							);
				if (isNoMatch) {
					processed[relationName as keyof T] = null as T[keyof T];
				}
			}

			// Resolve the relation's target table name (for both the type
			// conversion of the relation's own row, done in the recursive
			// processRow call below, and as a fallback when there is no nested
			// populate — the relation's scalar fields still need conversion).
			const relationTableName = this.resolveRelationTableName(
				tableName,
				relationName,
			);

			// Handle nested populate recursively
			if (typeof options === "object" && options !== null && options.populate) {
				const currentValue = processed[relationName as keyof T];

				if (Array.isArray(currentValue)) {
					// hasMany or manyToMany: process each item
					processed[relationName as keyof T] = currentValue.map((item: T) =>
						this.processRow(item, options.populate!, relationTableName),
					) as T[keyof T];
				} else if (currentValue !== null && typeof currentValue === "object") {
					// belongsTo or hasOne: process single item
					processed[relationName as keyof T] = this.processRow(
						currentValue as T,
						options.populate!,
						relationTableName,
					) as T[keyof T];
				}
			} else if (relationTableName) {
				// No nested populate, but the relation's own row/rows may still
				// contain string dates/numbers/json (row_to_json has no schema
				// awareness) — convert without recursing into further relations.
				const relationSchema =
					this.schemaRegistry?.getByTableName(relationTableName)?.schema;
				if (relationSchema && schemaNeedsConversion(relationSchema)) {
					const currentValue = processed[relationName as keyof T];
					if (Array.isArray(currentValue)) {
						processed[relationName as keyof T] = currentValue.map((item) =>
							item && typeof item === "object"
								? convertRowTypes(
										item as unknown as Record<string, unknown>,
										relationSchema,
									)
								: item,
						) as T[keyof T];
					} else if (
						currentValue !== null &&
						typeof currentValue === "object"
					) {
						processed[relationName as keyof T] = convertRowTypes(
							currentValue as unknown as Record<string, unknown>,
							relationSchema,
						) as T[keyof T];
					}
				}
			}

			// Clean up null values - convert to empty array for array relations
			const finalValue = processed[relationName as keyof T];
			if (finalValue === null || finalValue === undefined) {
				if (this.isArrayRelation(relationName, processed)) {
					processed[relationName as keyof T] = [] as T[keyof T];
				}
			}
		}

		return processed;
	}

	/**
	 * Resolve the target table name for a relation field, given the table
	 * name of the row that owns it. Returns undefined if the schema registry
	 * is not available, the owning table/schema can't be resolved, or the
	 * field isn't a relation.
	 */
	private resolveRelationTableName(
		tableName: string | undefined,
		relationName: string,
	): string | undefined {
		if (!tableName || !this.schemaRegistry) return undefined;

		const schema = this.schemaRegistry.getByTableName(tableName)?.schema;
		if (!schema) return undefined;

		const relationField = schema.fields[relationName];
		if (!relationField || relationField.type !== "relation") return undefined;

		const targetSchema = this.schemaRegistry.get(relationField.model);
		return targetSchema?.tableName ?? relationField.model.toLowerCase();
	}

	/**
	 * Check if relation is array type (hasMany or manyToMany)
	 */
	private isArrayRelation<T extends DatrixEntry>(
		relationName: string | keyof T,
		row: T,
	): boolean {
		const value = row[relationName as keyof T];

		if (Array.isArray(value)) {
			return true;
		}

		return false;
	}
}
