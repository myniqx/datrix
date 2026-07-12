/**
 * PostgreSQL Result Processor
 *
 * Processes query results from populate operations.
 * Handles JSON parsing and nested structure creation.
 */

import type { QueryPopulate } from "@datrix/core";
import type { DatrixEntry } from "@datrix/core";
import { throwResultProcessingError } from "@datrix/core";

/**
 * Result Processor Class
 *
 * Processes flat SQL results into nested structures with populated relations.
 */
export class ResultProcessor {
	/**
	 * Process JSON aggregation results
	 *
	 * PostgreSQL json_agg() and row_to_json() return JSON strings.
	 * This method parses them and handles nested populate.
	 *
	 * @param rows - Raw rows from database
	 * @param populate - Populate clause
	 * @returns Processed rows with parsed JSON relations
	 */
	processJsonAggregation<T extends DatrixEntry>(
		rows: T[],
		populate: QueryPopulate<T>,
	): readonly T[] {
		if (rows.length === 0) {
			return rows;
		}

		try {
			return rows.map((row) => this.processRow(row, populate));
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
	 */
	private processRow<T extends DatrixEntry>(
		row: T,
		populate: QueryPopulate<T>,
	): T {
		const processed = { ...row };

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

			// Handle nested populate recursively
			if (typeof options === "object" && options !== null && options.populate) {
				const currentValue = processed[relationName as keyof T];

				if (Array.isArray(currentValue)) {
					// hasMany or manyToMany: process each item
					processed[relationName as keyof T] = currentValue.map((item: T) =>
						this.processRow(item, options.populate!),
					) as T[keyof T];
				} else if (currentValue !== null && typeof currentValue === "object") {
					// belongsTo or hasOne: process single item
					processed[relationName as keyof T] = this.processRow(
						currentValue as T,
						options.populate!,
					) as T[keyof T];
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
