import { AfterCommitCallback, IDatrix, IRawCrud } from "./interfaces";
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
	| "deleteMany"
	| "upsert"
	| "upsertMany";

/**
 * Query context passed to plugin and schema lifecycle hooks
 */
export interface QueryContext {
	readonly action: QueryAction;
	/** Global instance — queries through it run outside the current transaction. */
	readonly datrix: IDatrix;
	/** CRUD bound to the current session; joins the caller's transaction if any. */
	readonly crud: IRawCrud;
	readonly metadata: Record<string, unknown>;
	/** Deferred until the surrounding transaction commits; dropped on rollback. */
	afterCommit(callback: AfterCommitCallback): void;
	user?: AuthUser | undefined;
	/** Set before after-hooks run on create and upsert: ids of the records this query inserted. */
	createdIds?: ReadonlySet<number> | undefined;
}
