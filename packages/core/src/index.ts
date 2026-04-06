/**
 * Core Module
 *
 * Exports all core functionality: Forja singleton, schema, validation, query building, migrations, and configuration.
 */

// Re-export Forja singleton (main entry point)
export { Forja, defineConfig } from "./forja";
export type { ForjaInitOptions, ConfigFactory } from "./forja";

export * from "./types/core";
export * from "./types/adapter";
export * from "./types/api";
export * from "./types/cli";
export * from "./types/errors";
export * from "./types/utils";
export * from "./plugin/plugin";
export * from "./migration";
