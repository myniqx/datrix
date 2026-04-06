import { DatrixEntry } from "datrix-types";
import type { User } from "./user";
import type { Topic } from "./topic";
import type { Like } from "./like";

export interface Comment extends DatrixEntry {
	content: string;

	author: User;
	authorId: string;

	topic: Topic;
	topicId: string;

	parent?: Comment;
	parentId?: string;

	replies?: Comment[];
	likes?: Like[];
}
