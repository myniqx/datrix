import path from "node:path";
import fsSync from "node:fs";
import * as readline from "readline";
import type { DatabaseAdapter } from "@datrix/core";
import type { IApiPlugin } from "@datrix/core";
import type { IDatrix } from "@datrix/core";
import { logger, spinner, red, yellow } from "../utils/logger";
import { ZipImportReader } from "../export-import/zip-reader";
import { FileImporter } from "../export-import/file-importer";
import { FileExporter } from "../export-import/file-exporter";

export type AgreeOption = boolean | "drop-db" | "missing-files";

export interface ImportCommandOptions {
	readonly agree?: AgreeOption | undefined;
	readonly verbose?: boolean | undefined;
	readonly withFiles?: boolean | undefined;
	readonly onlyFiles?: boolean | undefined;
	readonly resume?: string | undefined;
	readonly datrix?: IDatrix;
}

function hasAgreed(
	agree: AgreeOption | undefined,
	scope: "drop-db" | "missing-files",
): boolean {
	return agree === true || agree === scope;
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

	if (options.withFiles || options.onlyFiles) {
		await importWithFiles(adapter, resolvedPath, options);
		return;
	}

	await importDataOnly(adapter, resolvedPath, options);
}

async function importDataOnly(
	adapter: DatabaseAdapter,
	resolvedPath: string,
	options: ImportCommandOptions,
): Promise<void> {
	if (!hasAgreed(options.agree, "drop-db")) {
		logger.log("");
		logger.log(
			red("WARNING: This will permanently delete ALL data in the database!"),
		);
		logger.log(
			yellow(
				"  All existing tables will be dropped and recreated from the export file.",
			),
		);
		logger.log("");

		const confirmed = await confirm(
			"Are you sure you want to continue? (y/N): ",
		);

		if (!confirmed) {
			logger.info("Import cancelled.");
			process.exit(0);
		}
	}

	logger.info(`Importing from: ${resolvedPath}`);

	const reader = new ZipImportReader(resolvedPath, options.verbose);

	spinner.start("Importing data...");

	try {
		await adapter.importData(reader);
		spinner.succeed("Import completed successfully");
	} catch (error) {
		spinner.fail("Import failed");
		throw error;
	}
}

async function importWithFiles(
	adapter: DatabaseAdapter,
	resolvedPath: string,
	options: ImportCommandOptions,
): Promise<void> {
	const datrix = options.datrix;
	const upload = datrix?.getPlugin<IApiPlugin>("api")?.upload;

	if (!upload) {
		throw new Error(
			"--with-files and --only-files require an active api-upload plugin. None was found.",
		);
	}

	const importDir = resolvedPath;
	const zipPath = path.join(importDir, "export.zip");
	const isResume = Boolean(options.resume);
	const resumeDir = options.resume ? path.resolve(options.resume) : null;
	const activeDir = resumeDir ?? importDir;

	const fileImporter = new FileImporter(activeDir, upload, datrix);

	if (isResume) {
		const exists = await fileImporter.ledgerExists();
		if (!exists) {
			throw new Error(
				`No import-progress.txt found in: ${activeDir}. Did you mean to use --resume with a valid import directory?`,
			);
		}
		logger.info(`Resuming file import from: ${activeDir}`);
	} else {
		// Step 1: Check files/ directory exists before doing anything
		const filesDir = path.join(activeDir, "files");
		if (!fsSync.existsSync(filesDir)) {
			throw new Error(
				`No files/ directory found in: ${activeDir}. Make sure you are pointing to an export directory created with --include-files.`,
			);
		}

		// Step 2: DB import (unless --only-files)
		if (!options.onlyFiles) {
			if (!fsSync.existsSync(zipPath)) {
				throw new Error(
					`export.zip not found in: ${importDir}. Make sure you are pointing to an export directory created with --include-files.`,
				);
			}

			if (!hasAgreed(options.agree, "drop-db")) {
				logger.log("");
				logger.log(
					red(
						"WARNING: This will permanently delete ALL data in the database!",
					),
				);
				logger.log(
					yellow(
						"  All existing tables will be dropped and recreated from the export file.",
					),
				);
				logger.log("");

				const confirmed = await confirm(
					"Are you sure you want to continue? (y/N): ",
				);

				if (!confirmed) {
					logger.info("Import cancelled.");
					process.exit(0);
				}
			}

			logger.info(`Importing database from: ${zipPath}`);
			const reader = new ZipImportReader(zipPath, options.verbose);
			spinner.start("Importing data...");
			try {
				await adapter.importData(reader);
				spinner.succeed("Database import completed");
			} catch (error) {
				spinner.fail("Database import failed");
				throw error;
			}
		}

		// Step 3: Extract chunk zips if present
		await fileImporter.extractChunks();

		// Step 4: Build import ledger from export ledger
		const exportLedgerPath = path.join(activeDir, "files-progress.txt");
		if (!fsSync.existsSync(exportLedgerPath)) {
			throw new Error(
				`No files-progress.txt found in: ${activeDir}. The export directory may be incomplete.`,
			);
		}

		const exportExporter = new FileExporter(activeDir, upload);
		const exportEntries = await exportExporter.readLedger();
		await fileImporter.buildLedger(exportEntries);

		// Step 5: Check for missing files and warn
		const { missing, total } = await fileImporter.checkMissingFiles();

		if (total === 0) {
			logger.info("No files to import.");
			return;
		}

		if (missing.length > 0) {
			logger.log("");
			logger.log(
				yellow(`  ${missing.length} of ${total} file(s) not found in files/:`),
			);
			if (options.verbose) {
				for (const key of missing) {
					logger.log(yellow(`    - ${key}`));
				}
			}
			logger.log("");

			if (!hasAgreed(options.agree, "missing-files")) {
				const confirmed = await confirm(
					`Continue without the missing ${missing.length} file(s)? (y/N): `,
				);

				if (!confirmed) {
					logger.info("Import cancelled.");
					process.exit(0);
				}
			}
		}
	}

	// Step 6: Upload pending files
	const entries = await fileImporter.readLedger();
	const pending = entries.filter((e) => e.status === "pending");

	if (pending.length === 0) {
		logger.info("All files already uploaded.");
		return;
	}

	logger.info(`Uploading ${pending.length} file(s)...`);
	spinner.start(`0 / ${entries.length} files`);

	try {
		const result = await fileImporter.uploadPending((done, total) => {
			spinner.start(`${done} / ${total} files`);
		}, options.verbose);

		spinner.succeed(
			`Files imported: ${result.uploaded} uploaded, ${result.skipped} skipped`,
		);
	} catch (error) {
		spinner.fail("File upload failed");
		logger.info(`Tip: resume with --resume ${activeDir}`);
		throw error;
	}
}
