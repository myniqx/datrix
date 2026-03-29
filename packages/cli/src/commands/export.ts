import path from "node:path";
import type { DatabaseAdapter } from "forja-types/adapter";
import { logger, spinner } from "../utils/logger";
import { ZipExportWriter } from "../export-import/zip-writer";

export interface ExportCommandOptions {
	readonly output?: string;
	readonly verbose?: boolean;
}

export async function exportCommand(
	adapter: DatabaseAdapter,
	options: ExportCommandOptions,
): Promise<void> {
	const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
	const outputPath = options.output
		? path.resolve(options.output)
		: path.resolve(process.cwd(), `export_${timestamp}.zip`);

	logger.info(`Exporting to: ${outputPath}`);

	const writer = new ZipExportWriter(outputPath);

	spinner.start("Exporting data...");

	try {
		await adapter.exportData(writer);
		spinner.succeed(`Export completed: ${outputPath}`);
	} catch (error) {
		spinner.fail("Export failed");
		throw error;
	}
}
