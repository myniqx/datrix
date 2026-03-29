#!/usr/bin/env node

/**
 * Forja CLI Entry Point
 *
 * Command-line interface for Forja database management framework.
 * Provides commands for migrations and schema generation.
 */

import type {
	ParsedArgs,
	MigrateCommandOptions,
	GenerateCommandOptions,
} from "./types";
import { logger, formatError, bold, cyan } from "./utils/logger";
import { loadConfig } from "./utils/config-loader";
import { migrateCommand, displayMigrationStatus } from "./commands/migrate";
import { generateCommand, isValidGenerateType } from "./commands/generate";
import { exportCommand } from "./commands/export";
import { importCommand } from "./commands/import";

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

  ${cyan("generate types")}                Generate TypeScript types from schemas
    ${bold("Options:")}
      --output <path>             Output file path (default: ./types/forja.ts)

  ${cyan("export")}                        Export all data to a zip file
    ${bold("Options:")}
      --output <path>             Output file path (default: ./export_<date>.zip)

  ${cyan("import")} ${bold("<file.zip>")}             Import data from a zip file (drops all existing data)
    ${bold("Options:")}
      --agree                     Skip the "drop all data" confirmation prompt

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
  forja generate types            # Generate TypeScript types from schemas

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
				const forja = await loadConfig(getConfigPath(args.options));

				const migrateOptions: MigrateCommandOptions = {
					config: getConfigPath(args.options),
					verbose: Boolean(args.options["verbose"]),
					dryRun: Boolean(args.options["dry-run"]),
				};

				const session = await forja.beginMigrate();

				if (args.options["status"]) {
					await displayMigrationStatus(session);
					break;
				}

				await migrateCommand(migrateOptions, session);
				break;
			}

			case "generate": {
				if (!args.subcommand) {
					logger.error("Missing subcommand for generate");
					logger.info("Usage: forja generate <schema|types> <name>");
					process.exit(1);
				}

				if (!isValidGenerateType(args.subcommand)) {
					logger.error(`Invalid generate type: ${args.subcommand}`);
					logger.info("Valid types: schema, types");
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
					const forja = await loadConfig(getConfigPath(args.options));
					await generateCommand("types", "", generateOptions, forja);
					break;
				}

				const name = args.args[0];

				if (!name) {
					logger.error("Name is required");
					logger.info(`Usage: forja generate ${args.subcommand} <name>`);
					process.exit(1);
				}

				await generateCommand(args.subcommand, name, generateOptions);
				break;
			}

			case "export": {
				const forja = await loadConfig(getConfigPath(args.options));
				await exportCommand(forja.getAdapter(), {
					verbose: Boolean(args.options["verbose"]),
					output: typeof args.options["output"] === "string" ? args.options["output"] : undefined,
				});
				break;
			}

			case "import": {
				const filePath = args.args[0];
				if (!filePath) {
					logger.error("Import file path is required");
					logger.info("Usage: forja import <file.zip> [--agree]");
					process.exit(1);
				}
				const forja = await loadConfig(getConfigPath(args.options));
				await importCommand(forja.getAdapter(), filePath, {
					agree: Boolean(args.options["agree"]),
					verbose: Boolean(args.options["verbose"]),
				});
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
