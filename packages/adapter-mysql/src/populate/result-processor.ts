/**
 * MySQL Result Processor
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
	 * MySQL JSON_ARRAYAGG() and JSON_OBJECT() return JSON.
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
				adapter: "mysql",
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

			// Parse JSON if it's a string (MySQL may return JSON as string)
			if (typeof value === "string") {
				try {
					processed[relationName as keyof T] = JSON.parse(value) as T[keyof T];
				} catch {
					// Not JSON, leave as is
				}
			}

			// Detect the LEFT-JOIN-no-match case. When the object carries an
			// `id` key, decide by `id === null` alone — a row whose selected
			// fields all happen to be NULL is still a real row. Only fall back
			// to the all-fields-null heuristic when `id` was not selected.
			const relationValue = processed[relationName as keyof T];
			if (
				relationValue &&
				typeof relationValue === "object" &&
				!Array.isArray(relationValue)
			) {
				const relationObj = relationValue as Record<string, unknown>;
				if ("id" in relationObj) {
					if (relationObj["id"] === null) {
						processed[relationName as keyof T] = null as T[keyof T];
					}
				} else {
					const allFieldsNull = Object.values(relationObj).every(
						(v) => v === null || v === undefined,
					);
					if (allFieldsNull) {
						processed[relationName as keyof T] = null as T[keyof T];
					}
				}
			}

			// Handle nested populate recursively
			if (typeof options === "object" && options !== null && options.populate) {
				const currentValue = processed[relationName as keyof T];

				if (Array.isArray(currentValue)) {
					// hasMany or manyToMany: process each item
					processed[relationName as keyof T] = currentValue.map((item) =>
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
