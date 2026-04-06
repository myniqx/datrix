// @ts-nocheck
/**
 * Pagination Integration Tests
 *
 * Tests real pagination behavior with handler + database:
 * - Default pagination (page=1, pageSize=25)
 * - Custom page sizes
 * - Page navigation (different pages return different items)
 * - Edge cases (last page, empty results, single item)
 * - Meta validation (total, totalPages calculation)
 * - Pagination with filtering and sorting
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { Forja } from "@forja/core";
import { handleRequest } from "../src/helper";
import { createTestConfig, getTmpDir } from "./data";
import { createRequest } from "./data/helper";
import {
	expectApiMulti,
	expectPaginationMeta,
} from "@forja/core/types/test/helpers";
import fs from "node:fs/promises";

describe("Pagination Integration Tests", () => {
	let forja: Forja;
	let getForja: () => Promise<Forja>;
	const tmpDir = getTmpDir("pagination");

	beforeAll(async () => {
		// Clean up temporary directory
		try {
			await fs.rm(tmpDir, { recursive: true, force: true });
		} catch (error) {
			console.warn("Failed to clean up temp directory:", error);
		}

		// Create temporary directory
		await fs.mkdir(tmpDir, { recursive: true });

		// Get Forja factory function
		getForja = await createTestConfig(tmpDir);

		// Get Forja instance
		forja = await getForja();

		// Create tables for JsonAdapter
		const adapter = forja.getAdapter();
		for (const schema of forja.getSchemas().getAll()) {
			try {
				await adapter.dropTable(schema.tableName!);
			} catch {}
			await adapter.createTable(schema);
		}
	});

	afterAll(async () => {
		// Clean up temporary directory
		try {
			await fs.rm(tmpDir, { recursive: true, force: true });
		} catch (error) {
			console.warn("Failed to clean up temp directory:", error);
		}
	});

	/**
	 * Setup: Create test data
	 */
	async function setupUsers(count: number) {
		const users = [];
		for (let i = 1; i <= count; i++) {
			const user = await forja.create("user", {
				name: `User ${i}`,
				email: `user${i}@example.com`,
				age: 20 + i,
			});
			users.push(user);
		}
		return users;
	}

	describe("Basic Pagination", () => {
		beforeEach(async () => {
			await forja.deleteMany("user", {});
		});

		it("should use default pagination when no params provided", async () => {
			// Create 30 users
			await setupUsers(30);

			const request = createRequest("/api/users", { method: "GET" });

			const response = await handleRequest(forja, request);
			const { data, meta } = await expectApiMulti(response);

			// Default: page=1, pageSize=25
			expect(data).toHaveLength(25);
			expectPaginationMeta(meta, {
				page: 1,
				pageSize: 25,
				total: 30,
				totalPages: 2, // 30 / 25 = 1.2 → 2 pages
			});
		});

		it("should respect custom pageSize", async () => {
			// Create 10 users
			await setupUsers(10);

			const request = createRequest(
				"/api/users",
				{ method: "GET" },
				{ pageSize: 3 },
			);

			const response = await handleRequest(forja, request);
			const { data, meta } = await expectApiMulti(response);

			expect(data).toHaveLength(3);
			expectPaginationMeta(meta, {
				page: 1,
				pageSize: 3,
				total: 10,
				totalPages: 4, // 10 / 3 = 3.33 → 4 pages
			});
		});

		it("should navigate to different pages", async () => {
			// Create 10 users
			const users = await setupUsers(10);

			// Page 1
			const page1Request = createRequest(
				"/api/users",
				{ method: "GET" },
				{ page: 1, pageSize: 3 },
			);
			const page1Response = await handleRequest(forja, page1Request);
			const page1Result = await expectApiMulti(page1Response);

			expect(page1Result.data).toHaveLength(3);
			expect(page1Result.data[0].name).toBe("User 1");
			expect(page1Result.data[1].name).toBe("User 2");
			expect(page1Result.data[2].name).toBe("User 3");

			// Page 2
			const page2Request = createRequest(
				"/api/users",
				{ method: "GET" },
				{ page: 2, pageSize: 3 },
			);
			const page2Response = await handleRequest(forja, page2Request);
			const page2Result = await expectApiMulti(page2Response);

			expect(page2Result.data).toHaveLength(3);
			expect(page2Result.data[0].name).toBe("User 4");
			expect(page2Result.data[1].name).toBe("User 5");
			expect(page2Result.data[2].name).toBe("User 6");

			// Page 3
			const page3Request = createRequest(
				"/api/users",
				{ method: "GET" },
				{ page: 3, pageSize: 3 },
			);
			const page3Response = await handleRequest(forja, page3Request);
			const page3Result = await expectApiMulti(page3Response);

			expect(page3Result.data).toHaveLength(3);
			expect(page3Result.data[0].name).toBe("User 7");
			expect(page3Result.data[1].name).toBe("User 8");
			expect(page3Result.data[2].name).toBe("User 9");
		});
	});

	describe("Edge Cases", () => {
		beforeEach(async () => {
			await forja.deleteMany("user", {});
		});

		it("should handle last page with remaining items", async () => {
			// Create 10 users, pageSize=3 → last page has 1 item
			await setupUsers(10);

			const request = createRequest(
				"/api/users",
				{ method: "GET" },
				{ page: 4, pageSize: 3 },
			);

			const response = await handleRequest(forja, request);
			const { data, meta } = await expectApiMulti(response);

			// Last page: only 1 item (items 10)
			expect(data).toHaveLength(1);
			expect(data[0].name).toBe("User 10");

			expectPaginationMeta(meta, {
				page: 4,
				pageSize: 3,
				total: 10,
				totalPages: 4,
			});
		});

		it("should return empty array when page exceeds total pages", async () => {
			// Create 5 users
			await setupUsers(5);

			const request = createRequest(
				"/api/users",
				{ method: "GET" },
				{ page: 10, pageSize: 3 },
			);

			const response = await handleRequest(forja, request);
			const { data, meta } = await expectApiMulti(response);

			// Page 10 doesn't exist → empty array
			expect(data).toHaveLength(0);

			// But meta should still be correct
			expectPaginationMeta(meta, {
				page: 10,
				pageSize: 3,
				total: 5,
				totalPages: 2, // Only 2 pages exist
			});
		});

		it("should handle single item per page", async () => {
			// Create 3 users
			await setupUsers(3);

			const request = createRequest(
				"/api/users",
				{ method: "GET" },
				{ page: 2, pageSize: 1 },
			);

			const response = await handleRequest(forja, request);
			const { data, meta } = await expectApiMulti(response);

			expect(data).toHaveLength(1);
			expect(data[0].name).toBe("User 2");

			expectPaginationMeta(meta, {
				page: 2,
				pageSize: 1,
				total: 3,
				totalPages: 3,
			});
		});

		it("should handle empty database", async () => {
			// No users created

			const request = createRequest(
				"/api/users",
				{ method: "GET" },
				{ page: 1, pageSize: 10 },
			);

			const response = await handleRequest(forja, request);
			const { data, meta } = await expectApiMulti(response);

			expect(data).toHaveLength(0);

			expectPaginationMeta(meta, {
				page: 1,
				pageSize: 10,
				total: 0,
				totalPages: 0, // 0 / 10 = 0 pages
			});
		});

		it("should handle exact division (no remainder)", async () => {
			// Create 9 users, pageSize=3 → exactly 3 pages
			await setupUsers(9);

			const request = createRequest(
				"/api/users",
				{ method: "GET" },
				{ page: 3, pageSize: 3 },
			);

			const response = await handleRequest(forja, request);
			const { data, meta } = await expectApiMulti(response);

			// Last page: exactly 3 items
			expect(data).toHaveLength(3);
			expect(data[0].name).toBe("User 7");
			expect(data[1].name).toBe("User 8");
			expect(data[2].name).toBe("User 9");

			expectPaginationMeta(meta, {
				page: 3,
				pageSize: 3,
				total: 9,
				totalPages: 3, // 9 / 3 = 3 (exact)
			});
		});
	});

	describe("Meta Validation", () => {
		beforeEach(async () => {
			await forja.deleteMany("user", {});
		});

		it("should calculate totalPages correctly for various scenarios", async () => {
			await setupUsers(10);

			// Scenario 1: 10 items, pageSize=3 → 4 pages (10/3 = 3.33)
			const req1 = createRequest(
				"/api/users",
				{ method: "GET" },
				{ pageSize: 3 },
			);
			const res1 = await handleRequest(forja, req1);
			const result1 = await expectApiMulti(res1);
			expect(result1.meta.totalPages).toBe(4);

			// Scenario 2: 10 items, pageSize=5 → 2 pages (10/5 = 2)
			const req2 = createRequest(
				"/api/users",
				{ method: "GET" },
				{ pageSize: 5 },
			);
			const res2 = await handleRequest(forja, req2);
			const result2 = await expectApiMulti(res2);
			expect(result2.meta.totalPages).toBe(2);

			// Scenario 3: 10 items, pageSize=10 → 1 page (10/10 = 1)
			const req3 = createRequest(
				"/api/users",
				{ method: "GET" },
				{ pageSize: 10 },
			);
			const res3 = await handleRequest(forja, req3);
			const result3 = await expectApiMulti(res3);
			expect(result3.meta.totalPages).toBe(1);

			// Scenario 4: 10 items, pageSize=20 → 1 page (10/20 = 0.5)
			const req4 = createRequest(
				"/api/users",
				{ method: "GET" },
				{ pageSize: 20 },
			);
			const res4 = await handleRequest(forja, req4);
			const result4 = await expectApiMulti(res4);
			expect(result4.meta.totalPages).toBe(1);
		});

		it("should have consistent meta across all pages", async () => {
			await setupUsers(10);

			// All pages should have same total and totalPages
			for (let page = 1; page <= 4; page++) {
				const request = createRequest(
					"/api/users",
					{ method: "GET" },
					{ page, pageSize: 3 },
				);
				const response = await handleRequest(forja, request);
				const { meta } = await expectApiMulti(response);

				expect(meta.page).toBe(page);
				expect(meta.pageSize).toBe(3);
				expect(meta.total).toBe(10); // Same for all pages
				expect(meta.totalPages).toBe(4); // Same for all pages
			}
		});
	});

	describe("Pagination with Filtering", () => {
		beforeEach(async () => {
			await forja.deleteMany("user", {});
		});

		it("should paginate filtered results correctly", async () => {
			// Create users with different ages
			await setupUsers(10); // ages 21-30

			// Filter: age >= 25 (users 5-10, total 6 users)
			const request = createRequest(
				"/api/users",
				{ method: "GET" },
				{
					where: { age: { $gte: 25 } },
					page: 1,
					pageSize: 3,
				},
			);

			const response = await handleRequest(forja, request);
			const { data, meta } = await expectApiMulti(response);

			// Should return first 3 of filtered results
			expect(data).toHaveLength(3);
			expect(data[0].name).toBe("User 5"); // age 25
			expect(data[1].name).toBe("User 6"); // age 26
			expect(data[2].name).toBe("User 7"); // age 27

			expectPaginationMeta(meta, {
				page: 1,
				pageSize: 3,
				total: 6, // Only 6 users match filter
				totalPages: 2, // 6 / 3 = 2 pages
			});
		});

		it("should navigate pages within filtered results", async () => {
			await setupUsers(10);

			// Page 2 of filtered results
			const request = createRequest(
				"/api/users",
				{ method: "GET" },
				{
					where: { age: { $gte: 25 } },
					page: 2,
					pageSize: 3,
				},
			);

			const response = await handleRequest(forja, request);
			const { data, meta } = await expectApiMulti(response);

			expect(data).toHaveLength(3);
			expect(data[0].name).toBe("User 8"); // age 28
			expect(data[1].name).toBe("User 9"); // age 29
			expect(data[2].name).toBe("User 10"); // age 30

			expectPaginationMeta(meta, {
				page: 2,
				pageSize: 3,
				total: 6,
				totalPages: 2,
			});
		});
	});

	describe("Pagination with Sorting", () => {
		beforeEach(async () => {
			await forja.deleteMany("user", {});
		});

		it("should paginate sorted results correctly", async () => {
			// Create users in random order
			await forja.create("user", {
				name: "Charlie",
				email: "c@example.com",
				age: 30,
			});
			await forja.create("user", {
				name: "Alice",
				email: "a@example.com",
				age: 25,
			});
			await forja.create("user", {
				name: "Bob",
				email: "b@example.com",
				age: 20,
			});
			await forja.create("user", {
				name: "David",
				email: "d@example.com",
				age: 35,
			});

			// Sort by name ascending, page 1, pageSize=2
			const request = createRequest(
				"/api/users",
				{ method: "GET" },
				{
					orderBy: "name",
					page: 1,
					pageSize: 2,
				},
			);

			const response = await handleRequest(forja, request);
			const { data, meta } = await expectApiMulti(response);

			// Should be sorted: Alice, Bob, Charlie, David
			expect(data).toHaveLength(2);
			expect(data[0].name).toBe("Alice");
			expect(data[1].name).toBe("Bob");

			expectPaginationMeta(meta, {
				page: 1,
				pageSize: 2,
				total: 4,
				totalPages: 2,
			});
		});

		it("should maintain sort order across pages", async () => {
			await forja.create("user", {
				name: "Charlie",
				email: "c@example.com",
				age: 30,
			});
			await forja.create("user", {
				name: "Alice",
				email: "a@example.com",
				age: 25,
			});
			await forja.create("user", {
				name: "Bob",
				email: "b@example.com",
				age: 20,
			});
			await forja.create("user", {
				name: "David",
				email: "d@example.com",
				age: 35,
			});

			// Page 2 with same sort
			const request = createRequest(
				"/api/users",
				{ method: "GET" },
				{
					orderBy: "name",
					page: 2,
					pageSize: 2,
				},
			);

			const response = await handleRequest(forja, request);
			const { data } = await expectApiMulti(response);

			// Should continue sorted order: Charlie, David
			expect(data).toHaveLength(2);
			expect(data[0].name).toBe("Charlie");
			expect(data[1].name).toBe("David");
		});

		it("should handle descending sort with pagination", async () => {
			await setupUsers(5); // User 1-5, ages 21-25

			// Sort by age descending, page 1, pageSize=2
			const request = createRequest(
				"/api/users",
				{ method: "GET" },
				{
					orderBy: "-age",
					page: 1,
					pageSize: 2,
				},
			);

			const response = await handleRequest(forja, request);
			const { data } = await expectApiMulti(response);

			// Should be: User 5 (age 25), User 4 (age 24)
			expect(data).toHaveLength(2);
			expect(data[0].name).toBe("User 5");
			expect(data[0].age).toBe(25);
			expect(data[1].name).toBe("User 4");
			expect(data[1].age).toBe(24);
		});
	});

	describe("Combined Scenarios", () => {
		beforeEach(async () => {
			await forja.deleteMany("user", {});
		});

		it("should handle pagination + filtering + sorting together", async () => {
			// Create mixed data
			await forja.create("user", {
				name: "Alice",
				email: "a@example.com",
				age: 30,
			});
			await forja.create("user", {
				name: "Bob",
				email: "b@example.com",
				age: 20,
			});
			await forja.create("user", {
				name: "Charlie",
				email: "c@example.com",
				age: 35,
			});
			await forja.create("user", {
				name: "David",
				email: "d@example.com",
				age: 25,
			});
			await forja.create("user", {
				name: "Eve",
				email: "e@example.com",
				age: 40,
			});
			await forja.create("user", {
				name: "Frank",
				email: "f@example.com",
				age: 28,
			});

			// Filter: age >= 25, Sort: name ascending, Page: 2, PageSize: 2
			// Filtered: Alice(30), Charlie(35), David(25), Eve(40), Frank(28)
			// Sorted: Alice, Charlie, David, Eve, Frank
			// Page 1 (items 1-2): Alice, Charlie
			// Page 2 (items 3-4): David, Eve
			const request = createRequest(
				"/api/users",
				{ method: "GET" },
				{
					where: { age: { $gte: 25 } },
					orderBy: "name",
					page: 2,
					pageSize: 2,
				},
			);

			const response = await handleRequest(forja, request);
			const { data, meta } = await expectApiMulti(response);

			expect(data).toHaveLength(2);

			// Page 2 should have David and Eve (items 3 and 4 in sorted order)
			expect(data[0].name).toBe("David");
			expect(data[1].name).toBe("Eve");

			expectPaginationMeta(meta, {
				page: 2,
				pageSize: 2,
				total: 5, // 5 users with age >= 25
				totalPages: 3, // 5 / 2 = 2.5 → 3 pages
			});
		});
	});
});
