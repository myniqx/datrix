/**
 * PostgreSQL Adapter
 *
 * Thin wrapper around @datrix/adapter-postgres-core that wires up
 * a pg.Pool-based driver from a plain PostgresConfig object.
 */

import { PostgresCoreAdapter } from "@datrix/adapter-postgres-core";
import { createPgDriver } from "./pg-driver";

export {
	type PgRunner,
	type PgConnection,
	type PgQueryResult,
	type PostgresCoreConfig,
	PostgresCoreAdapter as PostgresAdapter,
} from "@datrix/adapter-postgres-core";

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
	readonly max?: number;
	readonly min?: number;
	readonly applicationName?: string;
}

export function createPostgresAdapter(
	config: PostgresConfig,
): PostgresCoreAdapter {
	return new PostgresCoreAdapter(createPgDriver(config));
}
