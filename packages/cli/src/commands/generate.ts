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
import { schemaTemplate, toPascalCase, toKebabCase } from "../utils/templates";
import type { Forja } from "forja-core";
import { generateTypesFile } from "../type-generator/schema-types";

/**
 * Generate type (schema or types)
 */
export type GenerateType = "schema" | "types";

/**
 * Ensure directory exists
 */
async function ensureDirectory(dirPath: string): Promise<void> {
	try {
		await mkdir(dirPath, { recursive: true });
	} catch (error) {
		throw new CLIError(
			`Failed to create directory ${dirPath}: ${formatError(error)}`,
			"FILE_ERROR",
			error,
		);
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
): Promise<void> {
	const exists = await fileExists(filePath);

	if (exists && !overwrite) {
		throw new CLIError(
			`File already exists: ${filePath}. Use --force to overwrite`,
			"FILE_ERROR",
		);
	}

	const dirPath = dirname(filePath);
	await ensureDirectory(dirPath);

	try {
		await writeFile(filePath, content, "utf-8");
	} catch (error) {
		throw new CLIError(
			`Failed to write file ${filePath}: ${formatError(error)}`,
			"FILE_ERROR",
			error,
		);
	}
}

/**
 * Generate schema file
 */
async function generateSchema(
	name: string,
	options: GenerateCommandOptions,
): Promise<void> {
	if (!name || name.trim() === "") {
		throw new CLIError("Schema name is required", "MISSING_ARGUMENT");
	}

	const pascalName = toPascalCase(name);
	const filename = `${toKebabCase(pascalName)}.schema.ts`;
	const outputDir = options.output ?? join(process.cwd(), "schemas");
	const outputPath = join(outputDir, filename);

	logger.log("");
	logger.info(`Generating schema: ${pascalName}`);
	logger.info(`Output: ${outputPath}`);

	const content = schemaTemplate(pascalName);
	await writeFileSafe(outputPath, content, false);

	logger.log("");
	logger.success(`Schema created: ${outputPath}`);
	logger.log("");
	logger.info("Next steps:");
	logger.info("1. Edit the schema file to add your fields");
	logger.info("2. Run: forja migrate");
	logger.log("");
}

/**
 * Generate TypeScript types from registered schemas
 */
async function generateTypes(
	forja: Forja,
	options: GenerateCommandOptions,
): Promise<void> {
	const schemas = forja.getAllSchemas();
	const outputPath =
		options.output ?? join(process.cwd(), "types", "generated.ts");

	logger.log("");
	logger.info(`Generating types for ${schemas.length} schemas`);
	logger.info(`Output: ${outputPath}`);

	const content = generateTypesFile(schemas);
	await writeFileSafe(outputPath, content, true);

	logger.log("");
	logger.success(`Types generated: ${outputPath}`);
	logger.log("");
}

/**
 * Generate command handler
 */
export async function generateCommand(
	type: GenerateType,
	name: string,
	options: GenerateCommandOptions,
	forja?: Forja,
): Promise<void> {
	switch (type) {
		case "schema":
			await generateSchema(name, options);
			break;

		case "types": {
			if (!forja) {
				throw new CLIError(
					"Forja instance is required for generate types",
					"CONFIG_ERROR",
				);
			}
			await generateTypes(forja, options);
			break;
		}

		default: {
			const _exhaustive: never = type;
			throw new CLIError(
				`Unknown generate type: ${String(_exhaustive)}`,
				"INVALID_COMMAND",
			);
		}
	}
}

/**
 * Validate generate type
 */
export function isValidGenerateType(type: string): type is GenerateType {
	return type === "schema" || type === "types";
}
