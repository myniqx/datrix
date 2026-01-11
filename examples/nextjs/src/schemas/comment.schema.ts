import { defineSchema } from 'forja-types/core/schema';

/**
 * Comment Schema
 */
export const commentSchema = defineSchema({
  name: 'comment',
  timestamps: true,
  fields: {
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
    topic: {
      type: 'relation',
      model: 'topic',
      kind: 'belongsTo',
      foreignKey: 'topicId',
      required: true,
    },
  },
});
