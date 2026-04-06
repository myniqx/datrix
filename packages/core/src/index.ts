/**
 * Core Module
 *
 * Exports all core functionality: Datrix singleton, schema, validation, query building, migrations, and configuration.
 */

// Re-export Datrix singleton (main entry point)
export { Datrix, defineConfig } from "./datrix";
export type { DatrixInitOptions, ConfigFactory } from "./datrix";

export * from "./types/core";
export * from "./types/adapter";
export * from "./types/api";
export * from "./types/cli";
export * from "./types/errors";
export * from "./types/utils";
export * from "./plugin/plugin";
export * from "./migration";
