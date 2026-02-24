/**
 * Migration History Schema Definition
 *
 * Internal schema for tracking applied migrations.
 * This schema is automatically registered by Forja during initialization.
 */

import { defineSchema } from "forja-types/core/schema";

/**
 * Default model name for migration history
 */
export const DEFAULT_MIGRATION_MODEL = "_forja_migration";

/**
 * Get migration history schema definition
 *
 * @param modelName - Custom model name (default: '_forja_migration')
 * @returns Schema definition for migration history table
 */
export function getMigrationSchema(
	modelName: string = DEFAULT_MIGRATION_MODEL,
) {
	return defineSchema({
		name: modelName,

		fields: {
			name: {
				type: "string",
				required: true,
				maxLength: 255,
				description: "Migration name",
			},
			version: {
				type: "string",
				required: true,
				unique: true,
				maxLength: 255,
				description: "Migration version (timestamp-based)",
			},
			executionTime: {
				type: "number",
				required: true,
				min: 0,
				description: "Execution time in milliseconds",
			},
			status: {
				type: "enum",
				required: true,
				values: ["pending", "completed", "failed", "rolled_back"] as const,
				description: "Migration execution status",
			},
			checksum: {
				type: "string",
				maxLength: 64,
				description: "SHA-256 checksum of migration content",
			},
			error: {
				type: "string",
				description: "Error message if migration failed",
			},
			appliedAt: {
				type: "date",
				required: true,
				description: "When the migration was applied",
			},
		},

		indexes: [
			{ fields: ["version"], unique: true },
			{ fields: ["status"] },
			{ fields: ["appliedAt"] },
		],

		permission: {
			create: false,
			read: false,
			update: false,
			delete: false,
		},
	} as const);
}

/**
 * Migration history schema type
 */
export type MigrationHistorySchema = ReturnType<typeof getMigrationSchema>;

/**
 * Default model name for internal Forja metadata store
 */
export const FORJA_META_MODEL = "_forja";

/**
 * Get internal Forja metadata schema definition
 *
 * Stores per-table schema snapshots as JSON for migration diffing.
 * key: table name, value: full Forja SchemaDefinition as JSON string
 */
export function getForjaMetaSchema() {
	return defineSchema({
		name: FORJA_META_MODEL,
		tableName: FORJA_META_MODEL,

		fields: {
			key: {
				type: "string",
				required: true,
				unique: true,
				maxLength: 255,
				description: "Table name",
			},
			value: {
				type: "string",
				required: true,
				description: "Forja SchemaDefinition as JSON string",
			},
		},

		permission: {
			create: false,
			read: false,
			update: false,
			delete: false,
		},
	} as const);
}

/**
 * Forja metadata schema type
 */
export type ForjaMetaSchema = ReturnType<typeof getForjaMetaSchema>;
