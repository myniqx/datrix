/**
 * MongoDB Adapter Helper Functions
 *
 * Standalone utilities: identifier validation, MongoDB error mapping,
 * and auto-increment counter management.
 */

import type { Collection, Document } from "mongodb";
import { throwQueryError } from "@forja/core/types/errors";
import { COUNTER_KEY_PREFIX } from "./types";

const VALID_IDENTIFIER_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * Validate a MongoDB identifier (collection name, field name).
 * MongoDB itself is lenient, but we enforce the same rules as SQL adapters
 * for consistency across all adapters.
 */
export function validateIdentifier(identifier: string): void {
	if (identifier === "*") return;

	if (!VALID_IDENTIFIER_PATTERN.test(identifier)) {
		throwQueryError({
			adapter: "mongodb",
			message: `Invalid identifier '${identifier}': must start with letter or underscore, contain only alphanumeric characters and underscores`,
		});
	}
}

/**
 * MongoDB error code to Forja adapter error code mapping.
 *
 * Common MongoDB server error codes:
 * - 11000: Duplicate key (unique index violation)
 * - 11001: Duplicate key on update
 */
const MONGO_ERROR_CODE_MAP: Record<number, string> = {
	11000: "ADAPTER_UNIQUE_CONSTRAINT",
	11001: "ADAPTER_UNIQUE_CONSTRAINT",
};

/**
 * Map MongoDB error code to Forja adapter error code
 */
export function mongoCodeToAdapterCode(mongoCode: number | undefined): string {
	if (mongoCode !== undefined && mongoCode in MONGO_ERROR_CODE_MAP) {
		return MONGO_ERROR_CODE_MAP[mongoCode]!;
	}
	return "ADAPTER_QUERY_ERROR";
}

/**
 * Get the next auto-increment ID for a collection.
 *
 * Uses atomic findOneAndUpdate with $inc on the _forja meta collection.
 * Key format: _counter_<collectionName>
 *
 * @param metaCollection - The _forja collection
 * @param collectionName - Target collection name
 * @param count - How many IDs to reserve (for bulk insert)
 * @returns The first reserved ID (caller uses firstId..firstId+count-1)
 */
export async function getNextIds(
	metaCollection: Collection<Document>,
	collectionName: string,
	count: number,
): Promise<number> {
	const counterKey = `${COUNTER_KEY_PREFIX}${collectionName}`;

	const result = await metaCollection.findOneAndUpdate(
		{ key: counterKey },
		{ $inc: { value: count } },
		{
			upsert: true,
			returnDocument: "after",
		},
	);

	if (!result) {
		throwQueryError({
			adapter: "mongodb",
			message: `Failed to generate auto-increment ID for collection '${collectionName}'`,
		});
	}

	const lastId = result!["value"] as number;
	// Return the first ID in the reserved range
	return lastId - count + 1;
}
