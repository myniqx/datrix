import { defineSchema } from "forja-types/core/schema";
import type { PermissionContext } from "forja-types/core/permission";
import { RequestContext } from "forja-api";

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
    id: {
      type: "number",
      required: true,
      unique: true,
    },
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
    createdAt: {
      type: "date",
      default: () => new Date(),
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
    id: {
      type: "number",
      required: true,
      unique: true,
    },
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
    createdAt: {
      type: "date",
      default: () => new Date(),
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
    id: {
      type: "number",
      required: true,
      unique: true,
    },
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
    categoryId: {
      type: "number",
      required: true,
    },
    supplierId: {
      type: "number",
      required: true,
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
    createdAt: {
      type: "date",
      default: () => new Date(),
    },
    updatedAt: {
      type: "date",
      default: () => new Date(),
    },
    category: {
      type: "relation",
      kind: "belongsTo",
      model: "category",
      foreignKey: "categoryId",
    },
    supplier: {
      type: "relation",
      kind: "belongsTo",
      model: "supplier",
      foreignKey: "supplierId",
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
      async (ctx: RequestContext) => {
        const record = await ctx.forja.findById("product", ctx.id!);

        console.log(record);
        return ctx.user?.["id"] === record?.["createdBy"];
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
    id: {
      type: "number",
      required: true,
      unique: true,
    },
    key: {
      type: "string",
      required: true,
    },
    value: {
      type: "string",
      required: true,
    },
    createdAt: {
      type: "date",
      default: () => new Date(),
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
    id: {
      type: "number",
      required: true,
      unique: true,
    },
    title: {
      type: "string",
      required: true,
    },
    content: {
      type: "string",
    },
    createdAt: {
      type: "date",
      default: () => new Date(),
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
    id: {
      type: "number",
      required: true,
      unique: true,
    },
    data: {
      type: "string",
      required: true,
    },
    createdAt: {
      type: "date",
      default: () => new Date(),
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
    id: {
      type: "number",
      required: true,
      unique: true,
    },
    email: {
      type: "string",
      required: true,
    },
    name: {
      type: "string",
    },
    createdAt: {
      type: "date",
      default: () => new Date(),
    },
  },
  indexes: [{ fields: ["email"], unique: true }],
} as const);

export const testSchemas = [
  categorySchema,
  supplierSchema,
  productSchema,
  secretSchema,
  publicSchema,
  restrictedSchema,
  userSchema,
];
