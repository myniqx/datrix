import { defineSchema } from 'forja-types/core/schema';

/**
 * Test Schema: Category
 *
 * Parent schema for products
 */
export const categorySchema = defineSchema({
  name: 'category',
  fields: {
    id: {
      type: 'number',
      required: true,
      unique: true,
    },
    name: {
      type: 'string',
      required: true,
      minLength: 2,
      maxLength: 100,
    },
    description: {
      type: 'string',
      maxLength: 500,
    },
    isActive: {
      type: 'boolean',
      default: true,
    },
    createdAt: {
      type: 'date',
      default: () => new Date(),
    },
  },
  indexes: [
    { fields: ['name'], unique: true },
  ],
} as const);

/**
 * Test Schema: Supplier
 *
 * Supplier information for products
 */
export const supplierSchema = defineSchema({
  name: 'supplier',
  fields: {
    id: {
      type: 'number',
      required: true,
      unique: true,
    },
    name: {
      type: 'string',
      required: true,
      minLength: 2,
      maxLength: 200,
    },
    email: {
      type: 'string',
      required: true,
      pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    },
    country: {
      type: 'string',
      required: true,
    },
    rating: {
      type: 'number',
      min: 0,
      max: 5,
    },
    isVerified: {
      type: 'boolean',
      default: false,
    },
    createdAt: {
      type: 'date',
      default: () => new Date(),
    },
  },
  indexes: [
    { fields: ['email'], unique: true },
  ],
} as const);

/**
 * Test Schema: Product
 *
 * Main product schema with relations to Category and Supplier
 */
export const productSchema = defineSchema({
  name: 'product',
  fields: {
    id: {
      type: 'number',
      required: true,
      unique: true,
    },
    name: {
      type: 'string',
      required: true,
      minLength: 3,
      maxLength: 200,
    },
    description: {
      type: 'string',
      maxLength: 1000,
    },
    price: {
      type: 'number',
      required: true,
      min: 0,
    },
    stock: {
      type: 'number',
      required: true,
      min: 0,
      default: 0,
    },
    categoryId: {
      type: 'number',
      required: true,
    },
    supplierId: {
      type: 'number',
      required: true,
    },
    sku: {
      type: 'string',
      required: true,
      pattern: /^[A-Z0-9-]+$/,
    },
    isAvailable: {
      type: 'boolean',
      default: true,
    },
    tags: {
      type: 'array',
      items: { type: 'string' },
    },
    createdAt: {
      type: 'date',
      default: () => new Date(),
    },
    updatedAt: {
      type: 'date',
      default: () => new Date(),
    },
    category: {
      type: 'relation',
      kind: 'belongsTo',
      model: 'category',
      foreignKey: 'categoryId',
    },
    supplier: {
      type: 'relation',
      kind: 'belongsTo',
      model: 'supplier',
      foreignKey: 'supplierId',
    },
  },
  indexes: [
    { fields: ['sku'], unique: true },
    { fields: ['categoryId'] },
    { fields: ['supplierId'] },
    { fields: ['price'] },
  ],
} as const);

export const testSchemas = [
  categorySchema,
  supplierSchema,
  productSchema,
];
