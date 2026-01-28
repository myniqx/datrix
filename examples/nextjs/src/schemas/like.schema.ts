import { defineSchema } from 'forja-types/core/schema';

/**
 * Like Schema
 */
export const likeSchema = defineSchema({
  name: 'like',
  fields: {
    // Relations
    user: {
      type: 'relation',
      model: 'user',
      kind: 'belongsTo',
      foreignKey: 'userId',
      required: true,
    },
    topic: {
      type: 'relation',
      model: 'topic',
      kind: 'belongsTo',
      foreignKey: 'topicId',
    },
    comment: {
      type: 'relation',
      model: 'comment',
      kind: 'belongsTo',
      foreignKey: 'commentId',
    },
  },
});
