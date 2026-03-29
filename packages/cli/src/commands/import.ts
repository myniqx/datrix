import path from "node:path";
import * as readline from "readline";
import type { DatabaseAdapter } from "forja-types/adapter";
import { logger, spinner, red, yellow } from "../utils/logger";
import { ZipImportReader } from "../export-import/zip-reader";

export interface ImportCommandOptions {
	readonly agree?: boolean;
	readonly verbose?: boolean;
}

async function confirm(question: string): Promise<boolean> {
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	return new Promise((resolve) => {
		rl.question(question, (answer) => {
			rl.close();
			resolve(answer.trim().toLowerCase() === "y");
		});
	});
}

export async function importCommand(
	adapter: DatabaseAdapter,
	filePath: string,
	options: ImportCommandOptions,
): Promise<void> {
	const resolvedPath = path.resolve(filePath);

	if (!options.agree) {
		logger.log("");
		logger.log(red("WARNING: This will permanently delete ALL data in the database!"));
		logger.log(yellow("  All existing tables will be dropped and recreated from the export file."));
		logger.log("");

		const confirmed = await confirm("Are you sure you want to continue? (y/N): ");

		if (!confirmed) {
			logger.info("Import cancelled.");
			process.exit(0);
		}
	}

	logger.info(`Importing from: ${resolvedPath}`);

	const reader = new ZipImportReader(resolvedPath);

	spinner.start("Importing data...");

	try {
		await adapter.importData(reader);
		spinner.succeed("Import completed successfully");
	} catch (error) {
		spinner.fail("Import failed");
		throw error;
	}
}
