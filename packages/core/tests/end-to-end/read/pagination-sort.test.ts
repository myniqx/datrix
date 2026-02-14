/**
 * Pagination & Sort Tests
 *
 * Tests for limit, offset, and orderBy functionality
 *
 * Covers:
 * - Basic limit
 * - Basic offset
 * - Limit + offset combination (pagination)
 * - OrderBy single field (asc/desc)
 * - OrderBy multiple fields
 * - OrderBy with limit/offset
 * - OrderBy shortcut formats (object, string array)
 * - Edge cases (limit 0, offset beyond data, etc.)
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Forja } from "forja-core";
import fs from "node:fs/promises";
import { createTestConfig, getTmpDir, setupTables } from "../setup";

describe("Pagination & Sort", () => {
	let forja: Forja;
	const tmpDir = getTmpDir("pagination_sort");

	// Store created user IDs for verification
	let userIds: number[];

	beforeAll(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
		await fs.mkdir(tmpDir, { recursive: true });

		const getForja = await createTestConfig(tmpDir);
		forja = await getForja();

		await setupTables(forja);

		// Create test users with predictable data for sorting tests
		const users = await forja.createMany("user", [
			{ email: "alice@test.com", name: "Alice", age: 30, isActive: true },
			{ email: "bob@test.com", name: "Bob", age: 25, isActive: false },
			{ email: "charlie@test.com", name: "Charlie", age: 35, isActive: true },
			{ email: "diana@test.com", name: "Diana", age: 25, isActive: true },
			{ email: "eve@test.com", name: "Eve", age: 40, isActive: false },
			{ email: "frank@test.com", name: "Frank", age: 30, isActive: true },
			{ email: "grace@test.com", name: "Grace", age: 28, isActive: true },
			{ email: "henry@test.com", name: "Henry", age: 35, isActive: false },
			{ email: "iris@test.com", name: "Iris", age: 22, isActive: true },
			{ email: "jack@test.com", name: "Jack", age: 45, isActive: true },
		]);
		userIds = users.map((u) => u.id);
	});

	afterAll(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	// ==========================================================================
	// Basic Limit
	// ==========================================================================

	describe("Limit", () => {
		it("should limit results to specified count", async () => {
			const users = await forja.findMany("user", { limit: 3 });

			expect(users).toHaveLength(3);
		});

		it("should return all results when limit exceeds total", async () => {
			const users = await forja.findMany("user", { limit: 100 });

			expect(users).toHaveLength(10);
		});

		it("should return empty array when limit is 0", async () => {
			const users = await forja.findMany("user", { limit: 0 });

			expect(users).toHaveLength(0);
		});

		it("should work with where clause", async () => {
			const users = await forja.findMany("user", {
				where: { isActive: true },
				limit: 2,
			});

			expect(users).toHaveLength(2);
			for (const user of users) {
				expect(user.isActive).toBe(true);
			}
		});
	});

	// ==========================================================================
	// Basic Offset
	// ==========================================================================

	describe("Offset", () => {
		it("should skip specified number of records", async () => {
			const allUsers = await forja.findMany("user", {
				orderBy: [{ field: "id", direction: "asc" }],
			});
			const offsetUsers = await forja.findMany("user", {
				orderBy: [{ field: "id", direction: "asc" }],
				offset: 3,
			});

			expect(offsetUsers).toHaveLength(7);
			expect(offsetUsers[0].id).toBe(allUsers[3].id);
		});

		it("should return empty array when offset exceeds total", async () => {
			const users = await forja.findMany("user", { offset: 100 });

			expect(users).toHaveLength(0);
		});

		it("should return all when offset is 0", async () => {
			const users = await forja.findMany("user", { offset: 0 });

			expect(users).toHaveLength(10);
		});
	});

	// ==========================================================================
	// Pagination (Limit + Offset)
	// ==========================================================================

	describe("Pagination", () => {
		it("should paginate correctly - page 1", async () => {
			const page1 = await forja.findMany("user", {
				orderBy: [{ field: "id", direction: "asc" }],
				limit: 3,
				offset: 0,
			});

			expect(page1).toHaveLength(3);
			expect(page1[0].id).toBe(userIds[0]);
			expect(page1[2].id).toBe(userIds[2]);
		});

		it("should paginate correctly - page 2", async () => {
			const page2 = await forja.findMany("user", {
				orderBy: [{ field: "id", direction: "asc" }],
				limit: 3,
				offset: 3,
			});

			expect(page2).toHaveLength(3);
			expect(page2[0].id).toBe(userIds[3]);
			expect(page2[2].id).toBe(userIds[5]);
		});

		it("should paginate correctly - last partial page", async () => {
			const lastPage = await forja.findMany("user", {
				orderBy: [{ field: "id", direction: "asc" }],
				limit: 3,
				offset: 9,
			});

			expect(lastPage).toHaveLength(1);
			expect(lastPage[0].id).toBe(userIds[9]);
		});

		it("should work with where clause", async () => {
			// 7 active users total
			const page1 = await forja.findMany("user", {
				where: { isActive: true },
				orderBy: [{ field: "id", direction: "asc" }],
				limit: 3,
				offset: 0,
			});

			const page2 = await forja.findMany("user", {
				where: { isActive: true },
				orderBy: [{ field: "id", direction: "asc" }],
				limit: 3,
				offset: 3,
			});

			expect(page1).toHaveLength(3);
			expect(page2).toHaveLength(3);

			// No overlap between pages
			const page1Ids = page1.map((u) => u.id);
			const page2Ids = page2.map((u) => u.id);
			const hasOverlap = page1Ids.some((id) => page2Ids.includes(id));
			expect(hasOverlap).toBe(false);
		});
	});

	// ==========================================================================
	// OrderBy Single Field
	// ==========================================================================

	describe("OrderBy Single Field", () => {
		it("should order by field ascending", async () => {
			const users = await forja.findMany("user", {
				orderBy: [{ field: "age", direction: "asc" }],
			});

			expect(users[0].age).toBe(22); // Iris
			expect(users[users.length - 1].age).toBe(45); // Jack

			// Verify order
			for (let i = 1; i < users.length; i++) {
				expect(users[i].age).toBeGreaterThanOrEqual(users[i - 1].age as number);
			}
		});

		it("should order by field descending", async () => {
			const users = await forja.findMany("user", {
				orderBy: [{ field: "age", direction: "desc" }],
			});

			expect(users[0].age).toBe(45); // Jack
			expect(users[users.length - 1].age).toBe(22); // Iris

			// Verify order
			for (let i = 1; i < users.length; i++) {
				expect(users[i].age).toBeLessThanOrEqual(users[i - 1].age as number);
			}
		});

		it("should order by string field alphabetically", async () => {
			const users = await forja.findMany("user", {
				orderBy: [{ field: "name", direction: "asc" }],
			});

			expect(users[0].name).toBe("Alice");
			expect(users[users.length - 1].name).toBe("Jack");
		});

		it("should order by id (default primary key)", async () => {
			const users = await forja.findMany("user", {
				orderBy: [{ field: "id", direction: "desc" }],
			});

			expect(users[0].id).toBe(userIds[9]);
			expect(users[users.length - 1].id).toBe(userIds[0]);
		});
	});

	// ==========================================================================
	// OrderBy Multiple Fields
	// ==========================================================================

	describe("OrderBy Multiple Fields", () => {
		it("should order by multiple fields", async () => {
			// Order by age asc, then name asc
			// Users with same age (25: Bob, Diana), (30: Alice, Frank), (35: Charlie, Henry)
			const users = await forja.findMany("user", {
				orderBy: [
					{ field: "age", direction: "asc" },
					{ field: "name", direction: "asc" },
				],
			});

			// Age 22: Iris
			expect(users[0].name).toBe("Iris");
			expect(users[0].age).toBe(22);

			// Age 25: Bob, Diana (alphabetical)
			expect(users[1].name).toBe("Bob");
			expect(users[2].name).toBe("Diana");

			// Age 28: Grace
			expect(users[3].name).toBe("Grace");

			// Age 30: Alice, Frank (alphabetical)
			expect(users[4].name).toBe("Alice");
			expect(users[5].name).toBe("Frank");
		});

		it("should handle mixed directions", async () => {
			// Order by isActive desc (true first), then age asc
			const users = await forja.findMany("user", {
				orderBy: [
					{ field: "isActive", direction: "desc" },
					{ field: "age", direction: "asc" },
				],
			});

			// First should be active users, youngest first
			const activeUsers = users.filter((u) => u.isActive);
			const inactiveUsers = users.filter((u) => !u.isActive);

			// Active users come first
			expect(users.slice(0, activeUsers.length).every((u) => u.isActive)).toBe(
				true,
			);

			// Inactive users come last
			expect(
				users.slice(activeUsers.length).every((u) => !u.isActive),
			).toBe(true);
		});
	});

	// ==========================================================================
	// OrderBy with Pagination
	// ==========================================================================

	describe("OrderBy with Pagination", () => {
		it("should maintain order across pages", async () => {
			const page1 = await forja.findMany("user", {
				orderBy: [{ field: "age", direction: "asc" }],
				limit: 5,
				offset: 0,
			});

			const page2 = await forja.findMany("user", {
				orderBy: [{ field: "age", direction: "asc" }],
				limit: 5,
				offset: 5,
			});

			// Last of page1 should be <= first of page2
			const lastPage1Age = page1[page1.length - 1].age as number;
			const firstPage2Age = page2[0].age as number;
			expect(lastPage1Age).toBeLessThanOrEqual(firstPage2Age);
		});

		it("should work with where, orderBy, limit, offset combined", async () => {
			const results = await forja.findMany("user", {
				where: { isActive: true },
				orderBy: [{ field: "age", direction: "desc" }],
				limit: 3,
				offset: 1,
			});

			expect(results).toHaveLength(3);

			// All should be active
			for (const user of results) {
				expect(user.isActive).toBe(true);
			}

			// Should be in descending age order
			for (let i = 1; i < results.length; i++) {
				expect(results[i].age).toBeLessThanOrEqual(results[i - 1].age as number);
			}
		});
	});

	// ==========================================================================
	// OrderBy Shortcut Formats
	// ==========================================================================

	describe("OrderBy Shortcut Formats", () => {
		it("should support object shortcut format", async () => {
			const users = await forja.findMany("user", {
				orderBy: { age: "asc" },
			});

			expect(users[0].age).toBe(22);
			expect(users[users.length - 1].age).toBe(45);
		});

		it("should support string array format with - prefix for desc", async () => {
			const users = await forja.findMany("user", {
				orderBy: ["-age"],
			});

			expect(users[0].age).toBe(45);
			expect(users[users.length - 1].age).toBe(22);
		});

		it("should support string array format without prefix for asc", async () => {
			const users = await forja.findMany("user", {
				orderBy: ["age"],
			});

			expect(users[0].age).toBe(22);
			expect(users[users.length - 1].age).toBe(45);
		});

		it("should support mixed string array format", async () => {
			// Sort by age asc, then name desc
			const users = await forja.findMany("user", {
				orderBy: ["age", "-name"],
			});

			// Age 25: Diana should come before Bob (name desc)
			const age25Users = users.filter((u) => u.age === 25);
			expect(age25Users[0].name).toBe("Diana");
			expect(age25Users[1].name).toBe("Bob");
		});
	});

	// ==========================================================================
	// Edge Cases
	// ==========================================================================

	describe("Edge Cases", () => {
		it("should handle empty result set with pagination", async () => {
			const results = await forja.findMany("user", {
				where: { age: 999 },
				limit: 10,
				offset: 0,
			});

			expect(results).toHaveLength(0);
		});

		it("should handle orderBy on field with same values", async () => {
			// Multiple users have same age
			const users = await forja.findMany("user", {
				where: { age: 25 },
				orderBy: [{ field: "age", direction: "asc" }],
			});

			expect(users).toHaveLength(2);
			expect(users.every((u) => u.age === 25)).toBe(true);
		});

		it("should handle large offset gracefully", async () => {
			const results = await forja.findMany("user", {
				offset: 1000000,
			});

			expect(results).toHaveLength(0);
		});

		it("should work with select and orderBy", async () => {
			const users = await forja.findMany("user", {
				select: ["id", "name"],
				orderBy: [{ field: "name", direction: "asc" }],
				limit: 3,
			});

			expect(users).toHaveLength(3);
			expect(users[0].name).toBe("Alice");
			expect(users[0]).toHaveProperty("id");
			expect(users[0]).not.toHaveProperty("age");
		});

		it("should handle boolean field ordering", async () => {
			const users = await forja.findMany("user", {
				orderBy: [{ field: "isActive", direction: "asc" }],
			});

			// false comes before true in ascending order
			const firstFalseIndex = users.findIndex((u) => !u.isActive);
			const lastFalseIndex = users.map((u) => u.isActive).lastIndexOf(false);
			const firstTrueIndex = users.findIndex((u) => u.isActive);

			if (firstFalseIndex !== -1 && firstTrueIndex !== -1) {
				expect(lastFalseIndex).toBeLessThan(firstTrueIndex);
			}
		});
	});

	// ==========================================================================
	// Count with Filters
	// ==========================================================================

	describe("Count", () => {
		it("should count all records", async () => {
			const count = await forja.count("user");

			expect(count).toBe(10);
		});

		it("should count with where clause", async () => {
			const count = await forja.count("user", { isActive: true });

			expect(count).toBe(7);
		});

		it("should count with complex where", async () => {
			const count = await forja.count("user", {
				$and: [{ isActive: true }, { age: { $gte: 30 } }],
			});

			// Active users with age >= 30: Alice(30), Charlie(35), Frank(30), Jack(45)
			expect(count).toBe(4);
		});

		it("should return 0 for no matches", async () => {
			const count = await forja.count("user", { age: 999 });

			expect(count).toBe(0);
		});
	});
});
