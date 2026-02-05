/**
 * Query Validation Utility Tests - Error Path
 *
 * Tests validation failures:
 * - Missing required fields
 * - Invalid keys with suggestions
 * - Multiple invalid keys
 */

import { describe, it, expect } from "vitest";
import { expectFailureError } from "../../packages/types/src/test/helpers";
import { validateQueryObject } from "forja-core/utils/query";

describe("Query Validation Utility - Error Path", () => {
	describe("Missing Required Fields", () => {
		it("should fail if required fields are missing", () => {
			const invalidQuery = {
				table: "users",
			};

			const validationResult = validateQueryObject(invalidQuery as any);

			const error = expectFailureError(validationResult);
			expect(error.message).toContain("missing required field: type");
		});
	});

	describe("Invalid Keys", () => {
		it('should fail if invalid keys are present (e.g., "fields" instead of "select")', () => {
			const queryWithWrongKey = {
				type: "select",
				table: "users",
				fields: ["id", "name"], // SHOULD BE 'select'
			};

			const validationResult = validateQueryObject(queryWithWrongKey as any);

			const error = expectFailureError(validationResult);
			expect(error.message).toContain(
				"Invalid keys found in QueryObject: 'fields'",
			);
			expect(error.message).toContain("did you mean 'select'?");
		});

		it("should fail if multiple invalid keys are present", () => {
			const queryWithMultipleInvalidKeys = {
				type: "select",
				table: "users",
				unknownKey: 1,
				anotherBadKey: true,
			};

			const validationResult = validateQueryObject(
				queryWithMultipleInvalidKeys as any,
			);

			const error = expectFailureError(validationResult);
			expect(error.message).toContain("'unknownKey'");
			expect(error.message).toContain("'anotherBadKey'");
		});
	});
});
