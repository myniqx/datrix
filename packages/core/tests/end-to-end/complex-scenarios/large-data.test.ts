/**
 * Large Data Performance Tests
 *
 * Tests for performance with large datasets
 *
 * Covers:
 * - Bulk create performance (100, 500, 1000 records)
 * - Bulk read performance
 * - Bulk update performance
 * - Bulk delete performance
 * - Large schema (50+ columns)
 * - Complex queries on large data
 * - Pagination performance
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Datrix } from "@datrix/core";
import fs from "node:fs/promises";
import { createTestConfig, getTmpDir, setupTables } from "../setup";

describe("Large Data Performance", () => {
	let datrix: Datrix;
	const tmpDir = getTmpDir("large_data");

	beforeAll(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
		await fs.mkdir(tmpDir, { recursive: true });

		const getDatrix = await createTestConfig(tmpDir);
		datrix = await getDatrix();

		await setupTables(datrix);
	});

	afterAll(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	// ==========================================================================
	// Bulk Create Performance
	// ==========================================================================

	describe("Bulk Create Performance", () => {
		it("should create 100 records efficiently", async () => {
			const users = Array.from({ length: 100 }, (_, i) => ({
				email: `perf100-${i}@test.com`,
				name: `Performance User ${i}`,
				age: 20 + (i % 50),
				isActive: i % 2 === 0,
			}));

			const start = performance.now();
			const created = await datrix.createMany("user", users);
			const duration = performance.now() - start;

			expect(created).toHaveLength(100);
			expect(duration).toBeLessThan(5000); // 5 seconds

			console.log(`100 records created in ${duration.toFixed(2)}ms`);
		});

		it("should create 500 records efficiently", async () => {
			const users = Array.from({ length: 500 }, (_, i) => ({
				email: `perf500-${i}@test.com`,
				name: `Performance User ${i}`,
				age: 20 + (i % 50),
				isActive: i % 2 === 0,
			}));

			const start = performance.now();
			const created = await datrix.createMany("user", users);
			const duration = performance.now() - start;

			expect(created).toHaveLength(500);
			expect(duration).toBeLessThan(15000); // 15 seconds

			console.log(`500 records created in ${duration.toFixed(2)}ms`);
		});

		it("should create 1000 records efficiently", async () => {
			const tags = Array.from({ length: 1000 }, (_, i) => ({
				name: `PerfTag${i}`,
				color: `#${String(i).padStart(6, "0")}`,
			}));

			const start = performance.now();
			const created = await datrix.createMany("tag", tags);
			const duration = performance.now() - start;

			expect(created).toHaveLength(1000);
			expect(duration).toBeLessThan(30000); // 30 seconds

			console.log(`1000 records created in ${duration.toFixed(2)}ms`);
		});
	});

	// ==========================================================================
	// Bulk Read Performance
	// ==========================================================================

	describe("Bulk Read Performance", () => {
		it("should read 500 records efficiently", async () => {
			const start = performance.now();
			const users = await datrix.findMany("user", {
				where: { email: { $like: "perf500-%@test.com" } },
			});
			const duration = performance.now() - start;

			expect(users.length).toBe(500);
			expect(duration).toBeLessThan(2000); // 2 seconds

			console.log(`500 records read in ${duration.toFixed(2)}ms`);
		});

		it("should read with orderBy efficiently", async () => {
			const start = performance.now();
			const users = await datrix.findMany("user", {
				where: { email: { $like: "perf500-%@test.com" } },
				orderBy: [{ field: "age", direction: "asc" }],
			});
			const duration = performance.now() - start;

			expect(users.length).toBe(500);
			expect(duration).toBeLessThan(3000); // 3 seconds

			console.log(`500 records read with orderBy in ${duration.toFixed(2)}ms`);
		});

		it("should read with complex where efficiently", async () => {
			const start = performance.now();
			const users = await datrix.findMany("user", {
				where: {
					$and: [
						{ email: { $like: "perf500-%@test.com" } },
						{ isActive: true },
						{ age: { $gte: 30 } },
						{ age: { $lte: 50 } },
					],
				},
			});
			const duration = performance.now() - start;

			expect(duration).toBeLessThan(3000); // 3 seconds

			console.log(
				`Complex query returned ${users.length} records in ${duration.toFixed(2)}ms`,
			);
		});
	});

	// ==========================================================================
	// Pagination Performance
	// ==========================================================================

	describe("Pagination Performance", () => {
		it("should paginate through large dataset efficiently", async () => {
			const pageSize = 50;
			const pages: number[] = [];
			let offset = 0;
			let total = 0;

			const totalStart = performance.now();

			while (true) {
				const start = performance.now();
				const users = await datrix.findMany("user", {
					where: { email: { $like: "perf500-%@test.com" } },
					orderBy: [{ field: "id", direction: "asc" }],
					limit: pageSize,
					offset,
				});
				const duration = performance.now() - start;
				pages.push(duration);

				if (users.length === 0) break;

				total += users.length;
				offset += pageSize;
			}

			const totalDuration = performance.now() - totalStart;

			expect(total).toBe(500);
			expect(pages.length).toBe(11); // 10 full pages + 1 empty

			const avgPageTime = pages.reduce((a, b) => a + b, 0) / pages.length;
			expect(avgPageTime).toBeLessThan(500); // 500ms per page average

			console.log(
				`Paginated ${total} records in ${pages.length - 1} pages, total ${totalDuration.toFixed(2)}ms, avg ${avgPageTime.toFixed(2)}ms/page`,
			);
		});

		it("should handle large offset efficiently", async () => {
			const start = performance.now();
			const users = await datrix.findMany("user", {
				where: { email: { $like: "perf500-%@test.com" } },
				orderBy: [{ field: "id", direction: "asc" }],
				limit: 10,
				offset: 400,
			});
			const duration = performance.now() - start;

			expect(users.length).toBe(10);
			expect(duration).toBeLessThan(1000); // 1 second

			console.log(`Large offset query in ${duration.toFixed(2)}ms`);
		});
	});

	// ==========================================================================
	// Bulk Update Performance
	// ==========================================================================

	describe("Bulk Update Performance", () => {
		it("should update 100 records efficiently", async () => {
			const start = performance.now();
			const updated = await datrix.updateMany(
				"user",
				{ email: { $like: "perf100-%@test.com" } },
				{ isActive: false },
			);
			const duration = performance.now() - start;

			expect(updated.length).toBe(100);
			expect(duration).toBeLessThan(5000); // 5 seconds

			console.log(`100 records updated in ${duration.toFixed(2)}ms`);
		});

		it("should update with complex where efficiently", async () => {
			const start = performance.now();
			const updated = await datrix.updateMany(
				"user",
				{
					$and: [
						{ email: { $like: "perf500-%@test.com" } },
						{ age: { $gte: 40 } },
					],
				},
				{ metadata: { bulk: true } },
			);
			const duration = performance.now() - start;

			expect(duration).toBeLessThan(10000); // 10 seconds

			console.log(
				`${updated.length} records updated with complex where in ${duration.toFixed(2)}ms`,
			);
		});
	});

	// ==========================================================================
	// Bulk Delete Performance
	// ==========================================================================

	describe("Bulk Delete Performance", () => {
		it("should delete 100 records efficiently", async () => {
			const start = performance.now();
			const deleted = await datrix.deleteMany("user", {
				email: { $like: "perf100-%@test.com" },
			});
			const duration = performance.now() - start;

			expect(deleted.length).toBe(100);
			expect(duration).toBeLessThan(5000); // 5 seconds

			console.log(`100 records deleted in ${duration.toFixed(2)}ms`);
		});

		it("should delete 1000 records efficiently", async () => {
			const start = performance.now();
			const deleted = await datrix.deleteMany("tag", {
				name: { $like: "PerfTag%" },
			});
			const duration = performance.now() - start;

			expect(deleted.length).toBe(1000);
			expect(duration).toBeLessThan(15000); // 15 seconds

			console.log(`1000 records deleted in ${duration.toFixed(2)}ms`);
		});
	});

	// ==========================================================================
	// Count Performance
	// ==========================================================================

	describe("Count Performance", () => {
		it("should count large dataset efficiently", async () => {
			const start = performance.now();
			const count = await datrix.count("user", {
				email: { $like: "perf500-%@test.com" },
			});
			const duration = performance.now() - start;

			expect(count).toBe(500);
			expect(duration).toBeLessThan(1000); // 1 second

			console.log(`Counted ${count} records in ${duration.toFixed(2)}ms`);
		});

		it("should count with complex where efficiently", async () => {
			const start = performance.now();
			const count = await datrix.count("user", {
				$and: [
					{ email: { $like: "perf500-%@test.com" } },
					{ isActive: true },
					{ age: { $gte: 25 } },
				],
			});
			const duration = performance.now() - start;

			expect(duration).toBeLessThan(1500); // 1.5 seconds

			console.log(
				`Complex count returned ${count} in ${duration.toFixed(2)}ms`,
			);
		});
	});

	// ==========================================================================
	// Large $in Array
	// ==========================================================================

	describe("Large $in Array", () => {
		it("should handle $in with 100 values", async () => {
			// Get first 100 user IDs
			const users = await datrix.findMany("user", {
				where: { email: { $like: "perf500-%@test.com" } },
				select: ["id"],
				limit: 100,
			});
			const ids = users.map((u) => u.id);

			const start = performance.now();
			const found = await datrix.findMany("user", {
				where: { id: { $in: ids } },
			});
			const duration = performance.now() - start;

			expect(found.length).toBe(100);
			expect(duration).toBeLessThan(2000); // 2 seconds

			console.log(`$in with 100 IDs in ${duration.toFixed(2)}ms`);
		});

		it("should handle $in with 500 values", async () => {
			const users = await datrix.findMany("user", {
				where: { email: { $like: "perf500-%@test.com" } },
				select: ["id"],
			});
			const ids = users.map((u) => u.id);

			const start = performance.now();
			const found = await datrix.findMany("user", {
				where: { id: { $in: ids } },
			});
			const duration = performance.now() - start;

			expect(found.length).toBe(500);
			expect(duration).toBeLessThan(5000); // 5 seconds

			console.log(`$in with 500 IDs in ${duration.toFixed(2)}ms`);
		});
	});

	// ==========================================================================
	// Populate Performance
	// ==========================================================================

	describe("Populate Performance", () => {
		beforeAll(async () => {
			// Create organization for populate tests
			const org = await datrix.create("organization", {
				name: "Perf Org",
				country: "USA",
			});

			// Create users with organization
			const users = Array.from({ length: 50 }, (_, i) => ({
				email: `perf-pop-${i}@test.com`,
				name: `Populate User ${i}`,
				organization: org.id,
			}));
			await datrix.createMany("user", users);
		});

		it("should populate 50 records efficiently", async () => {
			const start = performance.now();
			const users = await datrix.findMany("user", {
				where: { email: { $like: "perf-pop-%@test.com" } },
				populate: { organization: { select: "*" } },
			});
			const duration = performance.now() - start;

			expect(users.length).toBe(50);
			for (const user of users) {
				expect(user["organization"]).toBeDefined();
			}
			expect(duration).toBeLessThan(3000); // 3 seconds

			console.log(`50 records with populate in ${duration.toFixed(2)}ms`);
		});
	});
});
