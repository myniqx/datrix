/**
 * Config Utilities
 *
 * Helper functions for config loading and file operations
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { Result } from 'forja-types/utils';
import { ConfigError } from 'forja-types/config';

/**
 * Check if file exists
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve config file path
 *
 * Supports environment-specific config files:
 * - forja.config.dev.ts/js (development)
 * - forja.config.prod.ts/js (production)
 * - forja.config.test.ts/js (test)
 * - forja.config.ts/js (fallback)
 *
 * Priority:
 * 1. Environment-specific compiled JS (.js)
 * 2. Environment-specific TypeScript (.ts)
 * 3. Base compiled JS (forja.config.js)
 * 4. Base TypeScript (forja.config.ts)
 */
export async function resolveConfigPath(
  basePath: string,
  environment: 'development' | 'production' | 'test',
  cwd: string
): Promise<Result<string, ConfigError>> {
  const baseDir = path.dirname(basePath);
  const baseNameWithoutExt = path.basename(basePath, path.extname(basePath));

  // Map environment to file suffix
  const envSuffix: Record<typeof environment, string> = {
    development: 'dev',
    production: 'prod',
    test: 'test',
  };

  const suffix = envSuffix[environment];

  // Possible file paths in priority order
  const candidates = [
    // 1. Environment-specific compiled JS
    path.resolve(cwd, baseDir, `${baseNameWithoutExt}.${suffix}.js`),
    // 2. Environment-specific TypeScript
    path.resolve(cwd, baseDir, `${baseNameWithoutExt}.${suffix}.ts`),
    // 3. Base compiled JS (fallback)
    path.resolve(cwd, baseDir, `${baseNameWithoutExt}.js`),
    // 4. Base TypeScript (fallback)
    path.resolve(cwd, baseDir, `${baseNameWithoutExt}.ts`),
  ];

  // Find first existing file
  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      return { success: true, data: candidate };
    }
  }

  // No config file found
  return {
    success: false,
    error: new ConfigError(
      `Config file not found. Tried:\n${candidates.map(c => `  - ${c}`).join('\n')}`,
      { code: 'CONFIG_NOT_FOUND' }
    ),
  };
}

/**
 * Check if tsx is available
 */
export async function hasTsx(): Promise<boolean> {
  try {
    // Try to dynamically import tsx
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await import('tsx/esm/api' as any);
    return true;
  } catch {
    return false;
  }
}

/**
 * Import TypeScript file using tsx
 */
export async function importWithTsx(filePath: string): Promise<unknown> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tsx = await import('tsx/esm/api' as any);
    const tsxApi = tsx as { register?: () => { unregister: () => void } };

    if (!tsxApi.register) {
      throw new Error('tsx.register is not available');
    }

    // Register tsx loader
    const unregister = tsxApi.register();

    try {
      // Import the TypeScript file
      const imported = await import(filePath);
      return imported;
    } finally {
      // Cleanup
      unregister.unregister();
    }
  } catch (error) {
    throw new ConfigError(
      `Failed to import TypeScript config with tsx: ${error instanceof Error ? error.message : String(error)}`,
      { code: 'TSX_IMPORT_FAILED', details: error }
    );
  }
}

/**
 * Type guard for object
 */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Normalize Windows path to URL path for dynamic import
 */
export function normalizeImportPath(filePath: string): string {
  // On Windows, convert backslashes to forward slashes and add file:// protocol
  if (process.platform === 'win32') {
    const normalized = filePath.replace(/\\/g, '/');
    return `file:///${normalized}`;
  }
  return filePath;
}

/**
 * Get file extension
 */
export function getFileExtension(filePath: string): string {
  return path.extname(filePath).toLowerCase();
}

/**
 * Check if file is TypeScript
 */
export function isTypeScriptFile(filePath: string): boolean {
  return getFileExtension(filePath) === '.ts';
}

/**
 * Check if file is JavaScript
 */
export function isJavaScriptFile(filePath: string): boolean {
  const ext = getFileExtension(filePath);
  return ext === '.js' || ext === '.mjs' || ext === '.cjs';
}

/**
 * Get compiled JS path from TS path
 */
export function getCompiledPath(tsPath: string): string {
  return tsPath.replace(/\.ts$/, '.js');
}

/**
 * Validate environment value
 */
export function isValidEnvironment(
  value: unknown
): value is 'development' | 'production' | 'test' {
  return (
    value === 'development' ||
    value === 'production' ||
    value === 'test'
  );
}

/**
 * Get environment from NODE_ENV
 */
export function getEnvironment(): 'development' | 'production' | 'test' {
  const env = process.env['NODE_ENV'];

  if (isValidEnvironment(env)) {
    return env;
  }

  return 'development';
}
