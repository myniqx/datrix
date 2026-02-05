#!/usr/bin/env node

/**
 * Forja CLI Entry Point (~300 LOC)
 *
 * Command-line interface for Forja database management framework.
 * Provides commands for migrations, schema generation, and development mode.
 */

import type {
	ParsedArgs,
	MigrateCommandOptions,
	GenerateCommandOptions,
	DevCommandOptions,
} from "./types";
import { logger, formatError, bold, cyan } from "./utils/logger";
import { generateCommand, isValidGenerateType } from "./commands/generate";

/**
 * Parse command-line arguments
 */
function parseArgs(args: readonly string[]): ParsedArgs {
	const command = args[0] ?? undefined;
	const subcommand = args[1] ?? undefined;
	const restArgs: string[] = [];
	const options: Record<string, string | boolean> = {};

	// Parse remaining args
	for (let i = command === "generate" ? 2 : 1; i < args.length; i++) {
		const arg = args[i];

		if (arg === undefined) {
			continue;
		}

		if (arg.startsWith("--")) {
			// Parse option
			const option = arg.slice(2);
			const nextArg = args[i + 1];

			if (nextArg && !nextArg.startsWith("--")) {
				// Option with value
				options[option] = nextArg;
				i++; // Skip next arg
			} else {
				// Boolean flag
				options[option] = true;
			}
		} else if (!arg.startsWith("-")) {
			// Positional argument
			restArgs.push(arg);
		}
	}

	return {
		command,
		subcommand: command === "generate" ? subcommand : undefined,
		args: restArgs,
		options,
	};
}

/**
 * Print help message
 */
function printHelp(): void {
	const help = `
${bold(cyan("Forja CLI"))} - Database Management Framework

${bold("USAGE")}
  forja <command> [options]

${bold("COMMANDS")}
  ${cyan("migrate")}                       Run database migrations
    ${bold("Options:")}
      --down                      Rollback last migration
      --to <version>              Migrate/rollback to specific version
      --dry-run                   Show what would be done without applying
      --status                    Show migration status

  ${cyan("generate schema <Name>")}        Generate schema template file
    ${bold("Options:")}
      --output <path>             Custom output directory

  ${cyan("generate migration <name>")}     Generate migration file
    ${bold("Options:")}
      --output <path>             Custom output directory

  ${cyan("dev")}                            Development mode with auto-reload
    ${bold("Options:")}
      --watch                     Enable file watching (default: true)

  ${cyan("help")}                           Show this help message

${bold("GLOBAL OPTIONS")}
  --config <path>                 Config file path (default: ./forja.config.ts)
  --verbose                       Verbose output
  --help                          Show help for command

${bold("EXAMPLES")}
  forja migrate                   # Run pending migrations
  forja migrate --down            # Rollback last migration
  forja migrate --to 20250101     # Migrate to specific version
  forja migrate --status          # Show migration status
  forja generate schema User      # Generate User schema template
  forja generate migration add-users-table
  forja dev                       # Start development mode

${bold("MORE INFO")}
  Documentation: https://github.com/forja/forja
  Issues: https://github.com/forja/forja/issues
`;

	console.log(help);
}

/**
 * Main CLI handler
 */
async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));

	// Show help
	if (args.options["help"] || args.command === "help" || !args.command) {
		printHelp();
		process.exit(0);
	}

	try {
		switch (args.command) {
			case "migrate": {
				// Note: In real implementation, we would need to:
				// 1. Load config from args.options['config'] or default
				// 2. Initialize adapter
				// 3. Initialize migration runner
				// For now, we show the structure

				if (args.options["status"]) {
					// This is a placeholder - would need actual runner instance
					logger.info("Migration status command would run here");
					logger.info(
						"TODO: Initialize adapter and migration runner from config",
					);
					process.exit(0);
				}

				const configValue = args.options["config"];
				const toValue = args.options["to"];

				const migrateOptions: MigrateCommandOptions = {
					config: typeof configValue === "string" ? configValue : undefined,
					verbose: Boolean(args.options["verbose"]),
					down: Boolean(args.options["down"]),
					to: typeof toValue === "string" ? toValue : undefined,
					dryRun: Boolean(args.options["dry-run"]),
				};

				// This is a placeholder - would need actual runner instance
				logger.info("Migrate command would run here");
				logger.info(
					"TODO: Initialize adapter and migration runner from config",
				);
				logger.info(`Options: ${JSON.stringify(migrateOptions, null, 2)}`);

				// result = await migrateCommand(migrateOptions, runner);
				break;
			}

			case "generate": {
				if (!args.subcommand) {
					logger.error("Missing subcommand for generate");
					logger.info("Usage: forja generate <schema|migration> <name>");
					process.exit(1);
				}

				if (!isValidGenerateType(args.subcommand)) {
					logger.error(`Invalid generate type: ${args.subcommand}`);
					logger.info("Valid types: schema, migration");
					process.exit(1);
				}

				const name = args.args[0];

				if (!name) {
					logger.error("Name is required");
					logger.info(`Usage: forja generate ${args.subcommand} <name>`);
					process.exit(1);
				}

				const genConfigValue = args.options["config"];
				const outputValue = args.options["output"];

				const generateOptions: GenerateCommandOptions = {
					config:
						typeof genConfigValue === "string" ? genConfigValue : undefined,
					verbose: Boolean(args.options["verbose"]),
					output: typeof outputValue === "string" ? outputValue : undefined,
				};

				const generateResult = await generateCommand(
					args.subcommand,
					name,
					generateOptions,
				);

				if (!generateResult.success) {
					logger.error(generateResult.error.message);
					if (args.options["verbose"]) {
						logger.error(String(generateResult.error.details));
					}
					process.exit(1);
				}

				break;
			}

			case "dev": {
				const devConfigValue = args.options["config"];

				const devOptions: DevCommandOptions = {
					config:
						typeof devConfigValue === "string" ? devConfigValue : undefined,
					verbose: Boolean(args.options["verbose"]),
					watch: args.options["watch"] !== false, // Default true
				};

				// This is a placeholder - would need actual runner instance
				logger.info("Dev command would run here");
				logger.info(
					"TODO: Initialize adapter and migration runner from config",
				);
				logger.info(`Options: ${JSON.stringify(devOptions, null, 2)}`);

				// result = await devCommand(devOptions, runner);
				break;
			}

			default: {
				logger.error(`Unknown command: ${args.command}`);
				logger.info('Run "forja help" for usage information');
				process.exit(1);
			}
		}

		process.exit(0);
	} catch (error) {
		logger.error("Fatal error:", formatError(error));

		if (args.options["verbose"]) {
			console.error(error);
		}

		process.exit(1);
	}
}

/**
 * Run CLI
 */
main().catch((error): void => {
	logger.error("Unhandled error:", formatError(error));
	console.error(error);
	process.exit(1);
});

/**
 * Export for testing
 */
export { parseArgs, printHelp };
export type { ParsedArgs };
