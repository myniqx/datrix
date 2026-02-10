/**
 * Config Loader
 *
 * Loads forja.config.ts using jiti for TypeScript support.
 * Returns a Forja instance ready to use.
 */

import { resolve } from "path";
import { access } from "fs/promises";
import { CLIError } from "../types";
import { Result } from "forja-types/utils";
import type { Forja } from "forja-core";

/**
 * Default config file name
 */
const DEFAULT_CONFIG_FILE = "forja.config.ts";

/**
 * Supported config file extensions (checked in order)
 */
const CONFIG_EXTENSIONS = [".ts", ".js", ".mjs", ".cjs"] as const;

/**
 * Resolve config file path
 *
 * If explicit path given, use it directly.
 * Otherwise search for forja.config.{ts,js,mjs,cjs} in cwd.
 */
async function resolveConfigPath(
	configPath?: string,
): Promise<Result<string, CLIError>> {
	if (configPath) {
		const resolved = resolve(process.cwd(), configPath);
		try {
			await access(resolved);
			return { success: true, data: resolved };
		} catch {
			return {
				success: false,
				error: new CLIError(
					`Config file not found: ${resolved}`,
					"CONFIG_ERROR",
				),
			};
		}
	}

	// Search for config file with supported extensions
	for (const ext of CONFIG_EXTENSIONS) {
		const candidate = resolve(process.cwd(), `forja.config${ext}`);
		try {
			await access(candidate);
			return { success: true, data: candidate };
		} catch {
			// Try next extension
		}
	}

	return {
		success: false,
		error: new CLIError(
			`Config file not found. Expected ${DEFAULT_CONFIG_FILE} in ${process.cwd()}`,
			"CONFIG_ERROR",
		),
	};
}

/**
 * Load config file and return initialized Forja instance
 *
 * The config file should use defineConfig() which returns () => Promise<Forja>.
 * We import the module, get the default export (the factory), and call it.
 */
export async function loadConfig(
	configPath?: string,
): Promise<Result<Forja, CLIError>> {
	// 1. Resolve config file path
	const pathResult = await resolveConfigPath(configPath);
	if (!pathResult.success) {
		return pathResult;
	}
	const resolvedPath = pathResult.data;

	try {
		// 2. Import config file using jiti
		const { createJiti } = await import("jiti");
		const jiti = createJiti(import.meta.url, {
			interopDefault: true,
		});

		const configModule = await jiti.import(resolvedPath);

		// 3. Extract the factory function
		// defineConfig returns () => Promise<Forja>
		// The module default export IS the factory
		const factory = extractFactory(configModule);

		if (!factory) {
			return {
				success: false,
				error: new CLIError(
					`Config file does not export a valid factory function. Use defineConfig() to create your config.`,
					"CONFIG_ERROR",
				),
			};
		}

		// 4. Call factory to get Forja instance
		const forja = await factory();

		return { success: true, data: forja };
	} catch (error) {
		const message =
			error instanceof Error ? error.message : String(error);
		return {
			success: false,
			error: new CLIError(
				`Failed to load config from ${resolvedPath}: ${message}`,
				"CONFIG_ERROR",
				error,
			),
		};
	}
}

/**
 * Extract factory function from config module
 *
 * Handles both:
 * - export default defineConfig(...)  → module is the factory itself
 * - module.default = defineConfig(...) → module.default is the factory
 */
function extractFactory(
	configModule: unknown,
): (() => Promise<Forja>) | null {
	if (typeof configModule === "function") {
		return configModule as () => Promise<Forja>;
	}

	if (
		configModule !== null &&
		typeof configModule === "object" &&
		"default" in configModule &&
		typeof (configModule as Record<string, unknown>)["default"] === "function"
	) {
		return (configModule as Record<string, unknown>)["default"] as () => Promise<Forja>;
	}

	return null;
}
