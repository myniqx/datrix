/**
 * MySQL Adapter Types
 *
 * Type definitions specific to MySQL adapter.
 */

import { FieldType } from "forja-types/core/schema";

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
  readonly ssl?: boolean | {
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
}

/**
 * MySQL data types
 */
export type MySQLDataType =
  | 'TINYINT'
  | 'SMALLINT'
  | 'MEDIUMINT'
  | 'INT'
  | 'BIGINT'
  | 'DECIMAL'
  | 'FLOAT'
  | 'DOUBLE'
  | 'BIT'
  | 'CHAR'
  | 'VARCHAR'
  | 'TINYTEXT'
  | 'TEXT'
  | 'MEDIUMTEXT'
  | 'LONGTEXT'
  | 'BINARY'
  | 'VARBINARY'
  | 'TINYBLOB'
  | 'BLOB'
  | 'MEDIUMBLOB'
  | 'LONGBLOB'
  | 'DATE'
  | 'TIME'
  | 'DATETIME'
  | 'TIMESTAMP'
  | 'YEAR'
  | 'BOOLEAN'
  | 'JSON'
  | 'ENUM'
  | 'SET';

/**
 * Field type to MySQL type mapping
 */
export const FIELD_TYPE_TO_MYSQL: Record<FieldType, MySQLDataType> = {
  string: 'TEXT',
  number: 'DOUBLE',
  boolean: 'TINYINT',
  date: 'DATETIME',
  json: 'JSON',
  array: 'JSON',
  enum: 'VARCHAR',
  file: 'TEXT',
  relation: 'INT'
};

/**
 * MySQL type to TypeScript type mapping
 */
export const MYSQL_TO_TS_TYPE: Record<MySQLDataType, string> = {
  TINYINT: 'number',
  SMALLINT: 'number',
  MEDIUMINT: 'number',
  INT: 'number',
  BIGINT: 'number',
  DECIMAL: 'number',
  FLOAT: 'number',
  DOUBLE: 'number',
  BIT: 'number',
  CHAR: 'string',
  VARCHAR: 'string',
  TINYTEXT: 'string',
  TEXT: 'string',
  MEDIUMTEXT: 'string',
  LONGTEXT: 'string',
  BINARY: 'Uint8Array',
  VARBINARY: 'Uint8Array',
  TINYBLOB: 'Uint8Array',
  BLOB: 'Uint8Array',
  MEDIUMBLOB: 'Uint8Array',
  LONGBLOB: 'Uint8Array',
  DATE: 'Date',
  TIME: 'string',
  DATETIME: 'Date',
  TIMESTAMP: 'Date',
  YEAR: 'number',
  BOOLEAN: 'boolean',
  JSON: 'unknown',
  ENUM: 'string',
  SET: 'string'
};

/**
 * Get MySQL type for field type
 */
export function getMySQLType(fieldType: FieldType): MySQLDataType {
  return FIELD_TYPE_TO_MYSQL[fieldType];
}

/**
 * Get MySQL type with modifiers
 */
export function getMySQLTypeWithModifiers(
  fieldType: FieldType,
  options?: {
    maxLength?: number;
    precision?: number;
    scale?: number;
    unsigned?: boolean;
  }
): string {
  let mysqlType = getMySQLType(fieldType);

  if (fieldType === 'string' && options?.maxLength) {
    mysqlType = 'VARCHAR';
    return `${mysqlType}(${options.maxLength})`;
  }

  if (fieldType === 'number' && options?.precision) {
    mysqlType = 'DECIMAL';
    if (options.scale !== undefined) {
      return `${mysqlType}(${options.precision}, ${options.scale})`;
    }
    return `${mysqlType}(${options.precision})`;
  }

  if (fieldType === 'boolean') {
    return 'TINYINT(1)';
  }

  if (fieldType === 'enum') {
    return 'VARCHAR(255)';
  }

  if (options?.unsigned && ['TINYINT', 'SMALLINT', 'MEDIUMINT', 'INT', 'BIGINT'].includes(mysqlType)) {
    return `${mysqlType} UNSIGNED`;
  }

  return mysqlType;
}

/**
 * Convert value to MySQL format
 */
export function toMySQLValue(value: unknown, fieldType: FieldType): unknown {
  if (value === null || value === undefined) {
    return null;
  }

  switch (fieldType) {
    case 'date':
      if (value instanceof Date) {
        return value;
      }
      if (typeof value === 'string' || typeof value === 'number') {
        return new Date(value);
      }
      return null;

    case 'boolean':
      if (typeof value === 'boolean') {
        return value ? 1 : 0;
      }
      if (typeof value === 'string') {
        const lower = value.toLowerCase();
        if (lower === 'true' || value === '1') {
          return 1;
        }
        if (lower === 'false' || value === '0') {
          return 0;
        }
        return value ? 1 : 0;
      }
      if (typeof value === 'number') {
        return value !== 0 ? 1 : 0;
      }
      return value ? 1 : 0;

    case 'number':
      if (typeof value === 'number') {
        return value;
      }
      if (typeof value === 'string') {
        if (value.trim() === '') {
          return null;
        }
        const parsed = Number(value);
        return isNaN(parsed) ? null : parsed;
      }
      return null;

    case 'json':
    case 'array':
      if (typeof value === 'string') {
        return value;
      }
      return JSON.stringify(value);

    case 'string':
    case 'enum':
    case 'file':
      return String(value);

    case 'relation':
      if (typeof value === 'number') {
        return value;
      }
      if (typeof value === 'string') {
        const parsed = Number(value);
        return isNaN(parsed) ? null : parsed;
      }
      return null;

    default:
      return value;
  }
}

/**
 * Convert MySQL value to TypeScript
 */
export function fromMySQLValue(value: unknown, fieldType: FieldType): unknown {
  if (value === null || value === undefined) {
    return null;
  }

  switch (fieldType) {
    case 'date':
      return value instanceof Date ? value : new Date(String(value));

    case 'boolean':
      if (typeof value === 'number') {
        return value !== 0;
      }
      if (typeof value === 'boolean') {
        return value;
      }
      return Boolean(value);

    case 'number':
      return typeof value === 'number' ? value : Number(value);

    case 'json':
    case 'array':
      if (typeof value === 'string') {
        try {
          return JSON.parse(value);
        } catch {
          return value;
        }
      }
      return value;

    case 'string':
    case 'enum':
    case 'file':
      return String(value);

    case 'relation':
      return typeof value === 'number' ? value : Number(value);

    default:
      return value;
  }
}

/**
 * Parse MySQL connection string
 */
export function parseConnectionString(connectionString: string): Partial<MySQLConfig> {
  const url = new URL(connectionString);

  const config: Partial<MySQLConfig> = {
    host: url.hostname || 'localhost',
    port: url.port ? parseInt(url.port, 10) : 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.slice(1)
  };

  // Parse query parameters
  const params = url.searchParams;

  if (params.has('charset')) {
    (config as Record<string, unknown>).charset = params.get('charset');
  }

  if (params.has('timezone')) {
    (config as Record<string, unknown>).timezone = params.get('timezone');
  }

  if (params.has('connectionLimit')) {
    (config as Record<string, unknown>).connectionLimit = parseInt(params.get('connectionLimit')!, 10);
  }

  if (params.has('connectTimeout')) {
    (config as Record<string, unknown>).connectTimeout = parseInt(params.get('connectTimeout')!, 10);
  }

  if (params.has('ssl')) {
    const sslValue = params.get('ssl');
    (config as Record<string, unknown>).ssl = sslValue === 'true' || sslValue === '1';
  }

  return config;
}
