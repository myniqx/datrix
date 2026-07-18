import path from "node:path";
import type { DatabaseAdapter } from "@datrix/core";
import { logger, spinner } from "../utils/logger";
import { ZipExportWriter } from "../export-import/zip-writer";
import { FileExporter } from "../export-import/file-exporter";
import { IDatrix } from "@datrix/core";
import { IApiPlugin } from "@datrix/core";

export interface ExportCommandOptions {
	readonly output?: string;
	readonly verbose?: boolean;
	readonly includeFiles?: boolean;
	readonly packFiles?: boolean;
	readonly packFilesChunkSize?: number;
	readonly resume?: string;
	readonly datrix?: IDatrix;
}

export async function exportCommand(
	adapter: DatabaseAdapter,
	options: ExportCommandOptions,
): Promise<void> {
	const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

	if (options.includeFiles) {
		if (!options.datrix?.getPlugin<IApiPlugin>("api")?.upload) {
			throw new Error(
				"--include-files requires an active api-upload plugin. None was found.",
			);
		}
		await exportWithFiles(adapter, options, timestamp);
	} else {
		await exportDataOnly(adapter, options, timestamp);
	}
}

async function exportDataOnly(
	adapter: DatabaseAdapter,
	options: ExportCommandOptions,
	timestamp: string,
): Promise<void> {
	const outputPath = options.output
		? path.resolve(options.output)
		: path.resolve(process.cwd(), `export_${timestamp}.zip`);

	logger.info(`Exporting to: ${outputPath}`);

	const writer = new ZipExportWriter(outputPath, options.verbose);
	spinner.start("Exporting data...");

	try {
		await adapter.exportData(writer);
		spinner.succeed(`Export completed: ${outputPath}`);
	} catch (error) {
		spinner.fail("Export failed");
		await writer.cleanup().catch(() => {});
		throw error;
	}
}

async function exportWithFiles(
	adapter: DatabaseAdapter,
	options: ExportCommandOptions,
	timestamp: string,
): Promise<void> {
	const datrix = options.datrix!;
	const api = options.datrix?.getPlugin<IApiPlugin>("api");
	const upload = api?.upload!;

	// Determine output directory. With --include-files, --output is a
	// directory — a .zip suffix would create a directory literally named
	// "backup.zip", so strip it with a warning.
	let outputOption = options.output;
	if (outputOption && outputOption.toLowerCase().endsWith(".zip")) {
		const stripped = outputOption.slice(0, -4);
		logger.warn(
			`--include-files exports to a directory; stripping the .zip suffix and using: ${stripped}`,
		);
		outputOption = stripped;
	}

	const baseDir = outputOption
		? path.resolve(outputOption)
		: path.resolve(process.cwd(), `export_${timestamp}`);

	const isResume = Boolean(options.resume);
	const outputDir = options.resume ? path.resolve(options.resume) : baseDir;

	if (isResume && options.output) {
		logger.warn(
			`--resume was given; --output '${options.output}' is ignored (resuming in: ${outputDir})`,
		);
	}

	const zipPath = path.join(outputDir, "export.zip");

	const fileExporter = new FileExporter(
		outputDir,
		upload,
		options.packFilesChunkSize,
	);
	const mediaModel = upload.getModelName();
	const mediaTableName = datrix.getSchema(mediaModel)?.tableName;

	if (!mediaTableName) {
		throw new Error(
			`Upload media model '${mediaModel}' is not registered in this Datrix config.`,
		);
	}

	if (isResume) {
		const exists = await fileExporter.ledgerExists();
		if (!exists) {
			throw new Error(
				`No files-progress.txt found in: ${outputDir}. Did you mean to use --resume with a valid export directory?`,
			);
		}
		logger.info(`Resuming file export from: ${outputDir}`);
	} else {
		await fileExporter.init();
		logger.info(`Exporting to: ${outputDir}`);

		// DB export — intercept media chunks to build ledger
		spinner.start("Exporting data...");
		const writer = new ZipExportWriter(
			zipPath,
			options.verbose,
			async (tableName, rows) => {
				if (tableName === mediaTableName) {
					await fileExporter.appendToLedger(rows);
				}
			},
		);

		try {
			await adapter.exportData(writer);
			spinner.succeed("Database export completed");
		} catch (error) {
			spinner.fail("Database export failed");
			await writer.cleanup().catch(() => {});
			throw error;
		}
	}

	// Download pending files
	const entries = await fileExporter.readLedger();
	const pending = entries.filter((e) => e.status === "pending");

	if (pending.length === 0) {
		logger.info("All files already downloaded.");
		return;
	}

	logger.info(`Downloading ${pending.length} file(s)...`);
	spinner.start(`0 / ${entries.length} files`);

	try {
		const result = await fileExporter.downloadPending((done, total) => {
			spinner.update(`${done} / ${total} files`);
		}, options.packFiles);
		if (!result.stopped) {
			spinner.succeed(`Files exported: ${outputDir}`);
		}
	} catch (error) {
		spinner.fail("File download failed");
		logger.info(`Tip: resume with --resume ${outputDir}`);
		throw error;
	}
}
