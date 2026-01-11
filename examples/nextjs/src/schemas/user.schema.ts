import { defineSchema } from 'forja-types/core/schema';

/**
 * User Schema
 */
export const userSchema = defineSchema({
  name: 'user',
  timestamps: true,
  fields: {
    name: {
      type: 'string',
      required: true,
      minLength: 2,
    },
    email: {
      type: 'string',
      required: true,
      unique: true,
      validator: (val) => val.includes('@') || 'Invalid email address',
    },
    avatar: {
      type: 'string',
      required: false,
    },
    role: {
      type: 'enum',
      values: ['admin', 'moderator', 'user'] as const,
      default: 'user',
      required: true,
    },
    // Relations
    topics: {
      type: 'relation',
      model: 'topic',
      kind: 'hasMany',
      foreignKey: 'authorId',
    },
    comments: {
      type: 'relation',
      model: 'comment',
      kind: 'hasMany',
      foreignKey: 'authorId',
    },
    likes: {
      type: 'relation',
      model: 'like',
      kind: 'hasMany',
      foreignKey: 'userId',
    },
  },
});
