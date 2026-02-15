/**
 * Migration Setup Helper
 *
 * Creates MigrationSession from a Forja instance.
 * This is a thin wrapper around forja.beginMigrate()
 */

import type { Forja } from "forja-core";
import type { MigrationSession } from "forja-core";
import { CLIError } from "../types";
import { Result } from "forja-types/utils";

/**
 * Create a MigrationSession from an initialized Forja instance
 *
 * Simply wraps forja.beginMigrate() and converts errors to CLIError
 */
export async function createMigrationSetup(
	forja: Forja,
): Promise<Result<MigrationSession, CLIError>> {
	const result = await forja.beginMigrate();

	if (!result.success) {
		return {
			success: false,
			error: new CLIError(
				result.error.message,
				"EXECUTION_ERROR",
				result.error,
			),
		};
	}

	return { success: true, data: result.data };
}
