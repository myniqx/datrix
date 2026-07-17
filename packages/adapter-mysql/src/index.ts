/**
 * Datrix MySQL Adapter
 *
 * MySQL/MariaDB adapter for Datrix framework.
 * Requires MySQL 8.0.16+ or MariaDB 10.5+ (window functions, JSON aggregation,
 * expression defaults, enforced CHECK constraints).
 *
 * @example
 * ```typescript
 * import { createMySQLAdapter } from '@datrix/adapter-mysql';
 *
 * // Using connection string
 * const adapter = createMySQLAdapter({
 *   connectionString: 'mysql://root:password@localhost:3306/mydb'
 * });
 *
 * // Using individual options
 * const adapter = createMySQLAdapter({
 *   host: 'localhost',
 *   port: 3306,
 *   user: 'root',
 *   password: 'password',
 *   database: 'mydb',
 *   connectionLimit: 20
 * });
 *
 * await adapter.connect();
 * ```
 */

export { MySQLAdapter, createMySQLAdapter } from "./adapter";
export type { MySQLConfig } from "./types";
