import { ForjaEntry } from "forja-types";
import type { User } from "./user";
import type { Topic } from "./topic";
import type { Comment } from "./comment";

export interface Like extends ForjaEntry {
	user: User;
	userId: string;

	topic?: Topic;
	topicId?: string;

	comment?: Comment;
	commentId?: string;
}
