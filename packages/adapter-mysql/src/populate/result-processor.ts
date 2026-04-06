/**
 * MySQL Result Processor
 *
 * Processes query results from populate operations.
 * Handles JSON parsing and nested structure creation.
 */

import type { QueryPopulate } from "@forja/core";
import type { ForjaEntry, ISchemaRegistry, RelationField } from "@forja/core";
import { throwResultProcessingError } from "@forja/core";

/**
 * Result Processor Class
 *
 * Processes flat SQL results into nested structures with populated relations.
 */
export class ResultProcessor {
	constructor(private schemaRegistry: ISchemaRegistry) {}

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
	processJsonAggregation<T extends ForjaEntry>(
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
	private processRow<T extends ForjaEntry>(
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

			// Check if all fields are null (LEFT JOIN with no match)
			// If so, set relation to null instead of keeping object with all null fields
			const relationValue = processed[relationName as keyof T];
			if (
				relationValue &&
				typeof relationValue === "object" &&
				!Array.isArray(relationValue)
			) {
				const allFieldsNull = Object.values(relationValue).every(
					(v) => v === null || v === undefined,
				);
				if (allFieldsNull) {
					processed[relationName as keyof T] = null as T[keyof T];
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
	 * Process flat JOIN results (fallback strategy)
	 *
	 * When using basic JOINs without aggregation, results come as flat rows.
	 * This method groups them by primary key and nests relations.
	 */
	processFlatJoinResults<T extends ForjaEntry>(
		rows: T[],
		tableName: string,
		populate: QueryPopulate<T>,
		primaryKey = "id" as keyof T,
	): readonly T[] {
		if (rows.length === 0) {
			return [] as readonly T[];
		}

		try {
			// Group rows by primary key
			const grouped = new Map<unknown, T>();

			for (const row of rows) {
				const pk = row[primaryKey];

				if (!grouped.has(pk)) {
					// First time seeing this primary key
					grouped.set(pk, this.extractMainRecord(row, tableName) as T);
				}

				const record = grouped.get(pk)!;

				// Attach relations
				this.attachRelations(record, row, tableName, populate);
			}

			return Array.from(grouped.values());
		} catch (error) {
			throwResultProcessingError({
				adapter: "mysql",
				operation: "flat JOIN result grouping",
				cause: error instanceof Error ? error : undefined,
			});
		}
	}

	/**
	 * Extract main record fields from flat row
	 */
	private extractMainRecord<T extends ForjaEntry>(
		row: T,
		tableName: string,
	): T {
		// Get schema to know which fields belong to main table
		const modelName = this.schemaRegistry.findModelByTableName(tableName);
		if (!modelName) {
			// Fallback: extract fields without relation prefixes
			const mainRecord: Record<string, unknown> = {};
			for (const [key, value] of Object.entries(row)) {
				if (!key.includes("_")) {
					mainRecord[key] = value;
				}
			}
			return mainRecord as T;
		}

		const schema = this.schemaRegistry.get(modelName);
		if (!schema) {
			return {} as T;
		}

		// Extract only main table fields
		const mainRecord: Record<string, unknown> = {};
		for (const [fieldName, fieldDef] of Object.entries(schema.fields)) {
			if (fieldDef.type !== "relation" && fieldName in row) {
				mainRecord[fieldName] = row[fieldName as keyof T];
			}
		}

		return mainRecord as T;
	}

	/**
	 * Attach relation data from flat row to main record
	 */
	private attachRelations<T extends ForjaEntry>(
		record: Partial<T>,
		row: T,
		tableName: string,
		populate: QueryPopulate<T>,
	): void {
		const modelName = this.schemaRegistry.findModelByTableName(tableName);
		if (!modelName) {
			return;
		}

		const schema = this.schemaRegistry.get(modelName);
		if (!schema) {
			return;
		}

		for (const [relationName, _options] of Object.entries(populate)) {
			const relationField = schema.fields[relationName] as
				| RelationField
				| undefined;
			if (!relationField || relationField.type !== "relation") {
				continue;
			}

			// Extract relation fields from flat row
			const relationData = this.extractRelationData(row, relationName);

			if (!relationData || Object.keys(relationData).length === 0) {
				continue;
			}

			const kind = relationField.kind;

			if (kind === "belongsTo" || kind === "hasOne") {
				// Single object
				record[relationName as keyof T] = relationData as T[keyof T];
			} else {
				// Array: hasMany or manyToMany
				if (!record[relationName as keyof T]) {
					record[relationName as keyof T] = [] as T[keyof T];
				}

				const arr = record[relationName as keyof T] as T[];

				// Check if this relation record already exists (by id)
				const existingIndex = arr.findIndex(
					(item) => item["id"] === relationData["id"],
				);

				if (existingIndex === -1) {
					arr.push(relationData as T);
				}
			}
		}
	}

	/**
	 * Extract relation fields from flat row
	 *
	 * Assumes relation fields are prefixed with `relationName_`
	 */
	private extractRelationData<T extends ForjaEntry>(
		row: T,
		relationName: string,
	): Partial<T> | null {
		const prefix = `${relationName}_`;
		const relationData: Partial<T> = {};

		for (const [key, value] of Object.entries(row)) {
			if (key.startsWith(prefix)) {
				const fieldName = key.substring(prefix.length);
				relationData[fieldName as keyof T] = value;
			}
		}

		// If all values are null, return null (no relation)
		const hasNonNullValue = Object.values(relationData).some(
			(v) => v !== null && v !== undefined,
		);

		return hasNonNullValue ? relationData : null;
	}

	/**
	 * Check if relation is array type (hasMany or manyToMany)
	 */
	private isArrayRelation<T extends ForjaEntry>(
		relationName: string | keyof T,
		row: T,
	): boolean {
		const value = row[relationName as keyof T];

		if (Array.isArray(value)) {
			return true;
		}

		return false;
	}

	/**
	 * Process LATERAL join results
	 *
	 * LATERAL joins return JSON in a specific column (e.g., `relation_data.data`)
	 */
	processLateralResults<T extends ForjaEntry>(
		rows: T[],
		populate: QueryPopulate<T>,
	): readonly T[] {
		if (rows.length === 0) {
			return rows;
		}

		try {
			return rows.map((row) => {
				const processed = { ...row };

				for (const relationName of Object.keys(populate)) {
					// LATERAL results come from `${relationName}_data.data`
					const lateralKey = `${relationName}_data`;

					if (lateralKey in processed) {
						const lateralData = processed[lateralKey as keyof T] as object;

						if (lateralData && "data" in lateralData) {
							processed[relationName as keyof T] = lateralData[
								"data"
							] as T[keyof T];
						}

						// Clean up the lateral key
						delete processed[lateralKey as keyof T];
					}
				}

				return processed;
			});
		} catch (error) {
			throwResultProcessingError({
				adapter: "mysql",
				operation: "LATERAL result processing",
				cause: error instanceof Error ? error : undefined,
			});
		}
	}
}
