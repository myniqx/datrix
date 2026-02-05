/**
 * Dev Command Implementation (~200 LOC)
 *
 * Watches for schema file changes and auto-generates/runs migrations.
 * Uses Node.js built-in fs.watch (NO external dependencies).
 */

import { watch } from "fs";
import { join } from "path";
import type { DevCommandOptions } from "../types";
import { CLIError } from "../types";
import { logger, green, cyan, yellow, formatError } from "../utils/logger";
import { Result } from "forja-types/utils";
import { MigrationRunner } from "forja-types/core/migration";

/**
 * File change event
 */
interface FileChangeEvent {
	readonly filename: string;
	readonly eventType: "change" | "rename";
	readonly timestamp: number;
}

/**
 * Debounce file changes
 */
class ChangeDebouncer {
	private readonly delay: number;
	private timeoutId: NodeJS.Timeout | null = null;
	private readonly callback: () => void;

	constructor(callback: () => void, delay: number = 500) {
		this.callback = callback;
		this.delay = delay;
	}

	/**
	 * Trigger debounced callback
	 */
	trigger(): void {
		if (this.timeoutId !== null) {
			clearTimeout(this.timeoutId);
		}

		this.timeoutId = setTimeout((): void => {
			this.callback();
			this.timeoutId = null;
		}, this.delay);
	}

	/**
	 * Cancel pending callback
	 */
	cancel(): void {
		if (this.timeoutId !== null) {
			clearTimeout(this.timeoutId);
			this.timeoutId = null;
		}
	}
}

/**
 * File watcher class
 */
class FileWatcher {
	private readonly directory: string;
	private readonly pattern: RegExp;
	private readonly onChange: (event: FileChangeEvent) => void;
	private watcher: ReturnType<typeof watch> | null = null;
	private isRunning: boolean = false;

	constructor(
		directory: string,
		pattern: RegExp,
		onChange: (event: FileChangeEvent) => void,
	) {
		this.directory = directory;
		this.pattern = pattern;
		this.onChange = onChange;
	}

	/**
	 * Start watching
	 */
	start(): Result<void, CLIError> {
		if (this.isRunning) {
			return { success: true, data: undefined };
		}

		try {
			this.watcher = watch(
				this.directory,
				{ recursive: true },
				(eventType: string, filename: string | null): void => {
					if (!filename) {
						return;
					}

					// Check if file matches pattern
					if (!this.pattern.test(filename)) {
						return;
					}

					const event: FileChangeEvent = {
						filename,
						eventType: eventType as "change" | "rename",
						timestamp: Date.now(),
					};

					this.onChange(event);
				},
			);

			this.isRunning = true;
			return { success: true, data: undefined };
		} catch (error) {
			return {
				success: false,
				error: new CLIError(
					`Failed to start file watcher: ${formatError(error)}`,
					"EXECUTION_ERROR",
					error,
				),
			};
		}
	}

	/**
	 * Stop watching
	 */
	stop(): void {
		if (this.watcher) {
			this.watcher.close();
			this.watcher = null;
			this.isRunning = false;
		}
	}
}

/**
 * Run initial migration
 */
async function runInitialMigration(
	runner: MigrationRunner,
): Promise<Result<void, CLIError>> {
	try {
		logger.info("Running initial migration check...");
		logger.log("");

		const pendingResult = await runner.getPending();

		if (!pendingResult.success) {
			return {
				success: false,
				error: new CLIError(
					`Failed to check migrations: ${formatError(pendingResult.error)}`,
					"EXECUTION_ERROR",
					pendingResult.error,
				),
			};
		}

		const pending = pendingResult.data;

		if (pending.length === 0) {
			logger.info("Database is up to date");
			return { success: true, data: undefined };
		}

		logger.info(`Found ${pending.length} pending migration(s)`);

		const runResult = await runner.runPending({ dryRun: false });

		if (!runResult.success) {
			return {
				success: false,
				error: new CLIError(
					`Failed to run migrations: ${formatError(runResult.error)}`,
					"EXECUTION_ERROR",
					runResult.error,
				),
			};
		}

		logger.success("Migrations completed");

		return { success: true, data: undefined };
	} catch (error) {
		return {
			success: false,
			error: new CLIError(
				`Initial migration failed: ${formatError(error)}`,
				"EXECUTION_ERROR",
				error,
			),
		};
	}
}

