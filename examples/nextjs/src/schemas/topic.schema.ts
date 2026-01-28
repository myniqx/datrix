import { defineSchema } from 'forja-types/core/schema';

/**
 * Topic Schema
 */
export const topicSchema = defineSchema({
  name: 'topic',
  fields: {
    title: {
      type: 'string',
      required: true,
      minLength: 5,
    },
    content: {
      type: 'string',
      required: true,
    },
    // Relations
    author: {
      type: 'relation',
      model: 'user',
      kind: 'belongsTo',
      foreignKey: 'authorId',
      required: true,
    },
    comments: {
      type: 'relation',
      model: 'comment',
      kind: 'hasMany',
      foreignKey: 'topicId',
    },
    likes: {
      type: 'relation',
      model: 'like',
      kind: 'hasMany',
      foreignKey: 'topicId',
    },
  },
});
