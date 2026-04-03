import { defineSchema, ForjaEntry } from "@forja/types/core/schema";
import type { PermissionContext } from "@forja/types/core/permission";
import { Forja } from "@forja/core";

/**
 * Test Roles Type
 *
 * Used for type-safe permission definitions
 */
type TestRoles = "admin" | "editor" | "user" | "guest";

/**
 * Test Schema: Category
 *
 * Parent schema for products
 *
 * Permissions:
 * - create: admin only
 * - read: everyone
 * - update: admin or editor
 * - delete: admin only
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
		description: {
			type: "string",
			maxLength: 500,
		},
		isActive: {
			type: "boolean",
			default: true,
		},
	},
	indexes: [{ fields: ["name"], unique: true }],
	permission: {
		create: ["admin"] as readonly TestRoles[],
		read: true,
		update: ["admin", "editor"] as readonly TestRoles[],
		delete: ["admin"] as readonly TestRoles[],
	},
} as const);

/**
 * Test Schema: Supplier
 *
 * Supplier information for products
 *
 * Permissions:
 * - create: admin or editor
 * - read: authenticated users only (function)
 * - update: admin or editor
 * - delete: admin only
 *
 * Field-level permissions:
 * - email: read only for admin/editor (stripped for others)
 * - rating: write only for admin
 */
export const supplierSchema = defineSchema({
	name: "supplier",
	fields: {
		name: {
			type: "string",
			required: true,
			minLength: 2,
			maxLength: 200,
		},
		email: {
			type: "string",
			required: true,
			pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
			permission: {
				read: ["admin", "editor"] as readonly TestRoles[],
			},
		},
		country: {
			type: "string",
			required: true,
		},
		rating: {
			type: "number",
			min: 0,
			max: 5,
			permission: {
				write: ["admin"] as readonly TestRoles[],
			},
		},
		isVerified: {
			type: "boolean",
			default: false,
		},
	},
	indexes: [{ fields: ["email"], unique: true }],
	permission: {
		create: ["admin", "editor"] as readonly TestRoles[],
		read: (ctx: PermissionContext) => ctx.user !== undefined,
		update: ["admin", "editor"] as readonly TestRoles[],
		delete: ["admin"] as readonly TestRoles[],
	},
} as const);

/**
 * Test Schema: Product
 *
 * Main product schema with relations to Category and Supplier
 *
 * Permissions:
 * - create: admin or editor
 * - read: everyone
 * - update: admin, editor, OR owner (mixed array)
 * - delete: admin only
 *
 * Field-level permissions:
 * - price: write only for admin/editor
 * - stock: read/write only for admin/editor
 */
export const productSchema = defineSchema({
	name: "product",
	fields: {
		name: {
			type: "string",
			required: true,
			minLength: 3,
			maxLength: 200,
		},
		description: {
			type: "string",
			maxLength: 1000,
		},
		price: {
			type: "number",
			required: true,
			min: 0,
			permission: {
				write: ["admin", "editor"] as readonly TestRoles[],
			},
		},
		stock: {
			type: "number",
			required: true,
			min: 0,
			default: 0,
			permission: {
				read: ["admin", "editor"] as readonly TestRoles[],
				write: ["admin", "editor"] as readonly TestRoles[],
			},
		},
		sku: {
			type: "string",
			required: true,
			pattern: /^[A-Z0-9-]+$/,
		},
		isAvailable: {
			type: "boolean",
			default: true,
		},
		tags: {
			type: "array",
			items: { type: "string" },
		},
		createdBy: {
			type: "string",
		},
		category: {
			type: "relation",
			kind: "belongsTo",
			model: "category",
		},
		supplier: {
			type: "relation",
			kind: "belongsTo",
			model: "supplier",
		},
	},
	indexes: [
		{ fields: ["sku"], unique: true },
		{ fields: ["categoryId"] },
		{ fields: ["supplierId"] },
		{ fields: ["price"] },
	],
	permission: {
		create: ["admin", "editor"] as readonly TestRoles[],
		read: true,
		update: [
			"admin" as TestRoles,
			"editor" as TestRoles,
			async (ctx: PermissionContext) => {
				const record = await (ctx.forja as Forja).findById<
					{ createdBy: string } & ForjaEntry
				>("product", ctx.id!);

				console.log(record);
				return ctx.user?.id.toString() === record?.["createdBy"];
			},
		],
		delete: ["admin"] as readonly TestRoles[],
	},
} as const);

