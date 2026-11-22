/**
 * Migrate Command Implementation
 *
 * Runs database migrations with support for:
 * - Running pending migrations
 * - Interactive resolution of ambiguous changes
 * - Dry-run mode (--dry-run)
 * - Status display (--status)
 */

import path from "node:path";
import fs from "node:fs/promises";
import type { MigrationSession, MigrationPlan } from "@datrix/core";
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
import { ask, isInteractive } from "../utils/prompt";
import { ZipExportWriter } from "../export-import/zip-writer";
import { ZipImportReader } from "../export-import/zip-reader";

/**
 * Convert the database to the configured idType (int ↔ uuid).
 *
 * Takes a zip backup first (restorable with `datrix import`), rewrites every
 * id / foreign key / junction row and writes the old → new id mapping next to
 * the backup.
 */
async function runIdTypeChange(
	session: MigrationSession,
	options: MigrateCommandOptions,
): Promise<void> {
	const change = session.idTypeChange!;
	const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
	const backupPath = path.resolve(
		process.cwd(),
		`datrix-idtype-backup_${timestamp}.zip`,
	);
	const mappingPath = path.resolve(
		process.cwd(),
		`datrix-idtype-mapping_${timestamp}.json`,
	);

	logger.log("");
	logger.log(yellow(`idType change detected: ${change.from} → ${change.to}`));
	logger.log("");
	logger.log("  Every primary key, foreign key and junction row will be rewritten.");
	logger.log(
		change.to === "uuid"
			? "  New ids: UUID v7 derived from each record's createdAt (order preserved)."
			: "  New ids: sequential integers ordered by createdAt.",
	);
	logger.log("  All managed tables are dropped and recreated from a backup.");
	logger.log(
		red(
			"  Ids stored outside datrix (json fields, external systems, URLs) are NOT updated —",
		),
	);
	logger.log(red("  use the mapping file to update them."));
	logger.log("");
	logger.log(`  Backup:  ${backupPath}`);
	logger.log(`  Mapping: ${mappingPath}`);
	logger.log("");

	if (options.dryRun) {
		logger.info("Dry run - no changes applied");
		return;
	}

	if (!options.yes) {
		if (!isInteractive()) {
			throw new CLIError(
				"Cannot ask for confirmation: stdin is not a TTY. " +
					"Use --yes to apply the idType change non-interactively.",
				"EXECUTION_ERROR",
			);
		}

		const confirm = await ask(
			`Convert all ids from ${change.from} to ${change.to}? (y/N): `,
		);
		if (confirm.toLowerCase() !== "y") {
			logger.log("");
			logger.info("Migration cancelled");
			return;
		}
	}

	spinner.start(`Converting ids (${change.from} → ${change.to})...`);

	let result: Awaited<ReturnType<MigrationSession["applyIdTypeChange"]>>;
	try {
		result = await session.applyIdTypeChange({
			backup: new ZipExportWriter(backupPath, options.verbose),
			openBackup: () => new ZipImportReader(backupPath, options.verbose),
		});
	} catch (error) {
		spinner.fail("idType change failed");
		throw new CLIError(
			`Failed to convert ids: ${formatError(error)}. ` +
				`If a backup was written, restore it with: datrix import ${backupPath}`,
			"EXECUTION_ERROR",
			error,
		);
	}

	await fs.writeFile(
		mappingPath,
		JSON.stringify(
			{ from: change.from, to: change.to, tables: result.mapping },
			null,
			2,
		),
		"utf-8",
	);

	spinner.succeed(`Ids converted to ${change.to}`);
	logger.log("");
	for (const [table, ids] of Object.entries(result.mapping)) {
		logger.log(`  ${table}: ${Object.keys(ids).length} record(s)`);
	}
	if (result.nulledReferences > 0) {
		logger.log(
			yellow(
				`  ${result.nulledReferences} foreign key(s) pointed at missing records and were set to null`,
			),
		);
	}
	if (result.droppedJunctionRows > 0) {
		logger.log(
			yellow(
				`  ${result.droppedJunctionRows} junction row(s) pointed at missing records and were dropped`,
			),
		);
	}
	logger.log("");
	logger.info(`Backup:  ${backupPath}`);
	logger.info(`Mapping: ${mappingPath}`);
	logger.info(
		"Regenerate types (datrix generate types) so DatrixId matches the new idType.",
	);
	logger.log("");
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

	if (!isInteractive()) {
		throw new CLIError(
			"Ambiguous schema changes require interactive resolution, but stdin is not a TTY. " +
				"Run 'datrix migrate' in an interactive terminal, or adjust the schemas so the changes are unambiguous.",
			"EXECUTION_ERROR",
		);
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
		const maxAttempts = 3;
		let choice = NaN;

		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			const answer = await ask(`Choose option (${validRange}): `);
			choice = parseInt(answer, 10);

			if (
				!isNaN(choice) &&
				choice >= 1 &&
				choice <= change.possibleActions.length
			) {
				break;
			}

			if (attempt === maxAttempts) {
				throw new CLIError(
					`Invalid choice '${answer}'. Expected a number between ${validRange}.`,
					"EXECUTION_ERROR",
				);
			}

			logger.log(
				yellow(
					`  Invalid choice '${answer}'. Expected a number between ${validRange}.`,
				),
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

	if (session.idTypeChange) {
		await runIdTypeChange(session, options);
		return;
	}

	await resolveAmbiguousChanges(session);

	const plan = session.getPlan();

	displayPlan(plan, options.verbose ?? false);

	if (options.dryRun) {
		logger.info("Dry run - no changes applied");
		return;
	}

	if (!options.yes) {
		if (!isInteractive()) {
			throw new CLIError(
				"Cannot ask for confirmation: stdin is not a TTY. " +
					"Use --yes to apply migrations non-interactively.",
				"EXECUTION_ERROR",
			);
		}

		const confirm = await ask("Apply these migrations? (y/N): ");
		if (confirm.toLowerCase() !== "y") {
			logger.log("");
			logger.info("Migration cancelled");
			return;
		}
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
	logger.info("Datrix Migration Tool");
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
	} else if (session.idTypeChange) {
		logger.log(
			yellow(
				`Pending idType change: ${session.idTypeChange.from} → ${session.idTypeChange.to}`,
			),
		);
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
