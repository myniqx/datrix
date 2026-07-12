/**
 * Shared test helpers for adapter-postgres-core unit tests.
 *
 * These tests are unit-level: no real PostgreSQL connection is used. Instead
 * a fake `PgRunner`/`PgConnection` records the SQL/params passed to `query`
 * and returns pre-programmed results, so we can assert on generated SQL and
 * on call ordering (e.g. transaction begin/commit/rollback) without a DB.
 */
import type { ISchemaRegistry } from "@datrix/core";
import type { PgConnection, PgQueryResult, PgRunner } from "../src/driver";
import type { PostgresCoreConfig } from "../src/types";

export type QueryCall = {
	readonly sql: string;
	readonly params: readonly unknown[];
};

/**
 * A fake PgConnection/PgRunner that records every query call and resolves
 * with a caller-supplied handler. Also usable as the pooled `runner`.
 */
export class FakeConnection implements PgConnection {
	readonly calls: QueryCall[] = [];
	released = false;

	constructor(
		private readonly handler: (
			sql: string,
			params: readonly unknown[],
		) => PgQueryResult<any> | Promise<PgQueryResult<any>>,
	) {}

	async query<T = Record<string, unknown>>(
		sql: string,
		params: readonly unknown[] = [],
	): Promise<PgQueryResult<T>> {
		this.calls.push({ sql, params });
		return (await this.handler(sql, params)) as PgQueryResult<T>;
	}

	release(): void {
		this.released = true;
	}
}

export function emptyResult<T = Record<string, unknown>>(): PgQueryResult<T> {
	return { rows: [] as T[], rowCount: 0 };
}

export function rowsResult<T = Record<string, unknown>>(
	rows: T[],
): PgQueryResult<T> {
	return { rows, rowCount: rows.length };
}

/**
 * Build a minimal PostgresCoreConfig backed by a single FakeConnection used
 * both as the pooled runner and as the connection returned by `connect()`.
 */
export function createFakeConfig(
	handler: (
		sql: string,
		params: readonly unknown[],
	) => PgQueryResult<any> | Promise<PgQueryResult<any>>,
): {
	config: PostgresCoreConfig;
	connection: FakeConnection;
} {
	const connection = new FakeConnection(handler);
	const config: PostgresCoreConfig = {
		runner: connection,
		connect: async () => connection,
		ping: async () => {},
		end: async () => {},
	};
	return { config, connection };
}

/** Minimal fake schema registry — sufficient for translator methods that
 * don't need real schema lookups (e.g. escapeIdentifier). */
export function createFakeSchemaRegistry(): ISchemaRegistry {
	return {
		register: (schema) => schema,
		get: () => undefined,
		getWithTableName: () => undefined,
		getByTableName: () => undefined,
		has: () => false,
		getAll: () => [],
		getNames: () => [],
		size: 0,
	} as unknown as ISchemaRegistry;
}
