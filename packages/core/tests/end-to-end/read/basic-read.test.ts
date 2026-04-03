/**
 * Basic Read Tests
 *
 * Tests for forja.findOne(), forja.findMany(), forja.findById(), forja.count()
 *
 * Covers:
 * - findById basic usage
 * - findOne with where clause
 * - findMany without filters
 * - findMany with where, limit, offset, orderBy
 * - count operations
 * - Select specific fields
 * - Non-existent records
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Forja } from "@forja/core";
import fs from "node:fs/promises";
import {
	createTestConfig,
	getTmpDir,
	setupTables,
	seedBasicData,
	type SeedResult,
} from "../setup";

describe("Basic Read", () => {
	let forja: Forja;
	let seed: SeedResult;
	const tmpDir = getTmpDir("basic_read");

	beforeAll(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
		await fs.mkdir(tmpDir, { recursive: true });

		const getForja = await createTestConfig(tmpDir);
		forja = await getForja();

		await setupTables(forja);

		// Seed test data
		seed = await seedBasicData(forja);
	});

	afterAll(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	// ==========================================================================
	// findById
	// ==========================================================================

	describe("findById", () => {
		it("should find record by id", async () => {
			const org = seed.organizations[0];
			const result = await forja.findById("organization", org.id);

			expect(result).not.toBeNull();
			expect(result!.id).toBe(org.id);
			expect(result!.name).toBe("Acme Corp");
		});

		it("should return null for non-existent id", async () => {
			const result = await forja.findById("organization", 99999);

			expect(result).toBeNull();
		});

		it("should return all fields by default", async () => {
			const org = seed.organizations[0];
			const result = await forja.findById("organization", org.id);

			expect(result).toHaveProperty("id");
			expect(result).toHaveProperty("name");
			expect(result).toHaveProperty("country");
			expect(result).toHaveProperty("isActive");
			expect(result).toHaveProperty("createdAt");
			expect(result).toHaveProperty("updatedAt");
		});

		it("should return only selected fields", async () => {
			const org = seed.organizations[0];
			const result = await forja.findById("organization", org.id, {
				select: ["id", "name"],
			});

			expect(result).toHaveProperty("id");
			expect(result).toHaveProperty("name");
			expect(result).toHaveProperty("createdAt");
			expect(result).toHaveProperty("updatedAt");
			expect(result).not.toHaveProperty("country");
			expect(result).not.toHaveProperty("isActive");
		});
	});

	// ==========================================================================
	// findOne
	// ==========================================================================

	describe("findOne", () => {
		it("should find record by where clause", async () => {
			const result = await forja.findOne("organization", {
				name: "Acme Corp",
			});

			expect(result).not.toBeNull();
			expect(result!.name).toBe("Acme Corp");
			expect(result!.country).toBe("USA");
		});

		it("should find record with multiple conditions", async () => {
			const result = await forja.findOne("user", {
				isActive: true,
				name: "Admin User",
			});

			expect(result).not.toBeNull();
			expect(result!.email).toBe("admin@acme.com");
		});

		it("should return null when no match found", async () => {
			const result = await forja.findOne("organization", {
				name: "Non Existent Org",
			});

			expect(result).toBeNull();
		});

		it("should return first match when multiple exist", async () => {
			// Multiple active users exist
			const result = await forja.findOne("user", {
				isActive: true,
			});

			expect(result).not.toBeNull();
			expect(result!.isActive).toBe(true);
		});

		it("should support $eq operator", async () => {
			const result = await forja.findOne("organization", {
				name: { $eq: "Tech Ltd" },
			});

			expect(result).not.toBeNull();
			expect(result!.name).toBe("Tech Ltd");
		});
	});

	// ==========================================================================
	// findMany
	// ==========================================================================

	describe("findMany", () => {
		it("should return all records without filters", async () => {
			const results = await forja.findMany("organization");

			expect(results.length).toBeGreaterThanOrEqual(2);
		});

		it("should filter by where clause", async () => {
			const results = await forja.findMany("user", {
				where: { isActive: true },
			});

			expect(results.length).toBeGreaterThan(0);
			for (const user of results) {
				expect(user.isActive).toBe(true);
			}
		});

		it("should limit results", async () => {
			const results = await forja.findMany("user", {
				limit: 2,
			});

			expect(results).toHaveLength(2);
		});

		it("should offset results", async () => {
			const allUsers = await forja.findMany("user");
			const offsetUsers = await forja.findMany("user", {
				offset: 2,
			});

			expect(offsetUsers).toHaveLength(allUsers.length - 2);
		});

		it("should combine limit and offset for pagination", async () => {
			// Page 1
			const page1 = await forja.findMany("user", {
				limit: 2,
				offset: 0,
			});

			// Page 2
			const page2 = await forja.findMany("user", {
				limit: 2,
				offset: 2,
			});

			expect(page1).toHaveLength(2);
			expect(page2.length).toBeGreaterThan(0);

			// No overlap
			const page1Ids = page1.map((u) => u.id);
			const page2Ids = page2.map((u) => u.id);
			for (const id of page2Ids) {
				expect(page1Ids).not.toContain(id);
			}
		});

		it("should order by field ascending", async () => {
			const results = await forja.findMany("user", {
				orderBy: [{ field: "age", direction: "asc" }],
			});

			for (let i = 1; i < results.length; i++) {
				const prevAge = results[i - 1].age as number;
				const currAge = results[i].age as number;
				if (prevAge !== null && currAge !== null) {
					expect(currAge).toBeGreaterThanOrEqual(prevAge);
				}
			}
		});

		it("should order by field descending (shortcut syntax)", async () => {
			// TODO: Implement shortcut syntax in query builder
			// This should work: { field: "direction" } -> [{ field, direction }]
			const results = await forja.findMany("user", {
				orderBy: { age: "desc" },
			});

			for (let i = 1; i < results.length; i++) {
				const prevAge = results[i - 1].age as number;
				const currAge = results[i].age as number;
				if (prevAge !== null && currAge !== null) {
					expect(currAge).toBeLessThanOrEqual(prevAge);
				}
			}
		});

		it("should return empty array when no matches", async () => {
			const results = await forja.findMany("organization", {
				where: { name: "Non Existent" },
			});

			expect(results).toHaveLength(0);
			expect(Array.isArray(results)).toBe(true);
		});

		it("should select specific fields", async () => {
			const results = await forja.findMany("organization", {
				select: ["id", "name"],
			});

			for (const record of results) {
				expect(record).toHaveProperty("id");
				expect(record).toHaveProperty("name");
				expect(record).toHaveProperty("createdAt");
				expect(record).toHaveProperty("updatedAt");
				expect(record).not.toHaveProperty("country");
			}
		});
	});

	// ==========================================================================
	// count
	// ==========================================================================

	describe("count", () => {
		it("should count all records", async () => {
			const count = await forja.count("organization");

			expect(count).toBeGreaterThanOrEqual(2);
		});

		it("should count with where clause", async () => {
			const activeCount = await forja.count("user", { isActive: true });
			const inactiveCount = await forja.count("user", { isActive: false });
			const totalCount = await forja.count("user");

			expect(activeCount + inactiveCount).toBe(totalCount);
		});

		it("should return 0 for no matches", async () => {
			const count = await forja.count("organization", {
				name: "Non Existent Org",
			});

			expect(count).toBe(0);
		});
	});

	// ==========================================================================
	// Where Operators (Basic)
	// ==========================================================================

	describe("Where Operators", () => {
		it("should support $ne (not equal)", async () => {
			const results = await forja.findMany("organization", {
				where: { name: { $ne: "Acme Corp" } },
			});

			for (const org of results) {
				expect(org.name).not.toBe("Acme Corp");
			}
		});

		it("should support $gt (greater than)", async () => {
			const results = await forja.findMany("user", {
				where: { age: { $gt: 30 } },
			});

			for (const user of results) {
				expect(user.age as number).toBeGreaterThan(30);
			}
		});

		it("should support $gte (greater than or equal)", async () => {
			const results = await forja.findMany("user", {
				where: { age: { $gte: 35 } },
			});

			for (const user of results) {
				expect(user.age as number).toBeGreaterThanOrEqual(35);
			}
		});

		it("should support $lt (less than)", async () => {
			const results = await forja.findMany("user", {
				where: { age: { $lt: 30 } },
			});

			for (const user of results) {
				expect(user.age as number).toBeLessThan(30);
			}
		});

		it("should support $lte (less than or equal)", async () => {
			const results = await forja.findMany("user", {
				where: { age: { $lte: 28 } },
			});

			for (const user of results) {
				expect(user.age as number).toBeLessThanOrEqual(28);
			}
		});

		it("should support $in (in array)", async () => {
			const results = await forja.findMany("organization", {
				where: { country: { $in: ["USA", "UK"] } },
			});

			for (const org of results) {
				expect(["USA", "UK"]).toContain(org.country);
			}
		});

		it("should support $nin (not in array)", async () => {
			const results = await forja.findMany("organization", {
				where: { country: { $nin: ["USA"] } },
			});

			for (const org of results) {
				expect(org.country).not.toBe("USA");
			}
		});
	});

	// ==========================================================================
	// Error Cases
	// ==========================================================================

	describe("Error Cases", () => {
		it("should throw error for invalid field in where", async () => {
			await expect(
				forja.findMany("organization", {
					where: { nonExistentField: "value" },
				}),
			).rejects.toThrow();
		});

		it("should throw error for invalid field in select", async () => {
			await expect(
				forja.findMany("organization", {
					select: ["nonExistentField"],
				}),
			).rejects.toThrow();
		});

		it("should throw error for invalid operator", async () => {
			await expect(
				forja.findMany("organization", {
					where: { name: { $invalid: "value" } } as Record<string, unknown>,
				}),
			).rejects.toThrow();
		});
	});
});
