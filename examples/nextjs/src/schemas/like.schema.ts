import { defineSchema, type DatrixEntry } from "@datrix/core";

interface LikeWithRelations extends DatrixEntry {
	topic?: { id: number; likesCount?: number } | null;
	comment?: { id: number; likesCount?: number } | null;
}

/**
 * Like Schema
 */
export const likeSchema = defineSchema({
	name: "like",
	fields: {
		// Relations
		user: {
			type: "relation",
			model: "user",
			kind: "belongsTo",
			foreignKey: "userId",
			required: true,
		},
		topic: {
			type: "relation",
			model: "topic",
			kind: "belongsTo",
			foreignKey: "topicId",
		},
		comment: {
			type: "relation",
			model: "comment",
			kind: "belongsTo",
			foreignKey: "commentId",
		},
	},
	hooks: {
		beforeCreate: (query) => {
			return {
				...query,
				populate: { ...query.populate, topic: true, comment: true },
			};
		},

		afterCreate: async (records, ctx) => {
			for (const like of records as LikeWithRelations[]) {
				if (like.topic) {
					await ctx.datrix.update("topic", like.topic.id, {
						likesCount: (like.topic.likesCount ?? 0) + 1,
					});
				}
				if (like.comment) {
					await ctx.datrix.update("comment", like.comment.id, {
						likesCount: (like.comment.likesCount ?? 0) + 1,
					});
				}
			}
			return records;
		},

		beforeDelete: (query) => {
			return {
				...query,
				populate: { ...query.populate, topic: true, comment: true },
			};
		},

		afterDelete: async (records, ctx) => {
			for (const like of records as LikeWithRelations[]) {
				if (like.topic) {
					await ctx.datrix.update("topic", like.topic.id, {
						likesCount: Math.max(0, (like.topic.likesCount ?? 0) - 1),
					});
				}
				if (like.comment) {
					await ctx.datrix.update("comment", like.comment.id, {
						likesCount: Math.max(0, (like.comment.likesCount ?? 0) - 1),
					});
				}
			}
		},
	},
});
