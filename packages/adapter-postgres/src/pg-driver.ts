import { Pool } from "pg";
import type { PoolClient } from "pg";
import type { PostgresCoreConfig, PgRunner, PgConnection } from "@datrix/adapter-postgres-core";
import type { PostgresConfig } from "./index";

class PgConnectionWrapper implements PgConnection {
	constructor(private readonly client: PoolClient) {}

	async query<T = Record<string, unknown>>(
		sql: string,
		params?: readonly unknown[],
	) {
		const result = await this.client.query<T & Record<string, unknown>>(
			sql,
			params as unknown[],
		);
		return { rows: result.rows as T[], rowCount: result.rowCount };
	}

	release() {
		this.client.release();
	}
}

class PgRunnerWrapper implements PgRunner {
	constructor(private readonly pool: Pool) {}

	async query<T = Record<string, unknown>>(
		sql: string,
		params?: readonly unknown[],
	) {
		const result = await this.pool.query<T & Record<string, unknown>>(
			sql,
			params as unknown[],
		);
		return { rows: result.rows as T[], rowCount: result.rowCount };
	}
}

export function createPgDriver(config: PostgresConfig): PostgresCoreConfig {
	const pool = new Pool({
		host: config.host,
		port: config.port,
		database: config.database,
		user: config.user,
		password: config.password,
		ssl: config.ssl,
		connectionTimeoutMillis: config.connectionTimeoutMillis ?? 5000,
		idleTimeoutMillis: config.idleTimeoutMillis ?? 30000,
		max: config.max ?? 10,
		min: config.min ?? 2,
		application_name: config.applicationName ?? "datrix",
	});

	const runner = new PgRunnerWrapper(pool);

	return {
		runner,

		async connect(): Promise<PgConnection> {
			const client = await pool.connect();
			return new PgConnectionWrapper(client);
		},

		async ping(): Promise<void> {
			const client = await pool.connect();
			client.release();
		},

		async end(): Promise<void> {
			await pool.end();
		},
	};
}