/**
 * Test Schema: Secret
 *
 * Schema without explicit permissions - uses defaultPermission from API config
 * When auth is disabled, normal CRUD works
 * When auth is enabled, defaultPermission applies
 */
export const secretSchema = defineSchema({
	name: "secret",
	fields: {
		key: {
			type: "string",
			required: true,
		},
		value: {
			type: "string",
			required: true,
		},
	},
	// No permission defined - uses defaultPermission from API config
} as const);

/**
 * Test Schema: Public
 *
 * Fully public schema - all operations allowed
 */
export const publicSchema = defineSchema({
	name: "public",
	fields: {
		title: {
			type: "string",
			required: true,
		},
		content: {
			type: "string",
		},
	},
	permission: {
		create: true,
		read: true,
		update: true,
		delete: true,
	},
} as const);

/**
 * Test Schema: Restricted
 *
 * Admin-only schema - all operations require admin role
 */
export const restrictedSchema = defineSchema({
	name: "restricted",
	fields: {
		data: {
			type: "string",
			required: true,
		},
	},
	permission: {
		create: ["admin"] as readonly TestRoles[],
		read: ["admin"] as readonly TestRoles[],
		update: ["admin"] as readonly TestRoles[],
		delete: ["admin"] as readonly TestRoles[],
	},
} as const);

/**
 * Test Schema: User
 *
 * Required for authentication system.
 * Auth plugin creates separate 'authentication' table linked via userId.
 */
export const userSchema = defineSchema({
	name: "user",
	fields: {
		email: {
			type: "string",
			required: true,
		},
		name: {
			type: "string",
		},
		age: {
			type: "number",
		},
	},
	indexes: [{ fields: ["email"], unique: true }],
} as const);

/**
 * Test Schema: Post (ManyToMany Tests)
 *
 * Blog post with manyToMany relation to tags
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
		author: {
			type: "relation",
			kind: "belongsTo",
			model: "author",
		},
		tags: {
			type: "relation",
			kind: "manyToMany",
			model: "tag",
		},
	},
	permission: {
		create: true,
		read: true,
		update: true,
		delete: true,
	},
} as const);

/**
 * Test Schema: Tag (ManyToMany Tests)
 *
 * Tags that can be attached to multiple posts
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
 * Test Schema: Company (Nested Relation Tests)
 *
 * Company for nested create/update testing
 */
export const companySchema = defineSchema({
	name: "company",
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
	},
	permission: {
		create: true,
		read: true,
		update: true,
		delete: true,
	},
} as const);

/**
 * Test Schema: Author (ManyToMany Tests + Nested Relations)
 *
 * Post author (separate from user for testing)
 * Has relation to Company for nested create/update tests
 */
export const authorSchema = defineSchema({
	name: "author",
	fields: {
		name: {
			type: "string",
			required: true,
		},
		email: {
			type: "string",
			required: true,
			pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
		},
		company: {
			type: "relation",
			kind: "belongsTo",
			model: "company",
		},
	},
	indexes: [{ fields: ["email"], unique: true }],
	permission: {
		create: true,
		read: true,
		update: true,
		delete: true,
	},
} as const);

export const testSchemas = [
	categorySchema,
	supplierSchema,
	productSchema,
	secretSchema,
	publicSchema,
	restrictedSchema,
	userSchema,
	postSchema,
	tagSchema,
	authorSchema,
	companySchema,
];
