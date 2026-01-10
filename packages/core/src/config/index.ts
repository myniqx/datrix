/**
 * Config Module
 *
 * Configuration management utilities for Forja framework.
 *
 * This module provides low-level config loading utilities.
 * Most users should use the Forja singleton instead of these directly.
 *
 * @example
 * ```ts
 * // Recommended: Use Forja singleton
 * import { Forja } from '@forja/core';
 *
 * await Forja.getInstance().initialize();
 * const config = Forja.getInstance().getConfig();
 * const adapter = Forja.getInstance().getAdapter();
 * ```
 *
 * @example
 * ```ts
 * // Advanced: Use config loader directly
 * import { loadConfig } from '@forja/core/config';
 *
 * const result = await loadConfig();
 * if (!result.success) {
 *   console.error(result.error.message);
 *   process.exit(1);
 * }
 * ```
 */

// Re-export loader (for internal use by Forja)
export { loadConfig } from './loader';

// Re-export validator (for internal use by Forja)
export { validateConfig } from './validator';

// Re-export utilities (for advanced use cases)
export {
  resolveConfigPath,
  fileExists,
  hasTsx,
  isTypeScriptFile,
  isJavaScriptFile,
  getCompiledPath,
  getEnvironment,
} from './utils';
