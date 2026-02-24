/**
 * Test Schemas for Core E2E Tests
 *
 * Complex schema set covering all relation types:
 * - belongsTo (N:1)
 * - hasMany (1:N)
 * - hasOne (1:1)
 * - manyToMany (N:N)
 * - Self-referencing (parent-child)
 */

import { defineSchema } from "forja-types/core/schema";
import type { FieldDefinition } from "forja-types";

// ============================================================================
// Schema Definitions
// ============================================================================

/**
 * Organization - Top level entity
 * Has many departments and users
 */
export const organizationSchema = defineSchema({
	name: "organization",
	fields: {
		name: {
			type: "string",
			required: true,
			minLength: 2,
			maxLength: 200,
		},
		country: {
			type: "string",
			required: true,
		},
		isActive: {
			type: "boolean",
			default: true,
		},
		departments: {
			type: "relation",
			kind: "hasMany",
			model: "department",
		},
		users: {
			type: "relation",
			kind: "hasMany",
			model: "user",
		},
	},
	indexes: [{ fields: ["name"], unique: true }],
	permission: {
		create: true,
		read: true,
		update: true,
		delete: true,
	},
} as const);

/**
 * Department - Belongs to Organization
 * Self-referencing for parent department
 */
export const departmentSchema = defineSchema({
	name: "department",
	fields: {
		name: {
			type: "string",
			required: true,
			minLength: 2,
			maxLength: 100,
		},
		code: {
			type: "string",
			required: true,
			pattern: /^[A-Z]{2,10}$/,
		},
		budget: {
			type: "number",
			min: 0,
		},
		organization: {
			type: "relation",
			kind: "belongsTo",
			model: "organization",
		},
		parent: {
			type: "relation",
			kind: "belongsTo",
			model: "department",
		},
	},
	indexes: [{ fields: ["code"], unique: true }, { fields: ["organizationId"] }],
	permission: {
		create: true,
		read: true,
		update: true,
		delete: true,
	},
} as const);

/**
 * Role - For user permissions
 * ManyToMany with User
 */
export const roleSchema = defineSchema({
	name: "role",
	fields: {
		name: {
			type: "string",
			required: true,
			minLength: 2,
			maxLength: 50,
		},
		description: {
			type: "string",
			maxLength: 500,
		},
		level: {
			type: "number",
			required: true,
			min: 1,
			max: 100,
		},
	},
	indexes: [{ fields: ["name"], unique: true }],
	permission: {
		create: true,
		read: true,
		update: true,
		delete: true,
	},
} as const);

/**
 * User - Central entity
 * BelongsTo Organization, Department
 * ManyToMany with Role
 */
export const userSchema = defineSchema({
	name: "user",
	fields: {
		email: {
			type: "string",
			required: true,
			pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
		},
		name: {
			type: "string",
			required: true,
			minLength: 2,
			maxLength: 100,
		},
		lastName: {
			type: "string",
		},
		age: {
			type: "number",
			min: 0,
			max: 150,
		},
		isActive: {
			type: "boolean",
			default: true,
		},
		metadata: {
			type: "json",
		},
		organization: {
			type: "relation",
			kind: "belongsTo",
			model: "organization",
		},
		department: {
			type: "relation",
			kind: "belongsTo",
			model: "department",
		},
		roles: {
			type: "relation",
			kind: "manyToMany",
			model: "role",
		},
		favoriteCategory: {
			type: "relation",
			kind: "hasOne",
			model: "category",
		},
		posts: {
			type: "relation",
			kind: "hasMany",
			model: "post",
		},
	},
	indexes: [
		{ fields: ["email"], unique: true },
		{ fields: ["organizationId"] },
		{ fields: ["departmentId"] },
	],
	permission: {
		create: true,
		read: true,
		update: true,
		delete: true,
	},
} as const);

/**
 * Profile - HasOne relationship with User (1:1)
 */
export const profileSchema = defineSchema({
	name: "profile",
	fields: {
		bio: {
			type: "string",
			maxLength: 1000,
		},
		website: {
			type: "string",
			maxLength: 255,
		},
		avatar: {
			type: "string",
			maxLength: 500,
		},
		user: {
			type: "relation",
			kind: "belongsTo",
			model: "user",
		},
	},
	indexes: [{ fields: ["userId"], unique: true }],
	permission: {
		create: true,
		read: true,
		update: true,
		delete: true,
	},
} as const);

/**
 * Category - Self-referencing for parent category
 */
