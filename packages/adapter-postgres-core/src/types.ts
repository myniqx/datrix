/**
 * PostgreSQL Adapter Types
 *
 * Type definitions specific to PostgreSQL adapter.
 */

import { QuerySelectObject } from "@datrix/core";
import { FieldDefinition, FieldType, DatrixEntry } from "@datrix/core";
import { PopulateStrategy } from "./populate";
import { QueryPopulate } from "@datrix/core";
import type { PgConnection, PgRunner } from "./driver";

export interface TranslateResult {
	readonly sql: string;
	readonly params: unknown[];
	readonly needAggregation: boolean;
}

/**
 * Driver supplied to the PostgreSQL adapter. Wraps the underlying
 * database client/pool the user wants to use (e.g. `pg`, `postgres.js`,
 * the Neon serverless driver). The adapter never imports `pg` directly.
 */
export interface PostgresCoreConfig {
	/** Pooled runner for non-transactional queries. */
	readonly runner: PgRunner;

	/** Acquire a dedicated connection for a transaction. */
	connect(): Promise<PgConnection>;

	/** Verify connectivity (used by adapter.connect()). */
	ping(): Promise<void>;

	/** Release all underlying resources (used by adapter.disconnect()). */
	end(): Promise<void>;
}

/**
 * PostgreSQL data types
 */
export type PostgresDataType =
	| "SMALLINT"
	| "INTEGER"
	| "BIGINT"
	| "DECIMAL"
	| "NUMERIC"
	| "REAL"
	| "DOUBLE PRECISION"
	| "SMALLSERIAL"
	| "SERIAL"
	| "BIGSERIAL"
	| "MONEY"
	| "CHAR"
	| "VARCHAR"
	| "TEXT"
	| "BYTEA"
	| "TIMESTAMP"
	| "TIMESTAMP WITH TIME ZONE"
	| "DATE"
	| "TIME"
	| "TIME WITH TIME ZONE"
	| "INTERVAL"
	| "BOOLEAN"
	| "POINT"
	| "LINE"
	| "LSEG"
	| "BOX"
	| "PATH"
	| "POLYGON"
	| "CIRCLE"
	| "INET"
	| "CIDR"
	| "MACADDR"
	| "UUID"
	| "JSON"
	| "JSONB"
	| "ARRAY"
	| "XML";

/**
 * Field type to PostgreSQL type mapping
 */
export const FIELD_TYPE_TO_POSTGRES: Record<FieldType, PostgresDataType> = {
	string: "TEXT",
	number: "DOUBLE PRECISION",
	boolean: "BOOLEAN",
	date: "TIMESTAMP WITH TIME ZONE",
	json: "JSONB",
	array: "JSONB", // Arrays stored as JSONB for flexibility
	enum: "VARCHAR",
	file: "TEXT", // File path/URL stored as text
	relation: "INTEGER", // Foreign key as integer
};

/**
 * Get PostgreSQL type for field type
 */
export function getPostgresType(fieldType: FieldType): PostgresDataType {
	return FIELD_TYPE_TO_POSTGRES[fieldType];
}

/**
 * Get PostgreSQL type with modifiers
 *
 * Accepts a full FieldDefinition to make accurate type decisions
 * (e.g. foreign key number fields become INTEGER instead of DOUBLE PRECISION).
 */
export function getPostgresTypeWithModifiers(field: FieldDefinition): string {
	// Foreign key columns must match the referenced column type (INTEGER)
	if (field.type === "number" && field.references) {
		return "INTEGER";
	}

	let pgType = getPostgresType(field.type);

	// Apply modifiers
	if (field.type === "string" && "maxLength" in field && field.maxLength) {
		pgType = "VARCHAR";
		return `${pgType}(${field.maxLength})`;
	}

	if (field.type === "number" && "precision" in field && field.precision) {
		pgType = "NUMERIC";
		if ("scale" in field && field.scale !== undefined) {
			return `${pgType}(${field.precision}, ${field.scale})`;
		}
		return `${pgType}(${field.precision})`;
	}

	if (field.type === "number" && "integer" in field && field.integer) {
		return "INTEGER";
	}

	// Handle arrays
	if ("array" in field && field.array) {
		return `${pgType}[]`;
	}

	return pgType;
}

export interface PostgresQueryObject<
	T extends DatrixEntry,
> extends QuerySelectObject<T> {
	_metadata?: {
		populateAggregations?: string | undefined;
		populateJoins?: string | undefined;
		populateStrategy?: PopulateStrategy | undefined;
		populateClause?: QueryPopulate<T> | undefined;
	};
}
