/**
 * Count Tests
 *
 * Tests for forja.count() functionality
 *
 * Covers:
 * - Basic count (all records)
 * - Count with simple where
 * - Count with complex where ($and, $or)
 * - Count with nested relation where
 * - Count with operators ($gt, $in, etc.)
 * - Edge cases (empty results, large data)
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Forja } from "forja-core";
import fs from "node:fs/promises";
import { createTestConfig, getTmpDir, setupTables } from "../setup";

describe("Count", () => {
	let forja: Forja;
	const tmpDir = getTmpDir("count");

	let orgId: number;
	let deptId: number;

	beforeAll(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
		await fs.mkdir(tmpDir, { recursive: true });

		const getForja = await createTestConfig(tmpDir);
		forja = await getForja();

		await setupTables(forja);

		// Create test data
		const org = await forja.create("organization", {
			name: "Count Test Org",
			country: "USA",
		});
		orgId = org.id;

		const dept = await forja.create("department", {
			name: "Count Test Dept",
			code: "CTD",
			organization: orgId,
		});
		deptId = dept.id;

		// Create users with various attributes
		await forja.createMany("user", [
			{ email: "user1@test.com", name: "User 1", age: 25, isActive: true, organization: orgId, department: deptId },
			{ email: "user2@test.com", name: "User 2", age: 30, isActive: true, organization: orgId },
			{ email: "user3@test.com", name: "User 3", age: 35, isActive: false, organization: orgId },
			{ email: "user4@test.com", name: "User 4", age: 40, isActive: true },
			{ email: "user5@test.com", name: "User 5", age: 45, isActive: false },
			{ email: "user6@test.com", name: "User 6", age: 25, isActive: true, organization: orgId },
			{ email: "user7@test.com", name: "User 7", age: 30, isActive: true },
			{ email: "user8@test.com", name: "User 8", age: 35, isActive: false, organization: orgId },
			{ email: "user9@test.com", name: "User 9", age: 40, isActive: true, organization: orgId, department: deptId },
			{ email: "user10@test.com", name: "User 10", age: 50, isActive: true },
		]);
	});

	afterAll(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	// ==========================================================================
	// Basic Count
	// ==========================================================================

	describe("Basic Count", () => {
		it("should count all records", async () => {
			const count = await forja.count("user");

			expect(count).toBe(10);
		});

		it("should return 0 for empty table", async () => {
			const count = await forja.count("tag");

			expect(count).toBe(0);
		});

		it("should count different models", async () => {
			const userCount = await forja.count("user");
			const orgCount = await forja.count("organization");
			const deptCount = await forja.count("department");

			expect(userCount).toBe(10);
			expect(orgCount).toBe(1);
			expect(deptCount).toBe(1);
		});
	});

	// ==========================================================================
	// Count with Simple Where
	// ==========================================================================

	describe("Count with Simple Where", () => {
		it("should count with equality filter", async () => {
			const count = await forja.count("user", { isActive: true });

			expect(count).toBe(7);
		});

		it("should count with number filter", async () => {
			const count = await forja.count("user", { age: 25 });

			expect(count).toBe(2);
		});

		it("should count with string filter", async () => {
			const count = await forja.count("user", { name: "User 1" });

			expect(count).toBe(1);
		});

		it("should return 0 for no matches", async () => {
			const count = await forja.count("user", { age: 999 });

			expect(count).toBe(0);
		});
	});

	// ==========================================================================
	// Count with Operators
	// ==========================================================================

	describe("Count with Operators", () => {
		it("should count with $gt operator", async () => {
			const count = await forja.count("user", { age: { $gt: 35 } });

			// age > 35: 40, 45, 40, 50 = 4 users
			expect(count).toBe(4);
		});

		it("should count with $gte operator", async () => {
			const count = await forja.count("user", { age: { $gte: 35 } });

			// age >= 35: 35, 40, 45, 35, 40, 50 = 6 users
			expect(count).toBe(6);
		});

		it("should count with $lt operator", async () => {
			const count = await forja.count("user", { age: { $lt: 30 } });

			// age < 30: 25, 25 = 2 users
			expect(count).toBe(2);
		});

		it("should count with $lte operator", async () => {
			const count = await forja.count("user", { age: { $lte: 30 } });

			// age <= 30: 25, 30, 25, 30 = 4 users
			expect(count).toBe(4);
		});

		it("should count with $ne operator", async () => {
			const count = await forja.count("user", { isActive: { $ne: true } });

			expect(count).toBe(3);
		});

		it("should count with $in operator", async () => {
			const count = await forja.count("user", { age: { $in: [25, 30] } });

			expect(count).toBe(4);
		});

		it("should count with $nin operator", async () => {
			const count = await forja.count("user", { age: { $nin: [25, 30] } });

			expect(count).toBe(6);
		});

		it("should count with $like operator", async () => {
			const count = await forja.count("user", { email: { $like: "user1%" } });

			// user1@, user10@
			expect(count).toBe(2);
		});
	});

	// ==========================================================================
	// Count with Complex Where ($and, $or)
	// ==========================================================================

	describe("Count with Complex Where", () => {
		it("should count with $and", async () => {
			const count = await forja.count("user", {
				$and: [
					{ isActive: true },
					{ age: { $gte: 30 } },
				],
			});

			// Active AND age >= 30: User 2(30), User 4(40), User 7(30), User 9(40), User 10(50) = 5
			expect(count).toBe(5);
		});

		it("should count with $or", async () => {
			const count = await forja.count("user", {
				$or: [
					{ age: 25 },
					{ age: 50 },
				],
			});

			// age 25 or 50: User 1, User 6, User 10 = 3
			expect(count).toBe(3);
		});

		it("should count with nested $and and $or", async () => {
			const count = await forja.count("user", {
				$and: [
					{ isActive: true },
					{
						$or: [
							{ age: { $lt: 30 } },
							{ age: { $gt: 45 } },
						],
					},
				],
			});

			// Active AND (age < 30 OR age > 45): User 1(25), User 6(25), User 10(50) = 3
			expect(count).toBe(3);
		});

		it("should count with implicit AND (multiple fields)", async () => {
			const count = await forja.count("user", {
				isActive: true,
				age: { $gte: 40 },
			});

			// Active AND age >= 40: User 4(40), User 9(40), User 10(50) = 3
			expect(count).toBe(3);
		});
	});

	// ==========================================================================
	// Count with Relation Where
	// ==========================================================================

	describe("Count with Relation Where", () => {
		it("should count by belongsTo relation id", async () => {
			const count = await forja.count("user", {
				organization: { id: orgId },
			});

			// Users with organization: 1, 2, 3, 6, 8, 9 = 6
			expect(count).toBe(6);
		});

		it("should count by belongsTo relation field", async () => {
			const count = await forja.count("user", {
				organization: { name: "Count Test Org" },
			});

			expect(count).toBe(6);
		});

		it("should count with multiple relation filters", async () => {
			const count = await forja.count("user", {
				organization: { id: orgId },
				department: { id: deptId },
			});

			// Users with both org and dept: User 1, User 9 = 2
			expect(count).toBe(2);
		});

		it("should count combining relation and field filters", async () => {
			const count = await forja.count("user", {
				organization: { id: orgId },
				isActive: true,
			});

			// Users with org AND active: User 1, User 2, User 6, User 9 = 4
			expect(count).toBe(4);
		});
	});

	// ==========================================================================
	// Edge Cases
	// ==========================================================================

	describe("Edge Cases", () => {
		it("should handle null field comparison", async () => {
			const countWithOrg = await forja.count("user", {
				organization: { $notNull: true },
			});

			const countWithoutOrg = await forja.count("user", {
				organization: { $null: true },
			});

			expect(countWithOrg).toBe(6);
			expect(countWithoutOrg).toBe(4);
		});

		it("should count after bulk create", async () => {
			const beforeCount = await forja.count("tag");

			await forja.createMany("tag", [
				{ name: "CountTag1", color: "#111111" },
				{ name: "CountTag2", color: "#222222" },
				{ name: "CountTag3", color: "#333333" },
			]);

			const afterCount = await forja.count("tag");

			expect(afterCount).toBe(beforeCount + 3);
		});

		it("should count after delete", async () => {
			const beforeCount = await forja.count("tag");

			await forja.deleteMany("tag", { name: { $like: "CountTag%" } });

			const afterCount = await forja.count("tag");

			expect(afterCount).toBe(beforeCount - 3);
		});

		it("should handle large count efficiently", async () => {
			// Create many records
			const bulkUsers = Array.from({ length: 100 }, (_, i) => ({
				email: `bulk${i}@count.com`,
				name: `Bulk User ${i}`,
				age: 20 + (i % 30),
				isActive: i % 2 === 0,
			}));

			await forja.createMany("user", bulkUsers);

			const start = performance.now();
			const count = await forja.count("user");
			const duration = performance.now() - start;

			expect(count).toBe(110); // 10 original + 100 bulk
			expect(duration).toBeLessThan(1000); // Should be fast
		});
	});
});
