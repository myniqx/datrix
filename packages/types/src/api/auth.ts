import { ForjaEntry } from "../core/schema";

export interface AuthenticatedUser<
	TRoles extends string = string,
	TUser extends ForjaEntry = ForjaEntry,
> extends ForjaEntry {
	user: TUser;
	email: string;
	password: string;
	passwordSalt: string;
	role: TRoles;
}
