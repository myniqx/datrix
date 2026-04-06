import path from "node:path";
import type { DatabaseAdapter } from "@forja/core/types/adapter";
import { logger, spinner } from "../utils/logger";
import { ZipExportWriter } from "../export-import/zip-writer";
import { FileExporter } from "../export-import/file-exporter";
import { IForja } from "@forja/core/types";
import { IApiPlugin } from "@forja/core/types/api";

export interface ExportCommandOptions {
	readonly output?: string;
	readonly verbose?: boolean;
	readonly includeFiles?: boolean;
	readonly packFiles?: boolean;
	readonly packFilesChunkSize?: number;
	readonly resume?: string;
	readonly forja?: IForja;
}

export async function exportCommand(
	adapter: DatabaseAdapter,
	options: ExportCommandOptions,
): Promise<void> {
	const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

	if (options.includeFiles) {
		if (!options.forja?.getPlugin<IApiPlugin>("api")?.upload) {
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
		throw error;
	}
}

async function exportWithFiles(
	adapter: DatabaseAdapter,
	options: ExportCommandOptions,
	timestamp: string,
): Promise<void> {
	const forja = options.forja!;
	const api = options.forja?.getPlugin<IApiPlugin>("api");
	const upload = api?.upload!;

	// Determine output directory
	const baseDir = options.output
		? path.resolve(options.output)
		: path.resolve(process.cwd(), `export_${timestamp}`);

	const isResume = Boolean(options.resume);
	const outputDir = options.resume ? path.resolve(options.resume) : baseDir;
	const zipPath = path.join(outputDir, "export.zip");

	const fileExporter = new FileExporter(
		outputDir,
		upload,
		options.packFilesChunkSize,
	);
	const mediaModel = upload.getModelName();
	const mediaTableName = forja.getSchema(mediaModel)!.tableName!;

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
			spinner.start(`${done} / ${total} files`);
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
