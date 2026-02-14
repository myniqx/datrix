/**
 * Multi Delete Tests
 *
 * Tests for forja.deleteMany() with where clause
 *
 * Covers:
 * - Delete multiple records by where
 * - Delete with complex where ($and, $or)
 * - Delete with relation where
 * - Delete with operators
 * - Return all deleted records
 * - Junction table cleanup for manyToMany
 * - Edge cases (no matches, large batch)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Forja } from "forja-core";
import fs from "node:fs/promises";
import { createTestConfig, getTmpDir, setupTables } from "../setup";

describe("Multi Delete", () => {
	let forja: Forja;
	const tmpDir = getTmpDir("multi_delete");

	let orgId: number;

	beforeAll(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
		await fs.mkdir(tmpDir, { recursive: true });

		const getForja = await createTestConfig(tmpDir);
		forja = await getForja();

		await setupTables(forja);

		// Create organization for relation tests
		const org = await forja.create("organization", {
			name: "Multi Delete Org",
			country: "USA",
		});
		orgId = org.id;
	});

	beforeEach(async () => {
		// Clean up users before each test
		await forja.deleteMany("user", {});

		// Create fresh test data
		await forja.createMany("user", [
			{ email: "del1@test.com", name: "User 1", age: 25, isActive: true, organization: orgId },
			{ email: "del2@test.com", name: "User 2", age: 30, isActive: true, organization: orgId },
			{ email: "del3@test.com", name: "User 3", age: 35, isActive: false, organization: orgId },
			{ email: "del4@test.com", name: "User 4", age: 40, isActive: true },
			{ email: "del5@test.com", name: "User 5", age: 45, isActive: false },
		]);
	});

	afterAll(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	// ==========================================================================
	// Basic Multi Delete
	// ==========================================================================

	describe("Basic Multi Delete", () => {
		it("should delete multiple records by simple where", async () => {
			const deleted = await forja.deleteMany("user", { isActive: true });

			expect(deleted.length).toBe(3);

			// Verify deletion
			const remaining = await forja.count("user");
			expect(remaining).toBe(2);
		});

		it("should return empty array when no matches", async () => {
			const deleted = await forja.deleteMany("user", { age: 999 });

			expect(deleted).toHaveLength(0);

			// Verify nothing deleted
			const count = await forja.count("user");
			expect(count).toBe(5);
		});

		it("should delete single record when where matches one", async () => {
			const deleted = await forja.deleteMany("user", { email: "del5@test.com" });

			expect(deleted).toHaveLength(1);
			expect(deleted[0].email).toBe("del5@test.com");
		});
	});

	// ==========================================================================
	// Delete with Operators
	// ==========================================================================

	describe("Delete with Operators", () => {
		it("should delete with $gt operator", async () => {
			const deleted = await forja.deleteMany("user", { age: { $gt: 35 } });

			// age > 35: User 4 (40), User 5 (45) = 2
			expect(deleted.length).toBe(2);

			const remaining = await forja.count("user");
			expect(remaining).toBe(3);
		});

		it("should delete with $in operator", async () => {
			const deleted = await forja.deleteMany("user", {
				age: { $in: [25, 45] },
			});

			expect(deleted.length).toBe(2);
		});

		it("should delete with $like operator", async () => {
			const deleted = await forja.deleteMany("user", {
				email: { $like: "del%@test.com" },
			});

			expect(deleted.length).toBe(5);
		});

		it("should delete with $ne operator", async () => {
			const deleted = await forja.deleteMany("user", {
				isActive: { $ne: true },
			});

			// Inactive: User 3, User 5 = 2
			expect(deleted.length).toBe(2);
		});
	});

	// ==========================================================================
	// Delete with Complex Where
	// ==========================================================================

	describe("Delete with Complex Where", () => {
		it("should delete with $and", async () => {
			const deleted = await forja.deleteMany("user", {
				$and: [
					{ isActive: false },
					{ age: { $gte: 40 } },
				],
			});

			// Inactive AND age >= 40: User 5 (45) = 1
			expect(deleted.length).toBe(1);
		});

		it("should delete with $or", async () => {
			const deleted = await forja.deleteMany("user", {
				$or: [
					{ age: 25 },
					{ age: 45 },
				],
			});

			// age 25 or 45: User 1, User 5 = 2
			expect(deleted.length).toBe(2);
		});

		it("should delete with implicit AND", async () => {
			const deleted = await forja.deleteMany("user", {
				isActive: true,
				age: { $lte: 30 },
			});

			// Active AND age <= 30: User 1 (25), User 2 (30) = 2
			expect(deleted.length).toBe(2);
		});
	});

	// ==========================================================================
	// Delete with Relation Where
	// ==========================================================================

	describe("Delete with Relation Where", () => {
		it("should delete by belongsTo relation id", async () => {
			const deleted = await forja.deleteMany("user", {
				organization: { id: orgId },
			});

			// Users with organization: 1, 2, 3 = 3
			expect(deleted.length).toBe(3);
		});

		it("should delete by belongsTo relation field", async () => {
			const deleted = await forja.deleteMany("user", {
				organization: { name: "Multi Delete Org" },
			});

			expect(deleted.length).toBe(3);
		});

		it("should combine relation and field filters", async () => {
			const deleted = await forja.deleteMany("user", {
				organization: { id: orgId },
				isActive: true,
			});

			// Users with org AND active: User 1, User 2 = 2
			expect(deleted.length).toBe(2);
		});
	});

	// ==========================================================================
	// Delete All
	// ==========================================================================

	describe("Delete All", () => {
		it("should delete all records with empty where", async () => {
			const beforeCount = await forja.count("user");
			expect(beforeCount).toBe(5);

			const deleted = await forja.deleteMany("user", {});

			expect(deleted.length).toBe(5);

			const afterCount = await forja.count("user");
			expect(afterCount).toBe(0);
		});
	});

	// ==========================================================================
	// Return Values
	// ==========================================================================

	describe("Return Values", () => {
		it("should return deleted records with all fields", async () => {
			const deleted = await forja.deleteMany("user", { age: 25 });

			expect(deleted.length).toBe(1);
			expect(deleted[0]).toHaveProperty("id");
			expect(deleted[0]).toHaveProperty("email");
			expect(deleted[0]).toHaveProperty("name");
			expect(deleted[0]).toHaveProperty("age");
			expect(deleted[0].age).toBe(25);
		});

		it("should return records with populate", async () => {
			const deleted = await forja.deleteMany(
				"user",
				{ organization: { id: orgId } },
				{ populate: { organization: { select: "*" } } },
			);

			for (const user of deleted) {
				expect(user.organization).toBeDefined();
				expect((user.organization as { name: string }).name).toBe("Multi Delete Org");
			}
		});
	});

	// ==========================================================================
	// ManyToMany Junction Cleanup
	// ==========================================================================

	describe("ManyToMany Junction Cleanup", () => {
		it("should clean up junction table when deleting record with manyToMany", async () => {
			// Create roles
			const roles = await forja.createMany("role", [
				{ name: "Role A", level: 10 },
				{ name: "Role B", level: 20 },
			]);

			// Create user with roles
			const user = await forja.create("user", {
				email: "m2m-delete@test.com",
				name: "M2M User",
				roles: { connect: roles.map((r) => r.id) },
			});

			// Verify roles are connected
			const withRoles = await forja.findById("user", user.id, {
				populate: { roles: { select: "*" } },
			});
			expect((withRoles!.roles as unknown[]).length).toBe(2);

			// Delete the user
			await forja.delete("user", user.id);

			// Verify user is deleted
			const deleted = await forja.findById("user", user.id);
			expect(deleted).toBeNull();

			// Roles should still exist
			const rolesAfter = await forja.count("role");
			expect(rolesAfter).toBe(2);
		});
	});

	// ==========================================================================
	// Edge Cases
	// ==========================================================================

	describe("Edge Cases", () => {
		it("should handle large batch delete", async () => {
			// Create many users
			const bulkUsers = Array.from({ length: 100 }, (_, i) => ({
				email: `bulkdel${i}@test.com`,
				name: `Bulk User ${i}`,
				age: 20 + (i % 30),
			}));
			await forja.createMany("user", bulkUsers);

			const start = performance.now();

			const deleted = await forja.deleteMany("user", {
				email: { $like: "bulkdel%@test.com" },
			});

			const duration = performance.now() - start;

			expect(deleted.length).toBe(100);
			expect(duration).toBeLessThan(5000);
		});

		it("should not delete unrelated records", async () => {
			// Create isolated user
			const isolated = await forja.create("user", {
				email: "isolated-del@test.com",
				name: "Isolated User",
				age: 100,
			});

			// Delete users with different criteria
			await forja.deleteMany("user", { age: { $lt: 50 } });

			// Verify isolated user still exists
			const stillExists = await forja.findById("user", isolated.id);
			expect(stillExists).not.toBeNull();
		});

		it("should handle delete with null relation", async () => {
			const deleted = await forja.deleteMany("user", {
				organization: { $null: true },
			});

			// Users without org: User 4, User 5 = 2
			expect(deleted.length).toBe(2);
		});
	});
});
