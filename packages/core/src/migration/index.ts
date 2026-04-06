/**
 * Migration System Entry Point
 *
 * Public API: Only MigrationSession is exported.
 * All internal components (differ, generator, history, runner) are not exported.
 *
 * Usage:
 *   const session = await datrix.beginMigrate();
 *   // ... review changes, resolve ambiguous ...
 *   await session.apply();
 */

// Public API
export { MigrationSession, createMigrationSession } from "./session";
export type {
	AmbiguousChange,
	AmbiguousAction,
	AmbiguousChangeType,
	AmbiguousActionType,
	MigrationPlan,
} from "./session";

// Internal - used by Datrix class only
export {
	getMigrationSchema,
	DEFAULT_MIGRATION_MODEL,
	getDatrixMetaSchema,
	FORJA_META_MODEL,
} from "./schema";
