/**
 * MySQL Adapter Types
 *
 * Type definitions specific to MySQL adapter.
 */
import { FieldDefinition, FieldType, DatrixEntry } from "@datrix/core";
import { QueryPopulate, QuerySelectObject } from "@datrix/core";
import { PopulateStrategy } from "./populate/types";

/**
 * MySQL connection configuration
 */
export interface MySQLConfig {
	/**
	 * Connection string (mysql://user:pass@host:port/database)
	 * If provided, individual connection params are ignored
	 */
	readonly connectionString?: string;

	/**
	 * Database host
	 * @default 'localhost'
	 */
	readonly host?: string;

	/**
	 * Database port
	 * @default 3306
	 */
	readonly port?: number;

	/**
	 * Database name
	 */
	readonly database: string;

	/**
	 * Database user
	 */
	readonly user: string;

	/**
	 * Database password
	 */
	readonly password: string;

	/**
	 * SSL configuration
	 */
	readonly ssl?:
		| boolean
		| {
				readonly rejectUnauthorized?: boolean;
				readonly ca?: string;
				readonly cert?: string;
				readonly key?: string;
		  };

	/**
	 * Maximum number of connections in pool
	 * @default 10
	 */
	readonly connectionLimit?: number;

	/**
	 * Maximum number of connection requests to queue
	 * @default 0 (unlimited)
	 */
	readonly queueLimit?: number;

	/**
	 * Wait for connections when pool is exhausted
	 * @default true
	 */
	readonly waitForConnections?: boolean;

	/**
	 * Connection timeout in milliseconds
	 * @default 10000
	 */
	readonly connectTimeout?: number;

	/**
	 * Character set for the connection
	 * @default 'utf8mb4'
	 */
	readonly charset?: string;

	/**
	 * Timezone for the connection
	 * @default 'local'
	 */
	readonly timezone?: string;

	/**
	 * VARCHAR length used for `unique: true` string fields (columns and
	 * `indexes: [{ unique: true }]` entries) that don't set an explicit
	 * `maxLength`. MySQL forbids UNIQUE on a TEXT column without a key
	 * length; a field's own `maxLength` always takes precedence over this.
	 * @default 255
	 */
	readonly defaultUniqueVarcharLength?: number;
}

/**
 * MySQL data types
 */
type MySQLDataType =
	| "TINYINT"
	| "SMALLINT"
	| "MEDIUMINT"
	| "INT"
	| "BIGINT"
	| "DECIMAL"
	| "FLOAT"
	| "DOUBLE"
	| "BIT"
	| "CHAR"
	| "VARCHAR"
	| "TINYTEXT"
	| "TEXT"
	| "MEDIUMTEXT"
	| "LONGTEXT"
	| "BINARY"
	| "VARBINARY"
	| "TINYBLOB"
	| "BLOB"
	| "MEDIUMBLOB"
	| "LONGBLOB"
	| "DATE"
	| "TIME"
	| "DATETIME"
	| "TIMESTAMP"
	| "YEAR"
	| "BOOLEAN"
	| "JSON"
	| "ENUM"
	| "SET";

/**
 * Field type to MySQL type mapping
 */
const FIELD_TYPE_TO_MYSQL: Record<FieldType, MySQLDataType> = {
	string: "TEXT",
	number: "DOUBLE",
	boolean: "TINYINT",
	date: "DATETIME",
	json: "JSON",
	array: "JSON",
	enum: "VARCHAR",
	file: "TEXT",
	relation: "INT",
};

/**
 * Get MySQL type for field type
 */
function getMySQLType(fieldType: FieldType): MySQLDataType {
	return FIELD_TYPE_TO_MYSQL[fieldType];
}

/**
 * Get MySQL type with modifiers from FieldDefinition
 *
 * @param defaultUniqueVarcharLength - VARCHAR length to fall back to for a
 *   `unique: true` string field that has no explicit `maxLength` (MySQL
 *   forbids UNIQUE on TEXT without a key length). The field's own
 *   `maxLength` always wins when set.
 */
export function getMySQLTypeWithModifiers(
	field: FieldDefinition,
	defaultUniqueVarcharLength = 255,
): string {
	// Foreign key columns must match the referenced column type (INT)
	if (field.type === "number" && "references" in field && field.references) {
		return "INT";
	}

	let mysqlType = getMySQLType(field.type);

	if (field.type === "string" && "maxLength" in field && field.maxLength) {
		mysqlType = "VARCHAR";
		return `${mysqlType}(${field.maxLength})`;
	}

	if (field.type === "string" && "unique" in field && field.unique) {
		return `VARCHAR(${defaultUniqueVarcharLength})`;
	}

	if (field.type === "number" && "precision" in field && field.precision) {
		mysqlType = "DECIMAL";
		if ("scale" in field && field.scale !== undefined) {
			return `${mysqlType}(${field.precision}, ${field.scale})`;
		}
		return `${mysqlType}(${field.precision})`;
	}

	if (field.type === "boolean") {
		return "TINYINT(1)";
	}

	if (field.type === "date") {
		return "DATETIME(3)";
	}

	if (field.type === "enum") {
		return "VARCHAR(255)";
	}

	return mysqlType;
}

/**
 * Parse MySQL connection string
 */
export function parseConnectionString(
	connectionString: string,
): Partial<MySQLConfig> {
	const url = new URL(connectionString);

	const config: Record<string, unknown> = {
		host: url.hostname || "localhost",
		port: url.port ? parseInt(url.port, 10) : 3306,
		user: decodeURIComponent(url.username),
		password: decodeURIComponent(url.password),
		database: url.pathname.slice(1),
	};

	// Parse query parameters
	const params = url.searchParams;

	if (params.has("charset")) {
		config["charset"] = params.get("charset");
	}

	if (params.has("timezone")) {
		config["timezone"] = params.get("timezone");
	}

	if (params.has("connectionLimit")) {
		config["connectionLimit"] = parseInt(params.get("connectionLimit")!, 10);
	}

	if (params.has("connectTimeout")) {
		config["connectTimeout"] = parseInt(params.get("connectTimeout")!, 10);
	}

	if (params.has("ssl")) {
		const sslValue = params.get("ssl");
		config["ssl"] = sslValue === "true" || sslValue === "1";
	}

	return config as Partial<MySQLConfig>;
}

/**
 * MySQL translate result
 */
export interface TranslateResult {
	readonly sql: string;
	readonly params: unknown[];
}

/**
 * MySQL query object with metadata (extends QuerySelectObject since populate is only for SELECT)
 */
export interface MySQLQueryObject<
	T extends DatrixEntry,
> extends QuerySelectObject<T> {
	_metadata?: {
		populateAggregations?: string | undefined;
		populateJoins?: string | undefined;
		populateStrategy?: PopulateStrategy | undefined;
		populateClause?: QueryPopulate<T> | undefined;
	};
}
