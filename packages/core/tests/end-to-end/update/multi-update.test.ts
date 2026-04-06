/**
 * Multi Update Tests
 *
 * Tests for datrix.updateMany() with where clause
 *
 * Covers:
 * - Update multiple records by where
 * - Update with complex where ($and, $or)
 * - Update with relation where
 * - Update with operators
 * - Return all updated records
 * - Edge cases (no matches, large batch)
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Datrix } from "@datrix/core";
import fs from "node:fs/promises";
import { createTestConfig, getTmpDir, setupTables } from "../setup";

describe("Multi Update", () => {
	let datrix: Datrix;
	const tmpDir = getTmpDir("multi_update");

	let orgId: number;

	beforeAll(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
		await fs.mkdir(tmpDir, { recursive: true });

		const getDatrix = await createTestConfig(tmpDir);
		datrix = await getDatrix();

		await setupTables(datrix);

		// Create test data
		const org = await datrix.create("organization", {
			name: "Multi Update Org",
			country: "USA",
		});
		orgId = org.id;

		await datrix.createMany("user", [
			{
				email: "multi1@test.com",
				name: "User 1",
				age: 25,
				isActive: true,
				organization: orgId,
			},
			{
				email: "multi2@test.com",
				name: "User 2",
				age: 30,
				isActive: true,
				organization: orgId,
			},
			{
				email: "multi3@test.com",
				name: "User 3",
				age: 35,
				isActive: false,
				organization: orgId,
			},
			{ email: "multi4@test.com", name: "User 4", age: 40, isActive: true },
			{ email: "multi5@test.com", name: "User 5", age: 45, isActive: false },
		]);
	});

	afterAll(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	// ==========================================================================
	// Basic Multi Update
	// ==========================================================================

	describe("Basic Multi Update", () => {
		it("should update multiple records by simple where", async () => {
			const updated = await datrix.updateMany(
				"user",
				{ isActive: true },
				{ name: "Active User" },
			);

			expect(updated.length).toBe(3);
			for (const user of updated) {
				expect(user.name).toBe("Active User");
			}
		});

		it("should return empty array when no matches", async () => {
			const updated = await datrix.updateMany(
				"user",
				{ age: 999 },
				{ name: "No One" },
			);

			expect(updated).toHaveLength(0);
		});

		it("should update single record when where matches one", async () => {
			const updated = await datrix.updateMany(
				"user",
				{ email: "multi5@test.com" },
				{ name: "Updated User 5" },
			);

			expect(updated).toHaveLength(1);
			expect(updated[0].name).toBe("Updated User 5");
		});
	});

	// ==========================================================================
	// Update with Operators
	// ==========================================================================

	describe("Update with Operators", () => {
		it("should update with $gt operator", async () => {
			const updated = await datrix.updateMany(
				"user",
				{ age: { $gt: 35 } },
				{ isActive: false },
			);

			// age > 35: User 4 (40), User 5 (45) = 2
			expect(updated.length).toBe(2);
			for (const user of updated) {
				expect(user.isActive).toBe(false);
			}
		});

		it("should update with $in operator", async () => {
			const updated = await datrix.updateMany(
				"user",
				{ age: { $in: [25, 30] } },
				{ isActive: true },
			);

			expect(updated.length).toBe(2);
		});

		it("should update with $like operator", async () => {
			const updated = await datrix.updateMany(
				"user",
				{ email: { $like: "multi%@test.com" } },
				{ metadata: { source: "bulk-update" } },
			);

			expect(updated.length).toBe(5);
		});
	});

	// ==========================================================================
	// Update with Complex Where
	// ==========================================================================

	describe("Update with Complex Where", () => {
		it("should update with $and", async () => {
			const updated = await datrix.updateMany(
				"user",
				{
					$and: [{ isActive: false }, { age: { $gte: 40 } }],
				},
				{ name: "Inactive Senior" },
			);

			// Inactive AND age >= 40: User 5 (45, inactive)
			expect(updated.length).toBeGreaterThanOrEqual(1);
			for (const user of updated) {
				expect(user.name).toBe("Inactive Senior");
			}
		});

		it("should update with $or", async () => {
			const updated = await datrix.updateMany(
				"user",
				{
					$or: [{ age: 25 }, { age: 45 }],
				},
				{ metadata: { ageGroup: "extreme" } },
			);

			expect(updated.length).toBe(2);
		});

		it("should update with implicit AND", async () => {
			// Reset first
			await datrix.updateMany("user", {}, { isActive: true });

			const updated = await datrix.updateMany(
				"user",
				{
					isActive: true,
					age: { $lte: 30 },
				},
				{ name: "Young Active" },
			);

			expect(updated.length).toBe(2);
		});
	});

	// ==========================================================================
	// Update with Relation Where
	// ==========================================================================

	describe("Update with Relation Where", () => {
		it("should update by belongsTo relation id", async () => {
			const updated = await datrix.updateMany(
				"user",
				{ organization: { id: orgId } },
				{ name: "Org Member" },
			);

			// Users with organization: 1, 2, 3
			expect(updated.length).toBe(3);
		});

		it("should update by belongsTo relation field", async () => {
			const updated = await datrix.updateMany(
				"user",
				{ organization: { name: "Multi Update Org" } },
				{ metadata: { fromOrg: true } },
			);

			expect(updated.length).toBe(3);
		});

		it("should combine relation and field filters", async () => {
			const updated = await datrix.updateMany(
				"user",
				{
					organization: { id: orgId },
					age: { $lt: 35 },
				},
				{ name: "Young Org Member" },
			);

			// Users 1 (25) and 2 (30) have org and age < 35
			expect(updated.length).toBe(2);
		});
	});

	// ==========================================================================
	// Update All (Empty Where)
	// ==========================================================================

	describe("Update All", () => {
		it("should update all records with empty where", async () => {
			const beforeCount = await datrix.count("user");

			const updated = await datrix.updateMany("user", {}, { isActive: true });

			expect(updated.length).toBe(beforeCount);
		});
	});

	// ==========================================================================
	// Return Values
	// ==========================================================================

	describe("Return Values", () => {
		it("should return updated records with new values", async () => {
			const updated = await datrix.updateMany("user", { age: 25 }, { age: 26 });

			for (const user of updated) {
				expect(user.age).toBe(26);
			}
		});

		it("should update updatedAt timestamp", async () => {
			const before = new Date();

			// Small delay to ensure timestamp difference
			await new Promise((r) => setTimeout(r, 10));

			const updated = await datrix.updateMany(
				"user",
				{ age: 26 },
				{ name: "Timestamp Test" },
			);

			for (const user of updated) {
				expect(new Date(user.updatedAt).getTime()).toBeGreaterThan(
					before.getTime(),
				);
			}
		});

		it("should return records with populate", async () => {
			const updated = await datrix.updateMany(
				"user",
				{ organization: { id: orgId } },
				{ name: "Populated Update" },
				{ populate: { organization: { select: "*" } } },
			);

			for (const user of updated) {
				expect(user.organization).toBeDefined();
				expect((user.organization as { name: string }).name).toBe(
					"Multi Update Org",
				);
			}
		});
	});

	// ==========================================================================
	// Edge Cases
	// ==========================================================================

	describe("Edge Cases", () => {
		it("should handle large batch update", async () => {
			// Create many users
			const bulkUsers = Array.from({ length: 50 }, (_, i) => ({
				email: `bulkupdate${i}@test.com`,
				name: `Bulk User ${i}`,
				age: 20 + (i % 30),
			}));
			await datrix.createMany("user", bulkUsers);

			const start = performance.now();

			const updated = await datrix.updateMany(
				"user",
				{ email: { $like: "bulkupdate%@test.com" } },
				{ isActive: false },
			);

			const duration = performance.now() - start;

			expect(updated.length).toBe(50);
			expect(duration).toBeLessThan(5000);
		});

		it("should not update unrelated records", async () => {
			// Create isolated user
			const isolated = await datrix.create("user", {
				email: "isolated@test.com",
				name: "Isolated User",
				age: 100,
			});

			// Update users with different criteria
			await datrix.updateMany(
				"user",
				{ age: { $lt: 50 } },
				{ name: "Not Isolated" },
			);

			// Verify isolated user unchanged
			const unchanged = await datrix.findById("user", isolated.id);
			expect(unchanged!.name).toBe("Isolated User");
		});
	});
});
