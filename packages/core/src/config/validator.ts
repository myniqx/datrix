/**
 * Config Validator
 *
 * Validates ForjaConfig structure and values
 */

import { ForjaConfig, MigrationConfig, DevConfig } from "forja-types/config";
import { isDatabaseAdapter } from "forja-types/adapter";
import { isForjaPlugin } from "forja-types/plugin";
import {
	throwConfigInvalidType,
	throwConfigEmpty,
	throwConfigArrayItem,
	throwConfigMultiple,
	throwConfigFieldType,
	throwConfigBooleanField,
	throwConfigStringField,
} from "./error-helper";

const isObject = (obj: unknown): boolean =>
	typeof obj === "object" && obj !== null;

/**
 * Validate ForjaConfig structure
 */
export function validateConfig(config: unknown): ForjaConfig {
	const errors: string[] = [];

	// 1. Check if object
	if (typeof config !== "object" || config === null) {
		throwConfigInvalidType("root", "object", config);
	}

	// 2. Validate adapter (required)
	if (!("adapter" in config)) {
		errors.push('Config must have "adapter" property');
	} else if (!isDatabaseAdapter(config["adapter"])) {
		errors.push(
			"Config.adapter must be a valid DatabaseAdapter instance (PostgresAdapter, MySQLAdapter, etc.)",
		);
	}

	// 3. Validate schemas (required)
	if (!("schemas" in config)) {
		errors.push('Config must have "schemas" property');
	} else {
		try {
			validateSchemas(config["schemas"]);
		} catch (error) {
			errors.push(`Config.schemas: ${(error as Error).message}`);
		}
	}

	// 4. Validate plugins (optional)
	if ("plugins" in config && config["plugins"] !== undefined) {
		try {
			validatePlugins(config["plugins"]);
		} catch (error) {
			errors.push(`Config.plugins: ${(error as Error).message}`);
		}
	}

	// 6. Validate migration config (optional)
	if ("migration" in config && config["migration"] !== undefined) {
		try {
			validateMigrationConfig(config["migration"]);
		} catch (error) {
			errors.push(`Config.migration: ${(error as Error).message}`);
		}
	}

	// 7. Validate dev config (optional)
	if ("dev" in config && config["dev"] !== undefined) {
		try {
			validateDevConfig(config["dev"]);
		} catch (error) {
			errors.push(`Config.dev: ${(error as Error).message}`);
		}
	}

	// Return validation result
	if (errors.length > 0) {
		throwConfigMultiple(errors);
	}

	return config as ForjaConfig;
}

/**
 * Validate schemas array
 */
function validateSchemas(schemas: unknown): void {
	if (!Array.isArray(schemas)) {
		throwConfigFieldType("schemas", "array", schemas);
	}

	if (schemas.length === 0) {
		throwConfigEmpty("schemas");
	}

	for (let i = 0; i < schemas.length; i++) {
		const schema = schemas[i];

		if (!isObject(schema)) {
			throwConfigArrayItem("schemas", i, "must be an object", schema);
		}

		if (!("name" in schema) || typeof schema["name"] !== "string") {
			throwConfigArrayItem(
				"schemas",
				i,
				'must have a "name" property (string)',
				schema,
			);
		}

		if (!("fields" in schema) || !isObject(schema["fields"])) {
			throwConfigArrayItem(
				"schemas",
				i,
				`(${schema["name"]}) must have a "fields" property (object)`,
				schema,
			);
		}
	}
}

/**
 * Validate plugins array
 */
function validatePlugins(plugins: unknown): void {
	if (!Array.isArray(plugins)) {
		throwConfigFieldType("plugins", "array", plugins);
	}

	for (let i = 0; i < plugins.length; i++) {
		const plugin = plugins[i];

		if (!isForjaPlugin(plugin)) {
			throwConfigArrayItem(
				"plugins",
				i,
				"must be a valid ForjaPlugin instance",
				plugin,
			);
		}
	}
}

/**
 * Validate migration config
 */
function validateMigrationConfig(migration: unknown): MigrationConfig {
	if (typeof migration !== "object" || migration === null) {
		throwConfigFieldType("migration", "object", migration);
	}

	// Validate auto
	if ("auto" in migration && typeof migration["auto"] !== "boolean") {
		throwConfigBooleanField("migration.auto", migration["auto"]);
	}

	// Validate directory
	if ("directory" in migration) {
		if (typeof migration["directory"] !== "string") {
			throwConfigStringField("migration.directory", migration["directory"]);
		}

		if ((migration["directory"] as string).trim() === "") {
			throwConfigEmpty("migration.directory");
		}
	}

	return migration as unknown as MigrationConfig;
}

/**
 * Validate dev config
 */
function validateDevConfig(dev: unknown): DevConfig {
	if (typeof dev !== "object" || dev === null) {
		throwConfigFieldType("dev", "object", dev);
	}

	// Validate logging
	if ("logging" in dev && typeof dev["logging"] !== "boolean") {
		throwConfigBooleanField("dev.logging", dev["logging"]);
	}

	// Validate validateQueries
	if ("validateQueries" in dev && typeof dev["validateQueries"] !== "boolean") {
		throwConfigBooleanField("dev.validateQueries", dev["validateQueries"]);
	}

	// Validate prettyErrors
	if ("prettyErrors" in dev && typeof dev["prettyErrors"] !== "boolean") {
		throwConfigBooleanField("dev.prettyErrors", dev["prettyErrors"]);
	}

	return dev as unknown as DevConfig;
}
