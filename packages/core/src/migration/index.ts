/**
 * Migration System Entry Point
 *
 * Public API: Only MigrationSession is exported.
 * All internal components (differ, generator, history, runner) are not exported.
 *
 * Usage:
 *   const session = await forja.beginMigrate();
 *   // ... review changes, resolve ambiguous ...
 *   await session.apply();
 */

// Public API
export { MigrationSession, createMigrationSession } from "./session";
export type { AmbiguousChange, AmbiguousAction, MigrationPlan } from "./session";

// Internal - used by Forja class only
export { getMigrationSchema, DEFAULT_MIGRATION_MODEL } from "./schema";
