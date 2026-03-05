#!/usr/bin/env node

/**
 * Forja CLI Entry Point
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
import { loadConfig } from "./utils/config-loader";
import { createMigrationSetup } from "./utils/migration-setup";
import { generateCommand, isValidGenerateType } from "./commands/generate";
import { migrateCommand, displayMigrationStatus } from "./commands/migrate";
import { devCommand } from "./commands/dev";

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
      --dry-run                   Show what would be done without applying
      --status                    Show migration status

  ${cyan("generate schema <Name>")}        Generate schema template file
    ${bold("Options:")}
      --output <path>             Custom output directory

  ${cyan("generate migration <name>")}     Generate migration file
    ${bold("Options:")}
      --output <path>             Custom output directory

  ${cyan("generate types")}                Generate TypeScript types from schemas
    ${bold("Options:")}
      --output <path>             Output file path (default: ./types/forja.ts)

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
  forja migrate --dry-run         # Preview without applying
  forja migrate --status          # Show migration status
  forja generate schema User      # Generate User schema template
  forja generate migration add-users-table
  forja generate types            # Generate TypeScript types from schemas
  forja dev                       # Start development mode

${bold("MORE INFO")}
  Documentation: https://github.com/forja/forja
  Issues: https://github.com/forja/forja/issues
`;

	console.log(help);
}

/**
 * Get config path from options
 */
function getConfigPath(
	options: Record<string, string | boolean>,
): string | undefined {
	const configValue = options["config"];
	return typeof configValue === "string" ? configValue : undefined;
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
				// Load config and initialize Forja
				const configResult = await loadConfig(getConfigPath(args.options));
				if (!configResult.success) {
					logger.error(configResult.error.message);
					process.exit(1);
				}
				const forja = configResult.data;

				const migrateOptions: MigrateCommandOptions = {
					config: getConfigPath(args.options),
					verbose: Boolean(args.options["verbose"]),
					dryRun: Boolean(args.options["dry-run"]),
				};

				// Create migration session from Forja instance
				const session = await forja.beginMigrate();

				// Status check
				if (args.options["status"]) {
					const statusResult = await displayMigrationStatus(session);
					if (!statusResult.success) {
						logger.error(statusResult.error.message);
						process.exit(1);
					}
					break;
				}

				// Run migrations
				const result = await migrateCommand(migrateOptions, session);
				if (!result.success) {
					logger.error(result.error.message);
					if (args.options["verbose"]) {
						logger.error(String(result.error.details));
					}
					process.exit(1);
				}
				break;
			}

			case "generate": {
				if (!args.subcommand) {
					logger.error("Missing subcommand for generate");
					logger.info("Usage: forja generate <schema|migration|types> <name>");
					process.exit(1);
				}

				if (!isValidGenerateType(args.subcommand)) {
					logger.error(`Invalid generate type: ${args.subcommand}`);
					logger.info("Valid types: schema, migration, types");
					process.exit(1);
				}

				const generateOptions: GenerateCommandOptions = {
					config: getConfigPath(args.options),
					verbose: Boolean(args.options["verbose"]),
					output:
						typeof args.options["output"] === "string"
							? args.options["output"]
							: undefined,
				};

				if (args.subcommand === "types") {
					const configResult = await loadConfig(getConfigPath(args.options));
					if (!configResult.success) {
						logger.error(configResult.error.message);
						process.exit(1);
					}
					const forja = configResult.data;

					const typesResult = await generateCommand(
						"types",
						"",
						generateOptions,
						forja,
					);

					if (!typesResult.success) {
						logger.error(typesResult.error.message);
						if (args.options["verbose"]) {
							logger.error(String(typesResult.error.details));
						}
						process.exit(1);
					}
					break;
				}

				const name = args.args[0];

				if (!name) {
					logger.error("Name is required");
					logger.info(`Usage: forja generate ${args.subcommand} <name>`);
					process.exit(1);
				}

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
				// Load config and initialize Forja
				const configResult = await loadConfig(getConfigPath(args.options));
				if (!configResult.success) {
					logger.error(configResult.error.message);
					process.exit(1);
				}
				const forja = configResult.data;

				const devOptions: DevCommandOptions = {
					config: getConfigPath(args.options),
					verbose: Boolean(args.options["verbose"]),
					watch: args.options["watch"] !== false, // Default true
				};

				const devResult = await devCommand(devOptions, forja);
				if (!devResult.success) {
					logger.error(devResult.error.message);
					process.exit(1);
				}
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
