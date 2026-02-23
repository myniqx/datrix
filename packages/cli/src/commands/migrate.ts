/**
 * Migrate Command Implementation
 *
 * Runs database migrations with support for:
 * - Running pending migrations
 * - Interactive resolution of ambiguous changes
 * - Dry-run mode (--dry-run)
 * - Status display (--status)
 */

import type { MigrationSession, MigrationPlan, AmbiguousChange } from "forja-core";
import type { MigrateCommandOptions } from "../types";
import { CLIError } from "../types";
import { logger, spinner, formatError, printTable, green, yellow, red, cyan } from "../utils/logger";
import { Result } from "forja-types/utils";
import * as readline from "readline";

/**
 * Ask user a question via CLI
 */
async function askQuestion(question: string): Promise<string> {
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	return new Promise((resolve) => {
		rl.question(question, (answer) => {
			rl.close();
			resolve(answer.trim());
		});
	});
}

/**
 * Display migration plan
 */
function displayPlan(plan: MigrationPlan, verbose: boolean): void {
	logger.log("");
	logger.log("Migration Plan:");
	logger.log("");

	if (plan.tablesToCreate.length > 0) {
		logger.log(green("Tables to CREATE:"));
		for (const schema of plan.tablesToCreate) {
			logger.log(`  + ${schema.name}`);
			if (verbose) {
				const fields = Object.keys(schema.fields);
				logger.log(`    Fields: ${fields.join(", ")}`);
			}
		}
		logger.log("");
	}

	if (plan.tablesToDrop.length > 0) {
		logger.log(red("Tables to DROP:"));
		for (const tableName of plan.tablesToDrop) {
			logger.log(`  - ${tableName}`);
		}
		logger.log("");
	}

	if (plan.tablesToAlter.length > 0) {
		logger.log(yellow("Tables to ALTER:"));
		for (const { tableName, changes } of plan.tablesToAlter) {
			logger.log(`  ~ ${tableName}`);
			if (verbose) {
				for (const change of changes) {
					if (change.type === "fieldAdded") {
						logger.log(`    + Add column: ${change.fieldName}`);
					} else if (change.type === "fieldRemoved") {
						logger.log(`    - Drop column: ${change.fieldName}`);
					} else if (change.type === "fieldModified") {
						logger.log(`    ~ Modify column: ${change.fieldName}`);
					} else if (change.type === "indexAdded") {
						logger.log(`    + Add index: ${change.index.fields.join(", ")}`);
					} else if (change.type === "indexRemoved") {
						logger.log(`    - Drop index: ${change.indexName}`);
					}
				}
			}
		}
		logger.log("");
	}

	logger.log(`Total operations: ${plan.operations.length}`);
	logger.log("");
}

/**
 * Display ambiguous changes and ask for resolution
 */
async function resolveAmbiguousChanges(
	session: MigrationSession,
): Promise<Result<void, CLIError>> {
	const ambiguous = session.ambiguous;

	if (ambiguous.length === 0) {
		return { success: true, data: undefined };
	}

	logger.log("");
	logger.log(yellow("Ambiguous changes detected:"));
	logger.log("The following changes could be either renames or drop+add operations.");
	logger.log("");

	for (const change of ambiguous) {
		logger.log(cyan(`${change.id}`));

		if (change.warning) {
			logger.log(yellow(`  ⚠ ${change.warning}`));
		}

		logger.log("");

		for (let i = 0; i < change.possibleActions.length; i++) {
			const action = change.possibleActions[i];
			if (action) {
				logger.log(`  ${i + 1}. ${action.description}`);
			}
		}
		logger.log("");

		const validRange = `1-${change.possibleActions.length}`;
		const answer = await askQuestion(`Choose option (${validRange}): `);
		const choice = parseInt(answer, 10);

		if (isNaN(choice) || choice < 1 || choice > change.possibleActions.length) {
			return {
				success: false,
				error: new CLIError(
					`Invalid choice '${answer}'. Expected a number between ${validRange}.`,
					"EXECUTION_ERROR",
				),
			};
		}

		const selectedAction = change.possibleActions[choice - 1]!;
		const result = session.resolveAmbiguous(change.id, selectedAction.type);
		if (!result.success) {
			return {
				success: false,
				error: new CLIError(result.error.message, "EXECUTION_ERROR"),
			};
		}

		logger.log(green(`  → Resolved as: ${selectedAction.description}`));
		logger.log("");
	}

	return { success: true, data: undefined };
}