/**
 * Handle schema change
 */
async function handleSchemaChange(
	filename: string,
	runner: MigrationRunner,
): Promise<void> {
	try {
		logger.log("");
		logger.info(cyan("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
		logger.info(yellow(`Schema changed: ${filename}`));
		logger.info(cyan("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
		logger.log("");

		// Check for pending migrations
		const pendingResult = await runner.getPending();

		if (!pendingResult.success) {
			logger.error(
				`Failed to check migrations: ${formatError(pendingResult.error)}`,
			);
			return;
		}

		const pending = pendingResult.data;

		if (pending.length === 0) {
			logger.info("No new migrations to run");
			logger.log("");
			logger.info(green("✨ Watching for changes..."));
			return;
		}

		logger.info(`Found ${pending.length} new migration(s)`);

		// Run migrations
		const runResult = await runner.runPending({ dryRun: false });

		if (!runResult.success) {
			logger.error(`Migration failed: ${formatError(runResult.error)}`);
			logger.log("");
			logger.info(green("✨ Watching for changes..."));
			return;
		}

		logger.success("Migrations completed successfully");
		logger.log("");
		logger.info(green("✨ Watching for changes..."));
	} catch (error) {
		logger.error(`Error handling schema change: ${formatError(error)}`);
		logger.log("");
		logger.info(green("✨ Watching for changes..."));
	}
}

/**
 * Dev command handler
 */
export async function devCommand(
	options: DevCommandOptions,
	runner: MigrationRunner,
	schemasDir: string = join(process.cwd(), "schemas"),
): Promise<Result<void, CLIError>> {
	try {
		logger.log("");
		logger.info(green("🚀 Forja Development Mode"));
		logger.log("");
		logger.info(`Watching: ${schemasDir}`);
		logger.log("");

		// Run initial migration
		const initialResult = await runInitialMigration(runner);

		if (!initialResult.success) {
			return initialResult;
		}

		logger.log("");
		logger.info(green("✨ Watching for changes..."));
		logger.info(yellow("Press Ctrl+C to exit"));
		logger.log("");

		// Create debouncer
		let lastChangedFile: string = "";
		const debouncer = new ChangeDebouncer(async (): Promise<void> => {
			await handleSchemaChange(lastChangedFile, runner);
		}, 500);

		// Create watcher
		const watcher = new FileWatcher(
			schemasDir,
			/\.schema\.ts$/,
			(event: FileChangeEvent): void => {
				if (options.verbose) {
					logger.debug(`File ${event.eventType}: ${event.filename}`);
				}

				lastChangedFile = event.filename;
				debouncer.trigger();
			},
		);

		// Start watching
		const startResult = watcher.start();

		if (!startResult.success) {
			return startResult;
		}

		// Handle process termination
		const cleanup = (): void => {
			logger.log("");
			logger.info("Stopping dev mode...");
			debouncer.cancel();
			watcher.stop();
			logger.success("Dev mode stopped");
			process.exit(0);
		};

		process.on("SIGINT", cleanup);
		process.on("SIGTERM", cleanup);

		// Keep process running
		await new Promise<void>((): void => {
			// Never resolves - waits for SIGINT/SIGTERM
		});

		return { success: true, data: undefined };
	} catch (error) {
		return {
			success: false,
			error: new CLIError(
				`Dev command failed: ${formatError(error)}`,
				"EXECUTION_ERROR",
				error,
			),
		};
	}
}
