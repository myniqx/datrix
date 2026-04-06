import { IForja } from "./forja";
import { AuthUser } from "../api";

/**
 * Query operation type
 */
export type QueryAction =
	| "findOne"
	| "findMany"
	| "count"
	| "create"
	| "createMany"
	| "update"
	| "updateMany"
	| "delete"
	| "deleteMany";

/**
 * Query context passed to plugin and schema lifecycle hooks
 */
export interface QueryContext {
	readonly action: QueryAction;
	readonly forja: IForja;
	readonly metadata: Record<string, unknown>;
	user?: AuthUser | undefined;
}
