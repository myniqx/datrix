/**
 * PostgreSQL Adapter Types
 *
 * Type definitions specific to PostgreSQL adapter.
 */

import { QuerySelectObject } from "forja-types";
import {
	FieldDefinition,
	FieldType,
	ForjaEntry,
} from "forja-types/core/schema";
import { PopulateStrategy } from "./populate";
import { QueryPopulate } from "forja-types/core/query-builder";

export interface TranslateResult {
	readonly sql: string;
	readonly params: unknown[];
	readonly needAggregation: boolean;
}

/**
 * PostgreSQL connection configuration
 */
export interface PostgresConfig {
	readonly host: string;
	readonly port: number;
	readonly database: string;
	readonly user: string;
	readonly password: string;
	readonly ssl?:
		| boolean
		| {
				readonly rejectUnauthorized?: boolean;
				readonly ca?: string;
				readonly cert?: string;
				readonly key?: string;
		  };
	readonly connectionTimeoutMillis?: number;
	readonly idleTimeoutMillis?: number;
	readonly max?: number; // Maximum pool size
	readonly min?: number; // Minimum pool size
	readonly applicationName?: string;
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
 * PostgreSQL type to TypeScript type mapping
 */
export const POSTGRES_TO_TS_TYPE: Record<PostgresDataType, string> = {
	SMALLINT: "number",
	INTEGER: "number",
	BIGINT: "number",
	DECIMAL: "number",
	NUMERIC: "number",
	REAL: "number",
	"DOUBLE PRECISION": "number",
	SMALLSERIAL: "number",
	SERIAL: "number",
	BIGSERIAL: "number",
	MONEY: "number",
	CHAR: "string",
	VARCHAR: "string",
	TEXT: "string",
	BYTEA: "Uint8Array",
	TIMESTAMP: "Date",
	"TIMESTAMP WITH TIME ZONE": "Date",
	DATE: "Date",
	TIME: "string",
	"TIME WITH TIME ZONE": "string",
	INTERVAL: "string",
	BOOLEAN: "boolean",
	POINT: "string",
	LINE: "string",
	LSEG: "string",
	BOX: "string",
	PATH: "string",
	POLYGON: "string",
	CIRCLE: "string",
	INET: "string",
	CIDR: "string",
	MACADDR: "string",
	UUID: "string",
	JSON: "unknown",
	JSONB: "unknown",
	ARRAY: "unknown[]",
	XML: "string",
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

	// Handle arrays
	if ("array" in field && field.array) {
		return `${pgType}[]`;
	}

	return pgType;
}

/**
 * Convert value to PostgreSQL format
 */
export function toPostgresValue(value: unknown, fieldType: FieldType): unknown {
	if (value === null || value === undefined) {
		return null;
	}

	switch (fieldType) {
		case "date":
			if (value instanceof Date) {
				return value;
			}
			if (typeof value === "string" || typeof value === "number") {
				return new Date(value);
			}
			return null;

		case "boolean":
			if (typeof value === "boolean") {
				return value;
			}
			if (typeof value === "string") {
				const lower = value.toLowerCase();
				if (lower === "true" || value === "1") {
					return true;
				}
				if (lower === "false" || value === "0") {
					return false;
				}
				// Other strings: use Boolean() conversion (truthy/falsy)
				return Boolean(value);
			}
			if (typeof value === "number") {
				return value !== 0;
			}
			return Boolean(value);

		case "number":
			if (typeof value === "number") {
				return value;
			}
			if (typeof value === "string") {
				// Empty string or whitespace-only should be null
				if (value.trim() === "") {
					return null;
				}
				const parsed = Number(value);
				return isNaN(parsed) ? null : parsed;
			}
			return null;

		case "json":
		case "array":
			// PostgreSQL JSONB handles objects and arrays natively
			return value;

		case "string":
		case "enum":
		case "file":
			return String(value);

		case "relation":
			// Foreign key - ensure it's a number or null
			if (typeof value === "number") {
				return value;
			}
			if (typeof value === "string") {
				const parsed = Number(value);
				return isNaN(parsed) ? null : parsed;
			}
			return null;

		default:
			return value;
	}
}

/**
 * Convert PostgreSQL value to TypeScript
 */
export function fromPostgresValue(
	value: unknown,
	fieldType: FieldType,
): unknown {
	if (value === null || value === undefined) {
		return null;
	}

	switch (fieldType) {
		case "date":
			// pg library automatically converts timestamps to Date objects
			return value instanceof Date ? value : new Date(String(value));

		case "boolean":
			return Boolean(value);

		case "number":
			return typeof value === "number" ? value : Number(value);

		case "json":
		case "array":
			// JSONB is automatically parsed by pg library
			return value;

		case "string":
		case "enum":
		case "file":
			return String(value);

		case "relation":
			return typeof value === "number" ? value : Number(value);

		default:
			return value;
	}
}

export interface PostgresQueryObject<
	T extends ForjaEntry,
> extends QuerySelectObject<T> {
	_metadata?: {
		populateAggregations?: string | undefined;
		populateJoins?: string | undefined;
		populateStrategy?: PopulateStrategy | undefined;
		populateClause?: QueryPopulate<T> | undefined;
	};
}
