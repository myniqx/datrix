/**
 * Single Update Tests
 *
 * Tests for datrix.update() and datrix.updateMany()
 *
 * Covers:
 * - Update by id
 * - Update multiple records by where
 * - Partial updates (only specified fields)
 * - updatedAt timestamp update
 * - Validation on update
 * - Unique constraint on update
 * - Relation updates (belongsTo)
 * - Non-existent record handling
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Datrix } from "@datrix/core";
import fs from "node:fs/promises";
import {
	createTestConfig,
	getTmpDir,
	setupTables,
	seedBasicData,
	type SeedResult,
} from "../setup";
import { expectDatrixErrorAsync } from "../../test/helpers";

describe("Update Operations", () => {
	let datrix: Datrix;
	let seed: SeedResult;
	const tmpDir = getTmpDir("single_update");

	beforeAll(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
		await fs.mkdir(tmpDir, { recursive: true });

		const getDatrix = await createTestConfig(tmpDir);
		datrix = await getDatrix();

		await setupTables(datrix);

		seed = await seedBasicData(datrix);
	});

	afterAll(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	// ==========================================================================
	// Single Update (by id)
	// ==========================================================================

	describe("update (by id)", () => {
		it("should update record by id", async () => {
			const org = seed.organizations[0];
			const result = await datrix.update("organization", org.id, {
				name: "Updated Acme Corp",
			});

			expect(result.id).toBe(org.id);
			expect(result.name).toBe("Updated Acme Corp");
		});

		it("should return updated record", async () => {
			const org = seed.organizations[1];
			const result = await datrix.update("organization", org.id, {
				country: "Canada",
			});

			expect(result.country).toBe("Canada");
			expect(result).toHaveProperty("id");
			expect(result).toHaveProperty("name");
			expect(result).toHaveProperty("createdAt");
			expect(result).toHaveProperty("updatedAt");
		});

		it("should only update specified fields (partial update)", async () => {
			// Create a fresh record for this test
			const org = await datrix.create("organization", {
				name: "Partial Update Org",
				country: "Germany",
				isActive: true,
			});

			const result = await datrix.update("organization", org.id, {
				name: "New Name Only",
			});

			expect(result.name).toBe("New Name Only");
			expect(result.country).toBe("Germany"); // unchanged
			expect(result.isActive).toBe(true); // unchanged
		});

		it("should update updatedAt timestamp", async () => {
			const org = await datrix.create("organization", {
				name: "Timestamp Test Org",
				country: "France",
			});

			const originalUpdatedAt = org.updatedAt;

			// Small delay to ensure timestamp difference
			await new Promise((resolve) => setTimeout(resolve, 10));

			const result = await datrix.update("organization", org.id, {
				name: "Timestamp Updated",
			});

			expect(new Date(result.updatedAt as string).getTime()).toBeGreaterThan(
				new Date(originalUpdatedAt as string).getTime(),
			);
		});

		it("should throw error for non-existent id", async () => {
			await expectDatrixErrorAsync(async () => {
				await datrix.update("organization", 99999, {
					name: "Should Fail",
				});
			}, "RECORD_NOT_FOUND");
		});
	});

	// ==========================================================================
	// Validation on Update
	// ==========================================================================

	describe("Validation Errors", () => {
		it("should throw error when updated value violates minLength", async () => {
			const org = await datrix.create("organization", {
				name: "Valid Name",
				country: "USA",
			});

			await expectDatrixErrorAsync(async () => {
				await datrix.update("organization", org.id, {
					name: "A", // minLength is 2
				});
			}, "VALIDATION_FAILED");
		});

		it("should throw error when updated value violates max", async () => {
			const role = await datrix.create("role", {
				name: "Test Role",
				level: 50,
			});

			await expectDatrixErrorAsync(async () => {
				await datrix.update("role", role.id, {
					level: 150, // max is 100
				});
			}, "VALIDATION_FAILED");
		});

		it("should throw error when updated value violates pattern", async () => {
			const org = await datrix.create("organization", {
				name: "Pattern Update Org",
				country: "USA",
			});

			const dept = await datrix.create("department", {
				name: "Test Dept",
				code: "TEST",
				organization: org.id,
			});

			await expectDatrixErrorAsync(async () => {
				await datrix.update("department", dept.id, {
					code: "lowercase", // pattern requires uppercase
				});
			}, "VALIDATION_FAILED");
		});
	});

	// ==========================================================================
	// Unique Constraint on Update
	// ==========================================================================

	describe("Unique Constraints", () => {
		it("should throw error when update causes duplicate", async () => {
			// Create two orgs
			await datrix.create("organization", {
				name: "Unique Org A",
				country: "USA",
			});

			const orgB = await datrix.create("organization", {
				name: "Unique Org B",
				country: "UK",
			});

			// Try to update B to have same name as A
			await expectDatrixErrorAsync(async () => {
				await datrix.update("organization", orgB.id, {
					name: "Unique Org A",
				});
			}, "ADAPTER_UNIQUE_CONSTRAINT");
		});

		it("should allow updating to same value (no change)", async () => {
			const org = await datrix.create("organization", {
				name: "Same Value Org",
				country: "USA",
			});

			// Update to same name should work
			const result = await datrix.update("organization", org.id, {
				name: "Same Value Org",
			});

			expect(result.name).toBe("Same Value Org");
		});
	});

	// ==========================================================================
	// Relation Updates (BelongsTo)
	// ==========================================================================

	describe("BelongsTo Relation Updates", () => {
		it("should update belongsTo relation", async () => {
			const org1 = await datrix.create("organization", {
				name: "Dept Move Org 1",
				country: "USA",
			});

			const org2 = await datrix.create("organization", {
				name: "Dept Move Org 2",
				country: "UK",
			});

			const dept = await datrix.create("department", {
				name: "Mobile Dept",
				code: "MOBL",
				organization: org1.id,
			});

			// Move department to different org
			const result = await datrix.update(
				"department",
				dept.id,
				{
					organization: org2.id,
				},
				{ populate: { organization: true } },
			);

			expect((result.organization as { id: number }).id).toBe(org2.id);
		});

		it("should set belongsTo relation to null", async () => {
			const org = await datrix.create("organization", {
				name: "User Org",
				country: "USA",
			});

			const user = await datrix.create("user", {
				email: "relation-test@test.com",
				name: "Relation User",
				organization: org.id,
			});

			// Remove organization relation
			const result = await datrix.update(
				"user",
				user.id,
				{
					organization: null,
				},
				{ populate: { organization: true } },
			);

			expect(result.organization).toBeNull();
		});
	});

	// ==========================================================================
	// updateMany
	// ==========================================================================

	describe("updateMany", () => {
		it("should update multiple records by where clause", async () => {
			// Create test data
			await datrix.createMany("category", [
				{ name: "Batch Cat 1", slug: "batch-cat-1", isActive: true },
				{ name: "Batch Cat 2", slug: "batch-cat-2", isActive: true },
				{ name: "Batch Cat 3", slug: "batch-cat-3", isActive: false },
			]);

			// Update all active categories
			const results = await datrix.updateMany(
				"category",
				{ isActive: true },
				{ description: "Updated by batch" },
			);

			expect(results.length).toBeGreaterThanOrEqual(2);
			for (const cat of results) {
				expect(cat.description).toBe("Updated by batch");
			}
		});

		it("should return all updated records", async () => {
			await datrix.createMany("role", [
				{ name: "Batch Role 1", level: 10 },
				{ name: "Batch Role 2", level: 10 },
			]);

			const results = await datrix.updateMany(
				"role",
				{ level: 10 },
				{ level: 15 },
			);

			expect(results.length).toBeGreaterThanOrEqual(2);
			for (const role of results) {
				expect(role.level).toBe(15);
			}
		});

		it("should return empty array when no matches", async () => {
			const results = await datrix.updateMany(
				"organization",
				{ name: "Non Existent For Update" },
				{ country: "Nowhere" },
			);

			expect(results).toHaveLength(0);
		});
	});

	// ==========================================================================
	// Select Option
	// ==========================================================================

	describe("Select Option", () => {
		it("should return only selected fields after update", async () => {
			const org = await datrix.create("organization", {
				name: "Select Update Org",
				country: "USA",
				isActive: true,
			});

			const result = await datrix.update(
				"organization",
				org.id,
				{ name: "Selected Updated" },
				{ select: ["id", "name"] },
			);

			expect(result).toHaveProperty("id");
			expect(result).toHaveProperty("name");
			expect(result).toHaveProperty("createdAt");
			expect(result).toHaveProperty("updatedAt");
			expect(result).not.toHaveProperty("country");
			expect(result).not.toHaveProperty("isActive");
		});
	});

	// ==========================================================================
	// Edge Cases
	// ==========================================================================

	describe("Edge Cases", () => {
		it("should handle setting field to empty string", async () => {
			const cat = await datrix.create("category", {
				name: "Empty Desc Cat",
				slug: "empty-desc-cat",
				description: "Has description",
			});

			const result = await datrix.update("category", cat.id, {
				description: "",
			});

			expect(result.description).toBe("");
		});

		it("should handle setting field to null", async () => {
			const cat = await datrix.create("category", {
				name: "Null Desc Cat",
				slug: "null-desc-cat",
				description: "Has description",
			});

			const result = await datrix.update("category", cat.id, {
				description: null,
			});

			expect(result.description).toBeNull();
		});

		it("should handle setting numeric field to 0", async () => {
			const role = await datrix.create("role", {
				name: "Zero Level Role",
				level: 50,
			});

			// level min is 1, so 0 should fail validation
			await expectDatrixErrorAsync(async () => {
				await datrix.update("role", role.id, {
					level: 0,
				});
			}, "VALIDATION_FAILED");
		});

		it("should handle setting boolean to false", async () => {
			const org = await datrix.create("organization", {
				name: "Bool Update Org",
				country: "USA",
				isActive: true,
			});

			const result = await datrix.update("organization", org.id, {
				isActive: false,
			});

			expect(result.isActive).toBe(false);
		});

		it("should handle JSON field update", async () => {
			const user = await datrix.create("user", {
				email: "json-update@test.com",
				name: "JSON Update User",
				metadata: { original: true },
			});

			const result = await datrix.update("user", user.id, {
				metadata: { updated: true, nested: { value: 1 } },
			});

			expect(result.metadata).toEqual({ updated: true, nested: { value: 1 } });
		});
	});
});
