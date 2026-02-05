/**
 * Query Builder Tests - Error Path
 *
 * Tests for error handling and validation
 * Target: 90%+ coverage
 */

import { describe, it, expect } from "vitest";

import { expectFailureError } from "../../../types/src/test/helpers";
import { createQueryBuilder, selectFrom } from "../../src";

describe("QueryBuilder - Error Path", () => {
	describe("Validation", () => {
		it("should fail to build without type and table", () => {
			const emptyBuilder = createQueryBuilder();
			const buildResult = emptyBuilder.build();

			const buildError = expectFailureError(buildResult);
			expect(buildError).toBeDefined();
			expect(buildError.message).toContain("type");
		});

		it("should fail without table name", () => {
			const missingTableBuilder = createQueryBuilder().type("select");
			const buildResult = missingTableBuilder.build();

			const buildError = expectFailureError(buildResult);
			expect(buildError.message).toContain("Table");
		});

		it("should fail without query type", () => {
			const missingTypeBuilder = createQueryBuilder().table("users");
			const buildResult = missingTypeBuilder.build();

			const buildError = expectFailureError(buildResult);
			expect(buildError.message).toContain("type");
		});
	});

	describe("Reset", () => {
		it("should reset query builder", () => {
			const configuredBuilder = selectFrom("users")
				.select(["id"])
				.where({ status: "active" })
				.limit(10);

			configuredBuilder.reset();

			const buildResult = configuredBuilder.build();
			const buildError = expectFailureError(buildResult);
			expect(buildError).toBeDefined();
		});
	});
});
