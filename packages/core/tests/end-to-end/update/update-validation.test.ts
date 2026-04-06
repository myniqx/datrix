/**
 * Update Validation Tests
 *
 * Tests for validation errors during update operations
 *
 * Covers:
 * - Type validation on update
 * - String constraints on update
 * - Number constraints on update
 * - Unique constraint on update
 * - Relation validation on update
 * - Partial update validation
 * - Record not found errors
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Datrix } from "@datrix/core";
import fs from "node:fs/promises";
import { createTestConfig, getTmpDir, setupTables } from "../setup";

describe("Update Validation", () => {
	let datrix: Datrix;
	const tmpDir = getTmpDir("update_validation");

	let userId: number;
	let orgId: number;

	beforeAll(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
		await fs.mkdir(tmpDir, { recursive: true });

		const getDatrix = await createTestConfig(tmpDir);
		datrix = await getDatrix();

		await setupTables(datrix);

		// Create test data
		const org = await datrix.create("organization", {
			name: "Update Validation Org",
			country: "USA",
		});
		orgId = org.id;

		const user = await datrix.create("user", {
			email: "update-val@test.com",
			name: "Update Validation User",
			age: 30,
			organization: orgId,
		});
		userId = user.id;
	});

	afterAll(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	// ==========================================================================
	// Type Validation
	// ==========================================================================

	describe("Type Validation", () => {
		it("should fail when updating string field with number", async () => {
			await expect(
				datrix.update("user", userId, {
					name: 12345 as unknown as string,
				}),
			).rejects.toThrow();
		});

		it("should fail when updating number field with invalid string", async () => {
			await expect(
				datrix.update("user", userId, {
					age: "invalid" as unknown as number,
				}),
			).rejects.toThrow();
		});

		it("should fail when updating boolean field with string", async () => {
			await expect(
				datrix.update("user", userId, {
					isActive: "true" as unknown as boolean,
				}),
			).rejects.toThrow();
		});
	});

	// ==========================================================================
	// String Constraints
	// ==========================================================================

	describe("String Constraints", () => {
		it("should fail when updating with string exceeding maxLength", async () => {
			await expect(
				datrix.update("user", userId, {
					name: "a".repeat(300),
				}),
			).rejects.toThrow();
		});

		it("should fail when updating with string below minLength", async () => {
			const dept = await datrix.create("department", {
				name: "Test Dept",
				code: "TEST",
			});

			await expect(
				datrix.update("department", dept.id, {
					code: "A", // Too short for pattern
				}),
			).rejects.toThrow();
		});

		it("should fail when updating with invalid pattern", async () => {
			const dept = await datrix.create("department", {
				name: "Pattern Dept",
				code: "PTRN",
			});

			await expect(
				datrix.update("department", dept.id, {
					code: "invalid123", // Doesn't match ^[A-Z]{2,10}$
				}),
			).rejects.toThrow();
		});
	});

	// ==========================================================================
	// Number Constraints
	// ==========================================================================

	describe("Number Constraints", () => {
		it("should fail when updating with number below min", async () => {
			await expect(
				datrix.update("user", userId, {
					age: -10,
				}),
			).rejects.toThrow();
		});

		it("should fail when updating with number above max", async () => {
			await expect(
				datrix.update("user", userId, {
					age: 200,
				}),
			).rejects.toThrow();
		});

		it("should accept updating to null for optional number", async () => {
			const updated = await datrix.update("user", userId, {
				age: null,
			});

			expect(updated.age).toBeNull();
		});

		it("should accept updating to boundary value", async () => {
			const updated = await datrix.update("user", userId, {
				age: 0,
			});

			expect(updated.age).toBe(0);
		});
	});

	// ==========================================================================
	// Unique Constraint
	// ==========================================================================

	describe("Unique Constraint", () => {
		it("should fail when updating to duplicate unique value", async () => {
			// Create another user
			await datrix.create("user", {
				email: "existing@test.com",
				name: "Existing User",
			});

			// Try to update to same email
			await expect(
				datrix.update("user", userId, {
					email: "existing@test.com",
				}),
			).rejects.toThrow();
		});

		it("should allow updating same record with same unique value", async () => {
			// This should not fail - updating to same value
			const updated = await datrix.update("user", userId, {
				email: "update-val@test.com", // Same email
				name: "Updated Name",
			});

			expect(updated.name).toBe("Updated Name");
		});

		it("should fail on unique index violation", async () => {
			await datrix.create("category", {
				name: "Existing Cat",
				slug: "existing-cat",
			});

			const newCat = await datrix.create("category", {
				name: "New Cat",
				slug: "new-cat",
			});

			await expect(
				datrix.update("category", newCat.id, {
					slug: "existing-cat",
				}),
			).rejects.toThrow();
		});
	});

	// ==========================================================================
	// Relation Validation
	// ==========================================================================

	describe("Relation Validation", () => {
		it("should fail when updating belongsTo to non-existent", async () => {
			await expect(
				datrix.update("user", userId, {
					organization: 99999,
				}),
			).rejects.toThrow();
		});

		it("should fail when connecting manyToMany to non-existent", async () => {
			await expect(
				datrix.update("user", userId, {
					roles: { connect: [99999] },
				}),
			).rejects.toThrow();
		});

		it("should accept updating to valid relation", async () => {
			const newOrg = await datrix.create("organization", {
				name: "New Org",
				country: "UK",
			});

			const updated = await datrix.update("user", userId, {
				organization: newOrg.id,
			});

			expect(updated).toBeDefined();
		});

		it("should accept updating relation to null", async () => {
			const updated = await datrix.update("user", userId, {
				organization: { disconnect: true },
			});

			// Verify with populate
			const fetched = await datrix.findById("user", userId, {
				populate: { organization: { select: "*" } },
			});
			expect(fetched!.organization).toBeNull();
		});
	});

	// ==========================================================================
	// Record Not Found
	// ==========================================================================

	describe("Record Not Found", () => {
		it("should fail when updating non-existent record", async () => {
			await expect(
				datrix.update("user", 99999, {
					name: "Ghost",
				}),
			).rejects.toThrow();
		});

		it("should include record id in error", async () => {
			try {
				await datrix.update("user", 99999, { name: "Ghost" });
				expect.fail("Should have thrown");
			} catch (error) {
				expect((error as Error).message).toContain("99999");
			}
		});
	});

	// ==========================================================================
	// Partial Update Validation
	// ==========================================================================

	describe("Partial Update Validation", () => {
		it("should allow partial update without required fields", async () => {
			// Should not require email to be present in update
			const updated = await datrix.update("user", userId, {
				name: "Partial Update",
			});

			expect(updated.name).toBe("Partial Update");
			expect(updated.email).toBeDefined();
		});

		it("should validate only fields being updated", async () => {
			// Valid partial update
			const updated = await datrix.update("user", userId, {
				age: 35,
			});

			expect(updated.age).toBe(35);
		});

		it("should not allow setting required field to null", async () => {
			await expect(
				datrix.update("user", userId, {
					email: null as unknown as string,
				}),
			).rejects.toThrow();
		});
	});

	// ==========================================================================
	// UpdateMany Validation
	// ==========================================================================

	describe("UpdateMany Validation", () => {
		it("should validate data for all matching records", async () => {
			await expect(
				datrix.updateMany(
					"user",
					{ isActive: true },
					{ age: -10 }, // Invalid
				),
			).rejects.toThrow();
		});

		it("should fail on unique violation in updateMany", async () => {
			// Create users with different emails
			await datrix.create("user", {
				email: "target-email@test.com",
				name: "Target",
			});

			const source = await datrix.create("user", {
				email: "source-email@test.com",
				name: "Source",
			});

			// Try to update source to target's email
			await expect(
				datrix.updateMany(
					"user",
					{ id: source.id },
					{ email: "target-email@test.com" },
				),
			).rejects.toThrow();
		});
	});

	// ==========================================================================
	// Error Message Quality
	// ==========================================================================

	describe("Error Message Quality", () => {
		it("should include field name in validation error", async () => {
			try {
				await datrix.update("user", userId, { age: -10 });
				expect.fail("Should have thrown");
			} catch (error) {
				expect((error as Error).message.toLowerCase()).toContain("age");
			}
		});

		it("should indicate it's an update operation", async () => {
			try {
				await datrix.update("user", 99999, { name: "Ghost" });
				expect.fail("Should have thrown");
			} catch (error) {
				const message = (error as Error).message.toLowerCase();
				expect(
					message.includes("update") || message.includes("not found"),
				).toBe(true);
			}
		});
	});
});
