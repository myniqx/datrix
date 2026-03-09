/**
 * Config Loader
 *
 * Loads forja.config.ts using jiti for TypeScript support.
 * Returns a Forja instance ready to use.
 */

import { resolve } from "path";
import { access } from "fs/promises";
import { CLIError } from "../types";
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
async function resolveConfigPath(configPath?: string): Promise<string> {
	if (configPath) {
		const resolved = resolve(process.cwd(), configPath);
		try {
			await access(resolved);
			return resolved;
		} catch {
			throw new CLIError(`Config file not found: ${resolved}`, "CONFIG_ERROR");
		}
	}

	for (const ext of CONFIG_EXTENSIONS) {
		const candidate = resolve(process.cwd(), `forja.config${ext}`);
		try {
			await access(candidate);
			return candidate;
		} catch {
			// Try next extension
		}
	}

	throw new CLIError(
		`Config file not found. Expected ${DEFAULT_CONFIG_FILE} in ${process.cwd()}`,
		"CONFIG_ERROR",
	);
}

/**
 * Load config file and return initialized Forja instance
 *
 * The config file should use defineConfig() which returns () => Promise<Forja>.
 * We import the module, get the default export (the factory), and call it.
 */
export async function loadConfig(configPath?: string): Promise<Forja> {
	const resolvedPath = await resolveConfigPath(configPath);

	try {
		const { createJiti } = await import("jiti");
		const jitiBase =
			typeof import.meta?.url === "string"
				? import.meta.url
				: `file://${__filename}`;
		const jiti = createJiti(jitiBase, {
			interopDefault: true,
		});

		const configModule = await jiti.import(resolvedPath);

		const factory = extractFactory(configModule);

		if (!factory) {
			throw new CLIError(
				`Config file does not export a valid factory function. Use defineConfig() to create your config.`,
				"CONFIG_ERROR",
			);
		}

		const forja = await factory();
		return forja;
	} catch (error) {
		if (error instanceof CLIError) {
			throw error;
		}
		const message = error instanceof Error ? error.message : String(error);
		throw new CLIError(
			`Failed to load config from ${resolvedPath}: ${message}`,
			"CONFIG_ERROR",
			error,
		);
	}
}

/**
 * Extract factory function from config module
 *
 * Handles both:
 * - export default defineConfig(...)  → module is the factory itself
 * - module.default = defineConfig(...) → module.default is the factory
 */
function extractFactory(configModule: unknown): (() => Promise<Forja>) | null {
	if (typeof configModule === "function") {
		return configModule as () => Promise<Forja>;
	}

	if (
		configModule !== null &&
		typeof configModule === "object" &&
		"default" in configModule &&
		typeof (configModule as Record<string, unknown>)["default"] === "function"
	) {
		return (configModule as Record<string, unknown>)[
			"default"
		] as () => Promise<Forja>;
	}

	return null;
}
