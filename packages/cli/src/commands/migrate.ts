/**
 * Migrate Command Implementation
 *
 * Runs database migrations with support for:
 * - Running pending migrations
 * - Interactive resolution of ambiguous changes
 * - Dry-run mode (--dry-run)
 * - Status display (--status)
 */

import type { MigrationSession, MigrationPlan } from "forja-core";
import type { MigrateCommandOptions } from "../types";
import { CLIError } from "../types";
import {
	logger,
	spinner,
	formatError,
	printTable,
	green,
	yellow,
	red,
	cyan,
} from "../utils/logger";
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
): Promise<void> {
	const ambiguous = session.ambiguous;

	if (ambiguous.length === 0) {
		return;
	}

	logger.log("");
	logger.log(yellow("Ambiguous changes detected:"));
	logger.log(
		"The following changes could be either renames or drop+add operations.",
	);
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
			throw new CLIError(
				`Invalid choice '${answer}'. Expected a number between ${validRange}.`,
				"EXECUTION_ERROR",
			);
		}

		const selectedAction = change.possibleActions[choice - 1]!;
		session.resolveAmbiguous(change.id, selectedAction.type);

		logger.log(green(`  → Resolved as: ${selectedAction.description}`));
		logger.log("");
	}
}

/**
 * Run pending migrations
 */
async function runPendingMigrations(
	session: MigrationSession,
	options: MigrateCommandOptions,
): Promise<void> {
	if (!session.hasChanges()) {
		logger.log("");
		logger.info("No pending migrations - database is up to date");
		logger.log("");
		return;
	}

	await resolveAmbiguousChanges(session);

	const plan = session.getPlan();

	displayPlan(plan, options.verbose ?? false);

	if (options.dryRun) {
		logger.info("Dry run - no changes applied");
		return;
	}

	const confirm = await askQuestion("Apply these migrations? (y/N): ");
	if (confirm.toLowerCase() !== "y") {
		logger.log("");
		logger.info("Migration cancelled");
		return;
	}

	spinner.start("Applying migrations...");

	let applyResult: Awaited<ReturnType<MigrationSession["apply"]>>;
	try {
		applyResult = await session.apply();
	} catch (error) {
		spinner.fail("Migration failed");
		throw new CLIError(
			`Failed to apply migrations: ${formatError(error)}`,
			"EXECUTION_ERROR",
			error,
		);
	}

	spinner.succeed("Migrations applied successfully");

	logger.log("");
	logger.log("Results:");
	const rows: (readonly string[])[] = [
		["Migration", "Status", "Time (ms)"] as const,
	];

	for (const result of applyResult) {
		const status =
			result.status === "completed" ? green("✔ Success") : red("✖ Failed");
		rows.push([
			result.migration.metadata.name,
			status,
			result.executionTime.toString(),
		] as const);
	}

	printTable(rows);
	logger.log("");
}

/**
 * Migrate command handler
 */
export async function migrateCommand(
	options: MigrateCommandOptions,
	session: MigrationSession,
): Promise<void> {
	logger.log("");
	logger.info("Forja Migration Tool");
	logger.log("");

	await runPendingMigrations(session, options);
}

/**
 * Display migration status
 */
export async function displayMigrationStatus(
	session: MigrationSession,
): Promise<void> {
	logger.log("");
	logger.log("Migration Status:");
	logger.log("");

	if (!session.hasChanges()) {
		logger.info("Database is up to date - no pending changes");
	} else {
		if (session.ambiguous.length > 0) {
			logger.log(yellow("Ambiguous changes (require resolution):"));
			for (const change of session.ambiguous) {
				logger.log(`  ? ${change.id}`);
			}
			logger.log("");
		}

		try {
			const plan = session.getPlan();
			logger.log(`Tables to create: ${plan.tablesToCreate.length}`);
			logger.log(`Tables to drop: ${plan.tablesToDrop.length}`);
			logger.log(`Tables to alter: ${plan.tablesToAlter.length}`);
			logger.log(`Total operations: ${plan.operations.length}`);
		} catch {
			logger.log(
				"Pending changes detected (resolve ambiguous changes to see details)",
			);
		}
	}

	logger.log("");
}
