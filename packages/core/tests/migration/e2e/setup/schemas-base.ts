/**
 * Base Schemas for Migration E2E Tests
 *
 * These schemas serve as starting points for migration tests.
 * Tests will clone and modify these as needed.
 */

import { defineSchema } from "@forja/types/core/schema";

/**
 * Table name constants for easy reference
 */
export const TABLE_NAMES = {
	user: "users",
	post: "posts",
	category: "categories",
	tag: "tags",
	profile: "profiles",
} as const;

/**
 * User schema - basic schema with common fields
 */
export const baseUserSchema = defineSchema({
	name: "user",
	tableName: TABLE_NAMES.user,
	fields: {
		email: { type: "string", required: true, unique: true },
		name: { type: "string", required: true },
		age: { type: "number" },
	},
	indexes: [{ fields: ["email"], unique: true }],
});

/**
 * Post schema - with relation to user
 */
export const basePostSchema = defineSchema({
	name: "post",
	tableName: TABLE_NAMES.post,
	fields: {
		title: { type: "string", required: true },
		content: { type: "string" },
		published: { type: "boolean", default: false },
		author: { type: "relation", kind: "belongsTo", model: "user" },
	},
});

/**
 * Category schema - simple schema for add/drop tests
 */
export const baseCategorySchema = defineSchema({
	name: "category",
	tableName: TABLE_NAMES.category,
	fields: {
		name: { type: "string", required: true },
		slug: { type: "string", required: true, unique: true },
	},
	indexes: [{ fields: ["slug"], unique: true }],
});

/**
 * Tag schema - for adding new table tests
 */
export const baseTagSchema = defineSchema({
	name: "tag",
	tableName: TABLE_NAMES.tag,
	fields: {
		name: { type: "string", required: true },
		color: { type: "string" },
	},
});

/**
 * Profile schema - for hasOne relation tests
 */
export const baseProfileSchema = defineSchema({
	name: "profile",
	tableName: "profiles",
	fields: {
		bio: { type: "string" },
		avatar: { type: "string" },
	},
});

/**
 * Post schema without author relation - for testing relation addition
 */
export const basePostSchemaNoRelation = defineSchema({
	name: "post",
	tableName: TABLE_NAMES.post,
	fields: {
		title: { type: "string", required: true },
		content: { type: "string" },
		published: { type: "boolean", default: false },
	},
});

/**
 * All base schemas
 */
export const allBaseSchemas = [
	baseUserSchema,
	basePostSchema,
	baseCategorySchema,
] as const;

/**
 * Clone a schema with modifications
 *
 * @param schema - Base schema to clone
 * @param modifications - Fields to add, remove, or modify
 * @returns Modified schema definition
 */
export function cloneSchema<T extends ReturnType<typeof defineSchema>>(
	schema: T,
	modifications: {
		name?: string;
		addFields?: Record<string, unknown>;
		removeFields?: string[];
		modifyFields?: Record<string, unknown>;
		addIndexes?: Array<{ fields: string[]; unique?: boolean }>;
		removeIndexes?: string[];
	},
): T {
	const cloned = JSON.parse(JSON.stringify(schema)) as T;

	// Rename
	if (modifications.name) {
		(cloned as { name: string }).name = modifications.name;
	}

	// Add fields
	if (modifications.addFields) {
		for (const [key, value] of Object.entries(modifications.addFields)) {
			(cloned.fields as Record<string, unknown>)[key] = value;
		}
	}

	// Remove fields
	if (modifications.removeFields) {
		for (const field of modifications.removeFields) {
			delete (cloned.fields as Record<string, unknown>)[field];
		}
	}

	// Modify fields
	if (modifications.modifyFields) {
		for (const [key, value] of Object.entries(modifications.modifyFields)) {
			(cloned.fields as Record<string, unknown>)[key] = value;
		}
	}

	// Add indexes
	if (modifications.addIndexes && cloned.indexes) {
		(cloned as { indexes: unknown[] }).indexes = [
			...cloned.indexes,
			...modifications.addIndexes,
		];
	}

	// Remove indexes (by field signature)
	if (modifications.removeIndexes && cloned.indexes) {
		(cloned as { indexes: unknown[] }).indexes = cloned.indexes.filter(
			(idx) => {
				const signature = (idx as { fields: string[] }).fields.join(",");
				return !modifications.removeIndexes!.includes(signature);
			},
		);
	}

	return cloned;
}
