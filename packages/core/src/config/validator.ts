/**
 * Config Validator
 *
 * Validates ForjaConfig structure and values
 */

import { Result } from "forja-types/utils";
import {
  ForjaConfig,
  ConfigError,
  ConfigValidationError,
  MigrationConfig,
  DevConfig,
} from "forja-types/config";
import { isDatabaseAdapter } from "forja-types/adapter";
import { isForjaPlugin } from "forja-types/plugin";

const isObject = (obj: unknown): boolean =>
  typeof obj === "object" && obj !== null;

/**
 * Validate ForjaConfig structure
 */
export function validateConfig(
  config: unknown,
): Result<ForjaConfig, ConfigError> {
  const errors: string[] = [];

  // 1. Check if object
  if (typeof config !== "object" || config === null) {
    return {
      success: false,
      error: new ConfigValidationError(["Config must be an object"]),
    };
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
    const schemasValidation = validateSchemas(config["schemas"]);
    if (!schemasValidation.success) {
      errors.push(schemasValidation.error.message);
    }
  }

  // 4. Validate plugins (optional)
  if ("plugins" in config && config["plugins"] !== undefined) {
    const pluginsValidation = validatePlugins(config["plugins"]);
    if (!pluginsValidation.success) {
      errors.push(pluginsValidation.error.message);
    }
  }

  // 6. Validate migration config (optional)
  if ("migration" in config && config["migration"] !== undefined) {
    const migrationValidation = validateMigrationConfig(config["migration"]);
    if (!migrationValidation.success) {
      errors.push(migrationValidation.error.message);
    }
  }

  // 7. Validate dev config (optional)
  if ("dev" in config && config["dev"] !== undefined) {
    const devValidation = validateDevConfig(config["dev"]);
    if (!devValidation.success) {
      errors.push(devValidation.error.message);
    }
  }

  // Return validation result
  if (errors.length > 0) {
    return {
      success: false,
      error: new ConfigValidationError(errors),
    };
  }

  return { success: true, data: config as unknown as ForjaConfig };
}

/**
 * Validate schemas array
 */
function validateSchemas(schemas: unknown): Result<void, ConfigError> {
  if (!Array.isArray(schemas)) {
    return {
      success: false,
      error: new ConfigError("Config.schemas must be an array"),
    };
  }

  if (schemas.length === 0) {
    return {
      success: false,
      error: new ConfigError(
        "Config.schemas cannot be empty. Add at least one schema.",
      ),
    };
  }

  for (let i = 0; i < schemas.length; i++) {
    const schema = schemas[i];

    if (!isObject(schema)) {
      return {
        success: false,
        error: new ConfigError(`Config.schemas[${i}] must be an object`),
      };
    }

    if (!("name" in schema) || typeof schema["name"] !== "string") {
      return {
        success: false,
        error: new ConfigError(
          `Config.schemas[${i}] must have a "name" property (string)`,
        ),
      };
    }

    if (!("fields" in schema) || !isObject(schema["fields"])) {
      return {
        success: false,
        error: new ConfigError(
          `Config.schemas[${i}] (${schema["name"]}) must have a "fields" property (object)`,
        ),
      };
    }
  }

  return { success: true, data: undefined };
}

/**
 * Validate plugins array
 */
function validatePlugins(plugins: unknown): Result<void, ConfigError> {
  if (!Array.isArray(plugins)) {
    return {
      success: false,
      error: new ConfigError("Config.plugins must be an array"),
    };
  }

  for (let i = 0; i < plugins.length; i++) {
    const plugin = plugins[i];

    if (!isForjaPlugin(plugin)) {
      return {
        success: false,
        error: new ConfigError(
          `Config.plugins[${i}] must be a valid ForjaPlugin instance`,
        ),
      };
    }
  }

  return { success: true, data: undefined };
}

/**
 * Validate migration config
 */
function validateMigrationConfig(
  migration: unknown,
): Result<MigrationConfig, ConfigError> {
  if (typeof migration !== "object" || migration === null) {
    return {
      success: false,
      error: new ConfigError("Config.migration must be an object"),
    };
  }

  // Validate auto
  if ("auto" in migration && typeof migration["auto"] !== "boolean") {
    return {
      success: false,
      error: new ConfigError("Config.migration.auto must be a boolean"),
    };
  }

  // Validate directory
  if ("directory" in migration) {
    if (typeof migration["directory"] !== "string") {
      return {
        success: false,
        error: new ConfigError("Config.migration.directory must be a string"),
      };
    }

    if ((migration["directory"] as string).trim() === "") {
      return {
        success: false,
        error: new ConfigError("Config.migration.directory cannot be empty"),
      };
    }
  }

  return { success: true, data: migration as unknown as MigrationConfig };
}

/**
 * Validate dev config
 */
function validateDevConfig(dev: unknown): Result<DevConfig, ConfigError> {
  if (typeof dev !== "object" || dev === null) {
    return {
      success: false,
      error: new ConfigError("Config.dev must be an object"),
    };
  }

  // Validate logging
  if ("logging" in dev && typeof dev["logging"] !== "boolean") {
    return {
      success: false,
      error: new ConfigError("Config.dev.logging must be a boolean"),
    };
  }

  // Validate validateQueries
  if ("validateQueries" in dev && typeof dev["validateQueries"] !== "boolean") {
    return {
      success: false,
      error: new ConfigError("Config.dev.validateQueries must be a boolean"),
    };
  }

  // Validate prettyErrors
  if ("prettyErrors" in dev && typeof dev["prettyErrors"] !== "boolean") {
    return {
      success: false,
      error: new ConfigError("Config.dev.prettyErrors must be a boolean"),
    };
  }

  return { success: true, data: dev as unknown as DevConfig };
}
