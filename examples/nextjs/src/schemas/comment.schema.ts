import { defineSchema } from "@datrix/core";

/**
 * Comment Schema
 */
export const commentSchema = defineSchema({
	name: "comment",
	fields: {
		content: {
			type: "string",
			required: true,
		},
		likesCount: {
			type: "number",
			default: 0,
		},
		// Relations
		author: {
			type: "relation",
			model: "user",
			kind: "belongsTo",
			foreignKey: "authorId",
			required: true,
		},
		topic: {
			type: "relation",
			model: "topic",
			kind: "belongsTo",
			foreignKey: "topicId",
			required: true,
		},
		parent: {
			type: "relation",
			model: "comment",
			kind: "belongsTo",
			foreignKey: "parentId",
		},
		replies: {
			type: "relation",
			model: "comment",
			kind: "hasMany",
			foreignKey: "parentId",
		},
		likes: {
			type: "relation",
			model: "like",
			kind: "hasMany",
			foreignKey: "commentId",
		},
	},
});
