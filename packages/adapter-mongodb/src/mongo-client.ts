/**
 * MongoDB Client Wrapper
 *
 * Wraps MongoDB Db to provide:
 * - Automatic debug logging (non-production)
 * - Consistent error handling with DatrixAdapterError
 * - Unified interface for both normal and transaction (session) operations
 */

import type { ClientSession, Collection, Db, Document } from "mongodb";
import { DatrixAdapterError } from "@datrix/core";
import { mongoCodeToAdapterCode } from "./helpers";
import { DatrixEntry, QueryObject } from "@datrix/core";

const IS_DEBUG = process.env["NODE_ENV"] !== "production";

/**
 * Lightweight wrapper around MongoDB Db.
 *
 * Every operation passes through a single point that logs
 * in development and wraps MongoDB errors into DatrixAdapterError.
 */
export class MongoClient<T extends DatrixEntry> {
	constructor(
		private readonly db: Db,
		private readonly session: ClientSession | undefined,
		private readonly query: QueryObject<T>,
	) {}

	/**
	 * Get a collection handle with optional session
	 */
	getCollection<T extends Document = Document>(name: string): Collection<T> {
		return this.db.collection<T>(name);
	}

	/**
	 * Get the session (for passing to MongoDB operations)
	 */
	getSession(): ClientSession | undefined {
		return this.session;
	}

	/**
	 * Build options object with session included only when defined.
	 * Avoids exactOptionalPropertyTypes issues with MongoDB driver.
	 */
	sessionOptions(): { session: ClientSession } | Record<string, never> {
		return this.session ? { session: this.session } : {};
	}

	/**
	 * Log a MongoDB operation in debug mode
	 */
	log(operation: string, details?: Record<string, unknown>): void {
		if (IS_DEBUG) {
			console.log(
				"[MongoDB]",
				operation,
				`\nDetails: ${details ? JSON.stringify(details) : "(no details)"}`,
				`\nQuery: ${JSON.stringify(this.query)}`,
			);
		}
	}

	/**
	 * Wrap a MongoDB operation with error handling and logging.
	 * All MongoDB calls should go through this method.
	 */
	async execute<T>(
		operationName: string,
		fn: () => Promise<T>,
		context?: Record<string, unknown>,
	): Promise<T> {
		this.log(operationName, context);

		try {
			return await fn();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const mongoError = error as {
				code?: number;
				codeName?: string;
				errInfo?: Record<string, unknown>;
			};

			const adapterCode = mongoCodeToAdapterCode(mongoError.code) as
				| "ADAPTER_QUERY_ERROR"
				| "ADAPTER_UNIQUE_CONSTRAINT";

			throw new DatrixAdapterError(`Query failed: ${message}`, {
				adapter: "mongodb",
				code: adapterCode,
				operation: "query",
				context: {
					mongoOperation: operationName,
					...context,
					...(mongoError.code !== undefined && { mongoCode: mongoError.code }),
					...(mongoError.codeName && { mongoCodeName: mongoError.codeName }),
				},
				cause: error instanceof Error ? error : undefined,
			});
		}
	}
}
