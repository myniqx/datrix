/**
 * Forja MySQL Adapter
 *
 * MySQL/MariaDB adapter for Forja framework.
 * Supports MySQL 5.7+ and MariaDB 10.2+.
 *
 * @example
 * ```typescript
 * import { createMySQLAdapter } from '@forja/adapter-mysql';
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
