/**
 * Core Module
 *
 * Exports all core functionality: Forja singleton, schema, validation, query building, migrations, and configuration.
 */

// Re-export Forja singleton (main entry point)
export { Forja, defineConfig } from "./forja";
export type { ForjaInitOptions, ConfigFactory } from "./forja";

// Re-export schema system
export * from "./schema";

// Re-export validator system
export * from "./validator";

// Re-export query builder
export * from "./query-builder";

// Re-export migration system
export * from "./migration";
