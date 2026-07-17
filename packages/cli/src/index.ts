#!/usr/bin/env node

/**
 * Datrix CLI Entry Point
 *
 * Command-line interface for Datrix database management framework.
 * Provides commands for migrations and schema generation.
 */

import type {
	ParsedArgs,
	MigrateCommandOptions,
	GenerateCommandOptions,
} from "./types";
import { CLIError } from "./types";
import { logger, formatError, bold, cyan } from "./utils/logger";
import { parseArgs, parseSize } from "./utils/args";
import { CLI_VERSION } from "./utils/version";
import { loadConfig } from "./utils/config-loader";
import { migrateCommand, displayMigrationStatus } from "./commands/migrate";
import { generateCommand, isValidGenerateType } from "./commands/generate";
import { exportCommand } from "./commands/export";
import { importCommand } from "./commands/import";
import type { Datrix } from "@datrix/core";

/**
 * Print help message
 */
function printHelp(): void {
	const help = `
${bold(cyan("Datrix CLI"))} - Database Management Framework

${bold("USAGE")}
  datrix <command> [options]

${bold("COMMANDS")}
  ${cyan("migrate")}                       Run database migrations
    ${bold("Options:")}
      --dry-run                   Show what would be done without applying
      --status                    Show migration status
      --yes                       Apply without the confirmation prompt
                                  (required when stdin is not a TTY, e.g. CI)

  ${cyan("generate schema <Name>")}        Generate schema template file
    ${bold("Options:")}
      --output <dir>              Output directory (default: ./schemas)
      --force                     Overwrite an existing file

  ${cyan("generate types")}                Generate TypeScript types from schemas
    ${bold("Options:")}
      --output <path>             Output file path (default: ./types/generated.ts)

  ${cyan("generate config <db>")}          Generate a datrix.config.ts template
                                  db: postgres | mysql | json | mongodb
    ${bold("Options:")}
      --output <path>             Output file path (default: ./datrix.config.ts)
      --force                     Overwrite an existing file

  ${cyan("export")}                        Export all data to a zip file
    ${bold("Options:")}
      --output <path>             Output zip path (default: ./export_<date>.zip).
                                  With --include-files, this is a directory.
      --include-files             Also download media files (requires api-upload plugin)
      --pack-files [size]         Pack downloaded files into zip chunks.
                                  Size accepts kb/mb/gb suffix (e.g. 500mb, default: 1gb)
      --resume <dir>              Resume an interrupted file export
                                  (--output is ignored when resuming)

  ${cyan("import")} ${bold("<file.zip>")}             Import data from a zip file (drops all existing data)
  ${cyan("import")} ${bold("<dir>")} --with-files     Import database + media files from an export directory
    ${bold("Options:")}
      --with-files                Import database and files from a directory export
      --only-files                Import only files (skip the database import)
      --resume <dir>              Resume an interrupted file import
                                  (the positional path is ignored when resuming)
      --agree [scope]             Skip confirmation prompts. Scopes: drop-db,
                                  missing-files. Without a value, agrees to all.

  ${cyan("version")}                       Print CLI version
  ${cyan("help")}                          Show this help message

${bold("GLOBAL OPTIONS")}
  --config <path>                 Config file path (default: ./datrix.config.ts)
  --verbose                       Verbose output
  --help, -h                      Show help
  --version, -v                   Print CLI version

${bold("EXAMPLES")}
  datrix migrate                   # Run pending migrations
  datrix migrate --dry-run         # Preview without applying
  datrix migrate --status          # Show migration status
  datrix generate schema User      # Generate User schema template
  datrix generate types            # Generate TypeScript types from schemas
  datrix export --include-files --output ./backup
  datrix import ./backup --with-files --agree missing-files

${bold("MORE INFO")}
  Documentation: https://github.com/myniqx/datrix
  Issues: https://github.com/myniqx/datrix/issues
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
 * Run the parsed command. The loaded Datrix instance is stored on `ref`
 * (even when the command later fails) so main() can always shut it down.
 */
async function runCommand(
	args: ParsedArgs,
	ref: { datrix: Datrix | undefined },
): Promise<void> {
	switch (args.command) {
		case "migrate": {
			const datrix = await loadConfig(getConfigPath(args.options));
			ref.datrix = datrix;

			const migrateOptions: MigrateCommandOptions = {
				config: getConfigPath(args.options),
				verbose: Boolean(args.options["verbose"]),
				dryRun: Boolean(args.options["dry-run"]),
				yes: Boolean(args.options["yes"]),
			};

			const session = await datrix.beginMigrate();

			if (args.options["status"]) {
				await displayMigrationStatus(session);
				return;
			}

			await migrateCommand(migrateOptions, session);
			return;
		}

		case "generate": {
			if (!args.subcommand) {
				throw new CLIError(
					"Missing subcommand for generate. Usage: datrix generate <schema|types|config> [name]",
					"MISSING_ARGUMENT",
				);
			}

			if (!isValidGenerateType(args.subcommand)) {
				throw new CLIError(
					`Invalid generate type: ${args.subcommand}. Valid types: schema, types, config`,
					"INVALID_COMMAND",
				);
			}

			const generateOptions: GenerateCommandOptions = {
				config: getConfigPath(args.options),
				verbose: Boolean(args.options["verbose"]),
				force: Boolean(args.options["force"]),
				output:
					typeof args.options["output"] === "string"
						? args.options["output"]
						: undefined,
			};

			if (args.subcommand === "types") {
				// Offline mode — type generation only needs the schema registry,
				// not a live database connection
				const datrix = await loadConfig(getConfigPath(args.options), {
					skipConnection: true,
				});
				ref.datrix = datrix;
				await generateCommand("types", "", generateOptions, datrix);
				return;
			}

			const name = args.args[0];

			if (!name) {
				const argHint =
					args.subcommand === "config"
						? "<postgres|mysql|json|mongodb>"
						: "<name>";
				throw new CLIError(
					`Argument is required. Usage: datrix generate ${args.subcommand} ${argHint}`,
					"MISSING_ARGUMENT",
				);
			}

			await generateCommand(args.subcommand, name, generateOptions);
			return;
		}

		case "export": {
			const datrix = await loadConfig(getConfigPath(args.options));
			ref.datrix = datrix;
			const output =
				typeof args.options["output"] === "string"
					? args.options["output"]
					: undefined;
			const resume =
				typeof args.options["resume"] === "string"
					? args.options["resume"]
					: undefined;
			const packFilesRaw = args.options["pack-files"];

			await exportCommand(datrix.getAdapter(), {
				verbose: Boolean(args.options["verbose"]),
				includeFiles: Boolean(args.options["include-files"]),
				packFiles: packFilesRaw !== undefined,
				...(typeof packFilesRaw === "string"
					? { packFilesChunkSize: parseSize(packFilesRaw) }
					: {}),
				...(output !== undefined ? { output } : {}),
				...(resume !== undefined ? { resume } : {}),
				datrix,
			});
			return;
		}

		case "import": {
			const filePath = args.args[0];
			if (!filePath) {
				throw new CLIError(
					"Import file path is required. Usage: datrix import <path> [--agree [drop-db|missing-files]]",
					"MISSING_ARGUMENT",
				);
			}

			const datrix = await loadConfig(getConfigPath(args.options));
			ref.datrix = datrix;
			const agree = args.options["agree"];
			const resume =
				typeof args.options["resume"] === "string"
					? args.options["resume"]
					: undefined;

			await importCommand(datrix.getAdapter(), filePath, {
				agree:
					agree === true || agree === "drop-db" || agree === "missing-files"
						? agree
						: undefined,
				verbose: Boolean(args.options["verbose"]),
				withFiles: Boolean(args.options["with-files"]),
				onlyFiles: Boolean(args.options["only-files"]),
				resume,
				datrix,
			});
			return;
		}

		default: {
			throw new CLIError(
				`Unknown command: ${args.command}. Run "datrix help" for usage information.`,
				"INVALID_COMMAND",
			);
		}
	}
}

/**
 * Main CLI handler
 */
async function main(): Promise<void> {
	let args: ParsedArgs;

	try {
		args = parseArgs(process.argv.slice(2));
	} catch (error) {
		logger.error(formatError(error));
		process.exit(1);
	}

	// Show version
	if (args.options["version"] || args.command === "version") {
		console.log(`datrix v${CLI_VERSION}`);
		process.exit(0);
	}

	// Show help
	if (args.options["help"] || args.command === "help" || !args.command) {
		printHelp();
		process.exit(0);
	}

	const ref: { datrix: Datrix | undefined } = { datrix: undefined };
	let exitCode = 0;

	try {
		await runCommand(args, ref);
	} catch (error) {
		logger.error("Fatal error:", formatError(error));

		if (args.options["verbose"]) {
			console.error(error);
		}

		exitCode = 1;
	} finally {
		if (ref.datrix) {
			try {
				await ref.datrix.shutdown();
			} catch {
				// Shutdown failures must not mask the command result
			}
		}
	}

	process.exit(exitCode);
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
