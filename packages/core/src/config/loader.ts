/**
 * Config Loader
 *
 * Loads and imports forja.config.ts/js files with hybrid TypeScript support.
 *
 * Loading Strategy (Hybrid Approach):
 * 1. Check for compiled JS first (fastest)
 * 2. If TS file exists but not compiled:
 *    a) Try to use tsx if available (optional dependency)
 *    b) If tsx not available, show helpful error message
 * 3. Support environment-specific configs (forja.config.dev.ts, etc.)
 */

import { Result } from 'forja-types/utils';
import {
  ForjaConfig,
  ConfigError,
  TypeScriptConfigError,
  LoadConfigOptions,
  hasDefaultExport,
} from 'forja-types/config';
import { validateConfig } from './validator';
import {
  resolveConfigPath,
  isTypeScriptFile,
  isJavaScriptFile,
  getCompiledPath,
  fileExists,
  hasTsx,
  importWithTsx,
  normalizeImportPath,
  getEnvironment,
  isObject,
} from './utils';

/**
 * Load Forja configuration
 *
 * Supports multiple file formats:
 * - TypeScript (.ts) - requires compilation or tsx
 * - JavaScript ESM (.js, .mjs)
 * - JavaScript CJS (.cjs)
 *
 * Environment-specific configs:
 * - forja.config.dev.ts/js (development)
 * - forja.config.prod.ts/js (production)
 * - forja.config.test.ts/js (test)
 * - forja.config.ts/js (fallback)
 *
 * @param options - Loading options
 * @returns Result with loaded and validated config
 *
 * @example
 * ```ts
 * const result = await loadConfig();
 * if (!result.success) {
 *   console.error(result.error.message);
 *   process.exit(1);
 * }
 * const config = result.data;
 * ```
 */
export async function loadConfig(
  options: LoadConfigOptions = {}
): Promise<Result<ForjaConfig, ConfigError>> {
  const {
    configPath = './forja.config.ts',
    environment = getEnvironment(),
    cwd = process.cwd(),
  } = options;

  try {
    // Step 1: Resolve config file path (handles environment-specific configs)
    const resolveResult = await resolveConfigPath(configPath, environment, cwd);
    if (!resolveResult.success) {
      return resolveResult;
    }

    const resolvedPath = resolveResult.data;

    // Step 2: Import config file (handles TS/JS with hybrid approach)
    const importResult = await importConfigFile(resolvedPath);
    if (!importResult.success) {
      return importResult;
    }

    const imported = importResult.data;

    // Step 3: Extract config from import (handle ESM default export)
    const config = extractConfig(imported);

    // Step 4: Validate config structure
    const validationResult = validateConfig(config);
    if (!validationResult.success) {
      return validationResult;
    }

    // Return validated config (no registry needed - Forja manages it)
    return { success: true, data: validationResult.data };
  } catch (error) {
    return {
      success: false,
      error: new ConfigError(
        `Failed to load config: ${error instanceof Error ? error.message : String(error)}`,
        { code: 'LOAD_FAILED', details: error }
      ),
    };
  }
}

/**
 * Import config file (Hybrid TS/JS support)
 *
 * Strategy:
 * 1. If JS file → direct import
 * 2. If TS file:
 *    a) Check if compiled JS exists → use compiled version
 *    b) Check if tsx available → use tsx
 *    c) Otherwise → throw TypeScriptConfigError
 */
async function importConfigFile(
  filePath: string
): Promise<Result<unknown, ConfigError>> {
  try {
    // Case 1: JavaScript file (direct import)
    if (isJavaScriptFile(filePath)) {
      const imported = await import(normalizeImportPath(filePath));
      return { success: true, data: imported };
    }

    // Case 2: TypeScript file (hybrid approach)
    if (isTypeScriptFile(filePath)) {
      // 2a. Check for compiled JS
      const compiledPath = getCompiledPath(filePath);
      if (await fileExists(compiledPath)) {
        const imported = await import(normalizeImportPath(compiledPath));
        return { success: true, data: imported };
      }

      // 2b. Check if tsx available
      if (await hasTsx()) {
        try {
          const imported = await importWithTsx(filePath);
          return { success: true, data: imported };
        } catch (error) {
          return {
            success: false,
            error: error instanceof ConfigError
              ? error
              : new ConfigError(
                  `Failed to import TypeScript config with tsx: ${error instanceof Error ? error.message : String(error)}`,
                  { code: 'TSX_IMPORT_FAILED', details: error }
                ),
          };
        }
      }

      // 2c. Neither compiled JS nor tsx available
      return {
        success: false,
        error: new TypeScriptConfigError(filePath),
      };
    }

    // Unknown file type
    return {
      success: false,
      error: new ConfigError(
        `Unsupported config file type: ${filePath}. Use .ts, .js, .mjs, or .cjs`,
        { code: 'UNSUPPORTED_FILE_TYPE' }
      ),
    };
  } catch (error) {
    return {
      success: false,
      error: new ConfigError(
        `Failed to import config file: ${error instanceof Error ? error.message : String(error)}`,
        { code: 'IMPORT_FAILED', details: error }
      ),
    };
  }
}

/**
 * Extract config from various export formats
 *
 * Handles:
 * - ESM default export: export default { ... }
 * - Direct export: module.exports = { ... }
 */
function extractConfig(imported: unknown): unknown {
  // ESM default export
  if (hasDefaultExport(imported)) {
    return imported.default;
  }

  // Direct export
  if (isObject(imported)) {
    return imported;
  }

  throw new ConfigError(
    'Config file must export a ForjaConfig object',
    { code: 'INVALID_EXPORT' }
  );
}
