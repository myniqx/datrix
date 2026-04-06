import { DatrixEntry } from "datrix-types";
import type { User } from "./user";
import type { Topic } from "./topic";
import type { Comment } from "./comment";

export interface Like extends DatrixEntry {
	user: User;
	userId: string;

	topic?: Topic;
	topicId?: string;

	comment?: Comment;
	commentId?: string;
}