/**
 * Run pending migrations
 */
async function runPendingMigrations(
	session: MigrationSession,
	options: MigrateCommandOptions,
): Promise<Result<void, CLIError>> {
	// Check for changes
	if (!session.hasChanges()) {
		logger.log("");
		logger.info("No pending migrations - database is up to date");
		logger.log("");
		return { success: true, data: undefined };
	}

	// Resolve ambiguous changes interactively
	const resolveResult = await resolveAmbiguousChanges(session);
	if (!resolveResult.success) {
		return resolveResult;
	}

	// Get plan
	const planResult = session.getPlan();
	if (!planResult.success) {
		return {
			success: false,
			error: new CLIError(planResult.error.message, "EXECUTION_ERROR"),
		};
	}

	const plan = planResult.data;

	// Display plan
	displayPlan(plan, options.verbose ?? false);

	// Dry run check
	if (options.dryRun) {
		logger.info("Dry run - no changes applied");
		return { success: true, data: undefined };
	}

	// Ask for confirmation
	const confirm = await askQuestion("Apply these migrations? (y/N): ");
	if (confirm.toLowerCase() !== "y") {
		logger.log("");
		logger.info("Migration cancelled");
		return { success: true, data: undefined };
	}

	// Apply migrations
	spinner.start("Applying migrations...");

	const applyResult = await session.apply();
	if (!applyResult.success) {
		spinner.fail("Migration failed");
		return {
			success: false,
			error: new CLIError(applyResult.error.message, "EXECUTION_ERROR"),
		};
	}

	spinner.succeed("Migrations applied successfully");

	// Display results
	logger.log("");
	logger.log("Results:");
	const rows: (readonly string[])[] = [["Migration", "Status", "Time (ms)"] as const];

	for (const result of applyResult.data) {
		const status = result.status === "completed" ? green("✔ Success") : red("✖ Failed");
		rows.push([
			result.migration.metadata.name,
			status,
			result.executionTime.toString(),
		] as const);
	}

	printTable(rows);
	logger.log("");

	return { success: true, data: undefined };
}

/**
 * Migrate command handler
 */
export async function migrateCommand(
	options: MigrateCommandOptions,
	session: MigrationSession,
): Promise<Result<void, CLIError>> {
	try {
		logger.log("");
		logger.info("Forja Migration Tool");
		logger.log("");

		return await runPendingMigrations(session, options);
	} catch (error) {
		return {
			success: false,
			error: new CLIError(
				`Migration command failed: ${formatError(error)}`,
				"EXECUTION_ERROR",
				error,
			),
		};
	}
}

/**
 * Display migration status
 */
export async function displayMigrationStatus(
	session: MigrationSession,
): Promise<Result<void, CLIError>> {
	try {
		logger.log("");
		logger.log("Migration Status:");
		logger.log("");

		if (!session.hasChanges()) {
			logger.info("Database is up to date - no pending changes");
		} else {
			const planResult = session.getPlan();

			// If there are ambiguous changes, show them
			if (session.ambiguous.length > 0) {
				logger.log(yellow("Ambiguous changes (require resolution):"));
				for (const change of session.ambiguous) {
					logger.log(`  ? ${change.id}`);
				}
				logger.log("");
			}

			if (planResult.success) {
				const plan = planResult.data;
				logger.log(`Tables to create: ${plan.tablesToCreate.length}`);
				logger.log(`Tables to drop: ${plan.tablesToDrop.length}`);
				logger.log(`Tables to alter: ${plan.tablesToAlter.length}`);
				logger.log(`Total operations: ${plan.operations.length}`);
			} else {
				logger.log("Pending changes detected (resolve ambiguous changes to see details)");
			}
		}

		logger.log("");

		return { success: true, data: undefined };
	} catch (error) {
		return {
			success: false,
			error: new CLIError(
				`Failed to display migration status: ${formatError(error)}`,
				"EXECUTION_ERROR",
				error,
			),
		};
	}
}
