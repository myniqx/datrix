/**
 * CLI Type Definitions
 *
 * Types for CLI command parsing, options, and errors.
 */

/**
 * CLI Error class
 */
export class CLIError extends Error {
	constructor(
		message: string,
		public readonly code:
			| "INVALID_COMMAND"
			| "MISSING_ARGUMENT"
			| "FILE_ERROR"
			| "CONFIG_ERROR"
			| "EXECUTION_ERROR",
		public readonly details?: unknown,
	) {
		super(message);
		this.name = "CLIError";
	}
}

/**
 * Parsed command-line arguments
 */
export interface ParsedArgs {
	readonly command?: string | undefined;
	readonly subcommand?: string | undefined;
	readonly args: readonly string[];
	readonly options: Record<string, string | boolean>;
}

/**
 * Common command options
 */
export interface BaseCommandOptions {
	readonly config?: string | undefined;
	readonly verbose?: boolean | undefined;
}

/**
 * Migrate command options
 */
export interface MigrateCommandOptions extends BaseCommandOptions {
	readonly dryRun?: boolean | undefined;
}

/**
 * Generate command options
 */
export interface GenerateCommandOptions extends BaseCommandOptions {
	readonly output?: string | undefined;
}
