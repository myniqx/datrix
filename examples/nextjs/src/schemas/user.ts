import { DatrixEntry } from "datrix-types";
import type { Topic } from "./topic";
import type { Comment } from "./comment";
import type { Like } from "./like";

export interface User extends DatrixEntry {
	name: string;
	email: string;
	avatar?: string;
	role: "admin" | "moderator" | "user";

	topics?: Topic[];
	comments?: Comment[];
	likes?: Like[];
}
