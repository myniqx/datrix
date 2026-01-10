/**
 * Core Module
 *
 * Exports all core functionality: Forja singleton, schema, validation, query building, migrations, and configuration.
 */

// Re-export Forja singleton (main entry point)
export { Forja, getForja, initializeForja, ForjaError } from './forja';
export type { ForjaInitOptions } from './forja';

// Re-export schema system
export * from './schema';

// Re-export validator system
export * from './validator';

// Re-export query builder
export * from './query-builder';

// Re-export migration system
export * from './migration';

// Re-export config system (low-level utilities)
export * from './config';