export const categorySchema = defineSchema({
	name: "category",
	fields: {
		name: {
			type: "string",
			required: true,
			minLength: 2,
			maxLength: 100,
		},
		slug: {
			type: "string",
			required: true,
			pattern: /^[a-z0-9-]+$/,
		},
		description: {
			type: "string",
			maxLength: 500,
		},
		isActive: {
			type: "boolean",
			default: true,
		},
		parent: {
			type: "relation",
			kind: "belongsTo",
			model: "category",
		},
	},
	indexes: [{ fields: ["slug"], unique: true }, { fields: ["name"] }],
	permission: {
		create: true,
		read: true,
		update: true,
		delete: true,
	},
} as const);

/**
 * Tag - ManyToMany with Post
 */
export const tagSchema = defineSchema({
	name: "tag",
	fields: {
		name: {
			type: "string",
			required: true,
			minLength: 2,
			maxLength: 50,
		},
		color: {
			type: "string",
			pattern: /^#[0-9A-Fa-f]{6}$/,
		},
	},
	indexes: [{ fields: ["name"], unique: true }],
	permission: {
		create: true,
		read: true,
		update: true,
		delete: true,
	},
} as const);

/**
 * Post - Blog post
 * BelongsTo User, Category
 * ManyToMany with Tag
 */
export const postSchema = defineSchema({
	name: "post",
	fields: {
		title: {
			type: "string",
			required: true,
			minLength: 3,
			maxLength: 200,
		},
		content: {
			type: "string",
			required: true,
		},
		slug: {
			type: "string",
			required: true,
			pattern: /^[a-z0-9-]+$/,
		},
		isPublished: {
			type: "boolean",
			default: false,
		},
		viewCount: {
			type: "number",
			default: 0,
			min: 0,
		},
		author: {
			type: "relation",
			kind: "belongsTo",
			model: "user",
		},
		category: {
			type: "relation",
			kind: "belongsTo",
			model: "category",
		},
		tags: {
			type: "relation",
			kind: "manyToMany",
			model: "tag",
		},
		comments: {
			type: "relation",
			kind: "hasMany",
			model: "comment",
		},
	},
	indexes: [
		{ fields: ["slug"], unique: true },
		{ fields: ["authorId"] },
		{ fields: ["categoryId"] },
	],
	permission: {
		create: true,
		read: true,
		update: true,
		delete: true,
	},
} as const);

/**
 * Comment - BelongsTo Post, User
 * Self-referencing for replies
 */
export const commentSchema = defineSchema({
	name: "comment",
	fields: {
		content: {
			type: "string",
			required: true,
			minLength: 1,
			maxLength: 2000,
		},
		isApproved: {
			type: "boolean",
			default: false,
		},
		post: {
			type: "relation",
			kind: "belongsTo",
			model: "post",
		},
		author: {
			type: "relation",
			kind: "belongsTo",
			model: "user",
		},
		parent: {
			type: "relation",
			kind: "belongsTo",
			model: "comment",
		},
	},
	indexes: [{ fields: ["postId"] }, { fields: ["authorId"] }],
	permission: {
		create: true,
		read: true,
		update: true,
		delete: true,
	},
} as const);

// ============================================================================
// Schema Generator for Large Schemas (Performance Tests)
// ============================================================================

/**
 * Generate fake fields for large schema testing
 *
 * @param count - Number of fields to generate
 * @returns Record of field definitions
 */
export function generateFakeFields(
	count: number,
): Record<string, FieldDefinition> {
	const fields: Record<string, FieldDefinition> = {};
	const types = ["string", "number", "boolean"] as const;

	for (let i = 0; i < count; i++) {
		const typeIndex = i % types.length;
		const type = types[typeIndex];

		switch (type) {
			case "string":
				fields[`field_str_${i}`] = {
					type: "string",
					maxLength: 100 + i * 10,
				};
				break;
			case "number":
				fields[`field_num_${i}`] = {
					type: "number",
					min: 0,
					max: 1000 * (i + 1),
				};
				break;
			case "boolean":
				fields[`field_bool_${i}`] = {
					type: "boolean",
					default: i % 2 === 0,
				};
				break;
		}
	}

	return fields;
}

/**
 * Create a large schema with many fields for performance testing
 *
 * @param name - Schema name
 * @param extraFieldCount - Number of extra fields to add (default: 50)
 */
export function createLargeSchema(name: string, extraFieldCount = 50) {
	return defineSchema({
		name,
		fields: {
			title: {
				type: "string",
				required: true,
				minLength: 1,
				maxLength: 200,
			},
			description: {
				type: "string",
				maxLength: 1000,
			},
			isActive: {
				type: "boolean",
				default: true,
			},
			...generateFakeFields(extraFieldCount),
		},
		permission: {
			create: true,
			read: true,
			update: true,
			delete: true,
		},
	} as const);
}

// ============================================================================
// Export All Schemas
// ============================================================================

export const testSchemas = [
	organizationSchema,
	departmentSchema,
	roleSchema,
	userSchema,
	profileSchema,
	categorySchema,
	tagSchema,
	postSchema,
	commentSchema,
];
