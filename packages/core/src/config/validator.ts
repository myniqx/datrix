/**
 * Config Validator
 *
 * Validates ForjaConfig structure and values
 */

import { Result } from 'forja-types/utils';
import {
  ForjaConfig,
  ConfigError,
  ConfigValidationError,
  ApiConfig,
  MigrationConfig,
  DevConfig,
  SchemaConfig,
} from 'forja-types/config';
import { isDatabaseAdapter } from 'forja-types/adapter';
import { isForjaPlugin } from 'forja-types/plugin';
import { isObject } from './utils';

/**
 * Validate ForjaConfig structure
 */
export function validateConfig(
  config: unknown
): Result<ForjaConfig, ConfigError> {
  const errors: string[] = [];

  // 1. Check if object
  if (!isObject(config)) {
    return {
      success: false,
      error: new ConfigValidationError(['Config must be an object']),
    };
  }

  // 2. Validate adapter (required)
  if (!('adapter' in config)) {
    errors.push('Config must have "adapter" property');
  } else if (!isDatabaseAdapter(config['adapter'])) {
    errors.push(
      'Config.adapter must be a valid DatabaseAdapter instance (PostgresAdapter, MySQLAdapter, etc.)'
    );
  }

  // 3. Validate schemas (required)
  if (!('schemas' in config)) {
    errors.push('Config must have "schemas" property');
  } else {
    const schemasValidation = validateSchemasConfig(config['schemas']);
    if (!schemasValidation.success) {
      errors.push(schemasValidation.error.message);
    }
  }

  // 4. Validate plugins (optional)
  if ('plugins' in config && config['plugins'] !== undefined) {
    const pluginsValidation = validatePlugins(config['plugins']);
    if (!pluginsValidation.success) {
      errors.push(pluginsValidation.error.message);
    }
  }

  // 5. Validate API config (optional)
  if ('api' in config && config['api'] !== undefined) {
    const apiValidation = validateApiConfig(config['api']);
    if (!apiValidation.success) {
      errors.push(apiValidation.error.message);
    }
  }

  // 6. Validate migration config (optional)
  if ('migration' in config && config['migration'] !== undefined) {
    const migrationValidation = validateMigrationConfig(config['migration']);
    if (!migrationValidation.success) {
      errors.push(migrationValidation.error.message);
    }
  }

  // 7. Validate dev config (optional)
  if ('dev' in config && config['dev'] !== undefined) {
    const devValidation = validateDevConfig(config['dev']);
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
 * Validate schemas config
 */
function validateSchemasConfig(
  schemas: unknown
): Result<SchemaConfig, ConfigError> {
  if (!isObject(schemas)) {
    return {
      success: false,
      error: new ConfigError('Config.schemas must be an object'),
    };
  }

  if (!('path' in schemas)) {
    return {
      success: false,
      error: new ConfigError('Config.schemas must have "path" property'),
    };
  }

  if (typeof schemas['path'] !== 'string') {
    return {
      success: false,
      error: new ConfigError('Config.schemas.path must be a string'),
    };
  }

  if ((schemas['path'] as string).trim() === '') {
    return {
      success: false,
      error: new ConfigError('Config.schemas.path cannot be empty'),
    };
  }

  return { success: true, data: schemas as unknown as SchemaConfig };
}

/**
 * Validate plugins array
 */
function validatePlugins(plugins: unknown): Result<void, ConfigError> {
  if (!Array.isArray(plugins)) {
    return {
      success: false,
      error: new ConfigError('Config.plugins must be an array'),
    };
  }

  for (let i = 0; i < plugins.length; i++) {
    const plugin = plugins[i];

    if (!isForjaPlugin(plugin)) {
      return {
        success: false,
        error: new ConfigError(
          `Config.plugins[${i}] must be a valid ForjaPlugin instance`
        ),
      };
    }
  }

  return { success: true, data: undefined };
}

/**
 * Validate API config
 */
function validateApiConfig(api: unknown): Result<ApiConfig, ConfigError> {
  if (!isObject(api)) {
    return {
      success: false,
      error: new ConfigError('Config.api must be an object'),
    };
  }

  // Validate prefix
  if ('prefix' in api) {
    if (typeof api['prefix'] !== 'string') {
      return {
        success: false,
        error: new ConfigError('Config.api.prefix must be a string'),
      };
    }

    if (!(api['prefix'] as string).startsWith('/')) {
      return {
        success: false,
        error: new ConfigError('Config.api.prefix must start with "/"'),
      };
    }
  }

  // Validate defaultPageSize
  if ('defaultPageSize' in api) {
    if (typeof api['defaultPageSize'] !== 'number') {
      return {
        success: false,
        error: new ConfigError('Config.api.defaultPageSize must be a number'),
      };
    }

    if ((api['defaultPageSize'] as number) < 1) {
      return {
        success: false,
        error: new ConfigError('Config.api.defaultPageSize must be at least 1'),
      };
    }
  }

  // Validate maxPageSize
  if ('maxPageSize' in api) {
    if (typeof api['maxPageSize'] !== 'number') {
      return {
        success: false,
        error: new ConfigError('Config.api.maxPageSize must be a number'),
      };
    }

    if ((api['maxPageSize'] as number) < 1) {
      return {
        success: false,
        error: new ConfigError('Config.api.maxPageSize must be at least 1'),
      };
    }

    // Check if maxPageSize >= defaultPageSize
    if ('defaultPageSize' in api && typeof api['defaultPageSize'] === 'number') {
      if ((api['maxPageSize'] as number) < (api['defaultPageSize'] as number)) {
        return {
          success: false,
          error: new ConfigError(
            'Config.api.maxPageSize must be greater than or equal to defaultPageSize'
          ),
        };
      }
    }
  }

  // Validate maxPopulateDepth
  if ('maxPopulateDepth' in api) {
    if (typeof api['maxPopulateDepth'] !== 'number') {
      return {
        success: false,
        error: new ConfigError('Config.api.maxPopulateDepth must be a number'),
      };
    }

    if ((api['maxPopulateDepth'] as number) < 1) {
      return {
        success: false,
        error: new ConfigError(
          'Config.api.maxPopulateDepth must be at least 1'
        ),
      };
    }
  }

  return { success: true, data: api as unknown as ApiConfig };
}

/**
 * Validate migration config
 */
function validateMigrationConfig(
  migration: unknown
): Result<MigrationConfig, ConfigError> {
  if (!isObject(migration)) {
    return {
      success: false,
      error: new ConfigError('Config.migration must be an object'),
    };
  }

  // Validate auto
  if ('auto' in migration && typeof migration['auto'] !== 'boolean') {
    return {
      success: false,
      error: new ConfigError('Config.migration.auto must be a boolean'),
    };
  }

  // Validate directory
  if ('directory' in migration) {
    if (typeof migration['directory'] !== 'string') {
      return {
        success: false,
        error: new ConfigError('Config.migration.directory must be a string'),
      };
    }

    if ((migration['directory'] as string).trim() === '') {
      return {
        success: false,
        error: new ConfigError('Config.migration.directory cannot be empty'),
      };
    }
  }

  return { success: true, data: migration as unknown as MigrationConfig };
}

/**
 * Validate dev config
 */
function validateDevConfig(dev: unknown): Result<DevConfig, ConfigError> {
  if (!isObject(dev)) {
    return {
      success: false,
      error: new ConfigError('Config.dev must be an object'),
    };
  }

  // Validate logging
  if ('logging' in dev && typeof dev['logging'] !== 'boolean') {
    return {
      success: false,
      error: new ConfigError('Config.dev.logging must be a boolean'),
    };
  }

  // Validate validateQueries
  if ('validateQueries' in dev && typeof dev['validateQueries'] !== 'boolean') {
    return {
      success: false,
      error: new ConfigError('Config.dev.validateQueries must be a boolean'),
    };
  }

  // Validate prettyErrors
  if ('prettyErrors' in dev && typeof dev['prettyErrors'] !== 'boolean') {
    return {
      success: false,
      error: new ConfigError('Config.dev.prettyErrors must be a boolean'),
    };
  }

  return { success: true, data: dev as unknown as DevConfig };
}
