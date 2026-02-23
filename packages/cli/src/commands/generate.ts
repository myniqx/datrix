/**
 * Generate Command Implementation (~200 LOC)
 *
 * Generates code templates for:
 * - Schema definitions
 * - Migration files
 */

import { writeFile, mkdir, access } from "fs/promises";
import { join, dirname } from "path";
import type { GenerateCommandOptions } from "../types";
import { CLIError } from "../types";
import { logger, formatError } from "../utils/logger";
import {
	schemaTemplate,
	migrationTemplate,
	generateTimestamp,
	toPascalCase,
	toKebabCase,
} from "../utils/templates";
import { Result } from "forja-types/utils";
import type { Forja } from "forja-core";
import { generateTypesFile } from "../type-generator/schema-types";

/**
 * Generate type (schema, migration, or types)
 */
export type GenerateType = "schema" | "migration" | "types";

/**
 * Ensure directory exists
 */
async function ensureDirectory(
	dirPath: string,
): Promise<Result<void, CLIError>> {
	try {
		await mkdir(dirPath, { recursive: true });
		return { success: true, data: undefined };
	} catch (error) {
		return {
			success: false,
			error: new CLIError(
				`Failed to create directory ${dirPath}: ${formatError(error)}`,
				"FILE_ERROR",
				error,
			),
		};
	}
}

/**
 * Check if file exists
 */
async function fileExists(filePath: string): Promise<boolean> {
	try {
		await access(filePath);
		return true;
	} catch {
		return false;
	}
}

/**
 * Write file safely
 */
async function writeFileSafe(
	filePath: string,
	content: string,
	overwrite: boolean = false,
): Promise<Result<void, CLIError>> {
	try {
		// Check if file exists
		const exists = await fileExists(filePath);

		if (exists && !overwrite) {
			return {
				success: false,
				error: new CLIError(
					`File already exists: ${filePath}. Use --force to overwrite`,
					"FILE_ERROR",
				),
			};
		}

		// Ensure directory exists
		const dirPath = dirname(filePath);
		const dirResult = await ensureDirectory(dirPath);

		if (!dirResult.success) {
			return dirResult;
		}

		// Write file
		await writeFile(filePath, content, "utf-8");

		return { success: true, data: undefined };
	} catch (error) {
		return {
			success: false,
			error: new CLIError(
				`Failed to write file ${filePath}: ${formatError(error)}`,
				"FILE_ERROR",
				error,
			),
		};
	}
}

/**
 * Generate schema file
 */
async function generateSchema(
	name: string,
	options: GenerateCommandOptions,
): Promise<Result<void, CLIError>> {
	try {
		// Validate name
		if (!name || name.trim() === "") {
			return {
				success: false,
				error: new CLIError("Schema name is required", "MISSING_ARGUMENT"),
			};
		}

		// Convert to PascalCase
		const pascalName = toPascalCase(name);

		// Generate filename
		const filename = `${toKebabCase(pascalName)}.schema.ts`;
		const outputDir = options.output ?? join(process.cwd(), "schemas");
		const outputPath = join(outputDir, filename);

		logger.log("");
		logger.info(`Generating schema: ${pascalName}`);
		logger.info(`Output: ${outputPath}`);

		// Generate template
		const content = schemaTemplate(pascalName);

		// Write file
		const writeResult = await writeFileSafe(outputPath, content, false);

		if (!writeResult.success) {
			return writeResult;
		}

		logger.log("");
		logger.success(`Schema created: ${outputPath}`);
		logger.log("");
		logger.info("Next steps:");
		logger.info("1. Edit the schema file to add your fields");
		logger.info("2. Run: forja migrate");
		logger.log("");

		return { success: true, data: undefined };
	} catch (error) {
		return {
			success: false,
			error: new CLIError(
				`Failed to generate schema: ${formatError(error)}`,
				"EXECUTION_ERROR",
				error,
			),
		};
	}
}

/**
 * Generate migration file
 */
async function generateMigration(
	name: string,
	options: GenerateCommandOptions,
): Promise<Result<void, CLIError>> {
	try {
		// Validate name
		if (!name || name.trim() === "") {
			return {
				success: false,
				error: new CLIError("Migration name is required", "MISSING_ARGUMENT"),
			};
		}

		// Generate timestamp
		const timestamp = generateTimestamp();

		// Generate filename
		const kebabName = toKebabCase(name);
		const filename = `${timestamp}_${kebabName}.ts`;
		const outputDir = options.output ?? join(process.cwd(), "migrations");
		const outputPath = join(outputDir, filename);

		logger.log("");
		logger.info(`Generating migration: ${name}`);
		logger.info(`Version: ${timestamp}`);
		logger.info(`Output: ${outputPath}`);

		// Generate template
		const content = migrationTemplate(name, timestamp);

		// Write file
		const writeResult = await writeFileSafe(outputPath, content, false);

		if (!writeResult.success) {
			return writeResult;
		}

		logger.log("");
		logger.success(`Migration created: ${outputPath}`);
		logger.log("");
		logger.info("Next steps:");
		logger.info("1. Edit the migration file to add operations");
		logger.info("2. Run: forja migrate");
		logger.log("");

		return { success: true, data: undefined };
	} catch (error) {
		return {
			success: false,
			error: new CLIError(
				`Failed to generate migration: ${formatError(error)}`,
				"EXECUTION_ERROR",
				error,
			),
		};
	}
}

/**
 * Generate TypeScript types from registered schemas
 */
async function generateTypes(
	forja: Forja,
	options: GenerateCommandOptions,
): Promise<Result<void, CLIError>> {
	try {
		const schemas = forja.getAllSchemas();
		const outputPath = options.output ?? join(process.cwd(), "types", "generated.ts");

		logger.log("");
		logger.info(`Generating types for ${schemas.length} schemas`);
		logger.info(`Output: ${outputPath}`);

		const content = generateTypesFile(schemas);

		const writeResult = await writeFileSafe(outputPath, content, true);

		if (!writeResult.success) {
			return writeResult;
		}

		logger.log("");
		logger.success(`Types generated: ${outputPath}`);
		logger.log("");

		return { success: true, data: undefined };
	} catch (error) {
		return {
			success: false,
			error: new CLIError(
				`Failed to generate types: ${formatError(error)}`,
				"EXECUTION_ERROR",
				error,
			),
		};
	}
}

/**
 * Generate command handler
 */
export async function generateCommand(
	type: GenerateType,
	name: string,
	options: GenerateCommandOptions,
	forja?: Forja,
): Promise<Result<void, CLIError>> {
	try {
		switch (type) {
			case "schema":
				return await generateSchema(name, options);

			case "migration":
				return await generateMigration(name, options);

			case "types": {
				if (!forja) {
					return {
						success: false,
						error: new CLIError(
							"Forja instance is required for generate types",
							"CONFIG_ERROR",
						),
					};
				}
				return await generateTypes(forja, options);
			}

			default: {
				// Exhaustive check
				const _exhaustive: never = type;
				return {
					success: false,
					error: new CLIError(
						`Unknown generate type: ${String(_exhaustive)}`,
						"INVALID_COMMAND",
					),
				};
			}
		}
	} catch (error) {
		return {
			success: false,
			error: new CLIError(
				`Generate command failed: ${formatError(error)}`,
				"EXECUTION_ERROR",
				error,
			),
		};
	}
}

/**
 * Validate generate type
 */
export function isValidGenerateType(type: string): type is GenerateType {
	return type === "schema" || type === "migration" || type === "types";
}
