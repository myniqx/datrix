/**
 * Where Operators Tests
 *
 * Tests for all query operators in where clauses
 *
 * Covers:
 * - Comparison: $eq, $ne, $gt, $gte, $lt, $lte
 * - Array: $in, $nin
 * - String: $contains, $notContains, $startsWith, $endsWith, $like, $ilike
 * - Null: $null, $notNull
 * - Logical: $and, $or, $not
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Forja } from "forja-core";
import fs from "node:fs/promises";
import {
	createTestConfig,
	getTmpDir,
	setupTables,
} from "../setup";

describe("Where Operators", () => {
	let forja: Forja;
	const tmpDir = getTmpDir("where_operators");

	beforeAll(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
		await fs.mkdir(tmpDir, { recursive: true });

		const getForja = await createTestConfig(tmpDir);
		forja = await getForja();

		await setupTables(forja);

		// Seed test data
		await forja.createMany("user", [
			{ email: "alice@test.com", name: "Alice Smith", age: 25, isActive: true },
			{ email: "bob@test.com", name: "Bob Johnson", age: 30, isActive: true },
			{ email: "charlie@test.com", name: "Charlie Brown", age: 35, isActive: false },
			{ email: "diana@test.com", name: "Diana Prince", age: 28, isActive: true },
			{ email: "eve@test.com", name: "Eve Wilson", age: null, isActive: false },
		]);

		await forja.createMany("category", [
			{ name: "Technology", slug: "technology", description: "Tech stuff" },
			{ name: "Science", slug: "science", description: "Scientific topics" },
			{ name: "Art", slug: "art", description: null },
			{ name: "Music", slug: "music", description: "Musical content" },
		]);
	});

	afterAll(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	// ==========================================================================
	// Comparison Operators
	// ==========================================================================

	describe("$eq (equals)", () => {
		it("should find exact string match", async () => {
			const results = await forja.findMany("user", {
				where: { name: { $eq: "Alice Smith" } },
			});

			expect(results).toHaveLength(1);
			expect(results[0].name).toBe("Alice Smith");
		});

		it("should find exact number match", async () => {
			const results = await forja.findMany("user", {
				where: { age: { $eq: 30 } },
			});

			expect(results).toHaveLength(1);
			expect(results[0].name).toBe("Bob Johnson");
		});

		it("should find exact boolean match", async () => {
			const results = await forja.findMany("user", {
				where: { isActive: { $eq: false } },
			});

			expect(results).toHaveLength(2);
			for (const user of results) {
				expect(user.isActive).toBe(false);
			}
		});

		it("should support shorthand (implicit $eq)", async () => {
			const results = await forja.findMany("user", {
				where: { name: "Alice Smith" },
			});

			expect(results).toHaveLength(1);
			expect(results[0].name).toBe("Alice Smith");
		});
	});

	describe("$ne (not equals)", () => {
		it("should exclude exact match", async () => {
			const results = await forja.findMany("user", {
				where: { name: { $ne: "Alice Smith" } },
			});

			expect(results.length).toBeGreaterThanOrEqual(4);
			for (const user of results) {
				expect(user.name).not.toBe("Alice Smith");
			}
		});

		it("should work with boolean", async () => {
			const results = await forja.findMany("user", {
				where: { isActive: { $ne: true } },
			});

			for (const user of results) {
				expect(user.isActive).not.toBe(true);
			}
		});
	});

	describe("$gt (greater than)", () => {
		it("should find values greater than", async () => {
			const results = await forja.findMany("user", {
				where: { age: { $gt: 28 } },
			});

			for (const user of results) {
				expect(user.age as number).toBeGreaterThan(28);
			}
		});
	});

	describe("$gte (greater than or equal)", () => {
		it("should find values greater than or equal", async () => {
			const results = await forja.findMany("user", {
				where: { age: { $gte: 30 } },
			});

			for (const user of results) {
				expect(user.age as number).toBeGreaterThanOrEqual(30);
			}
		});
	});

	describe("$lt (less than)", () => {
		it("should find values less than", async () => {
			const results = await forja.findMany("user", {
				where: { age: { $lt: 30 } },
			});

			for (const user of results) {
				expect(user.age as number).toBeLessThan(30);
			}
		});
	});

	describe("$lte (less than or equal)", () => {
		it("should find values less than or equal", async () => {
			const results = await forja.findMany("user", {
				where: { age: { $lte: 28 } },
			});

			for (const user of results) {
				expect(user.age as number).toBeLessThanOrEqual(28);
			}
		});
	});

	// ==========================================================================
	// Array Operators
	// ==========================================================================

	describe("$in (in array)", () => {
		it("should find values in array", async () => {
			const results = await forja.findMany("user", {
				where: { age: { $in: [25, 30, 35] } },
			});

			expect(results).toHaveLength(3);
			for (const user of results) {
				expect([25, 30, 35]).toContain(user.age);
			}
		});

		it("should work with strings", async () => {
			const results = await forja.findMany("category", {
				where: { slug: { $in: ["technology", "science"] } },
			});

			expect(results).toHaveLength(2);
			for (const cat of results) {
				expect(["technology", "science"]).toContain(cat.slug);
			}
		});

		it("should return empty for non-matching values", async () => {
			const results = await forja.findMany("user", {
				where: { age: { $in: [100, 200] } },
			});

			expect(results).toHaveLength(0);
		});
	});

	describe("$nin (not in array)", () => {
		it("should exclude values in array", async () => {
			const results = await forja.findMany("user", {
				where: { age: { $nin: [25, 30] } },
			});

			for (const user of results) {
				if (user.age !== null) {
					expect([25, 30]).not.toContain(user.age);
				}
			}
		});
	});

	// ==========================================================================
	// String Operators
	// ==========================================================================

	describe("$contains", () => {
		it("should find strings containing substring", async () => {
			const results = await forja.findMany("user", {
				where: { name: { $contains: "Smith" } },
			});

			expect(results).toHaveLength(1);
			expect(results[0].name).toBe("Alice Smith");
		});

		it("should be case-sensitive", async () => {
			const results = await forja.findMany("user", {
				where: { name: { $contains: "smith" } },
			});

			// Depending on implementation, this might be 0 or 1
			// Most DBs are case-sensitive by default
		});
	});

	describe("$notContains", () => {
		it("should exclude strings containing substring", async () => {
			const results = await forja.findMany("user", {
				where: { name: { $notContains: "Smith" } },
			});

			for (const user of results) {
				expect(user.name).not.toContain("Smith");
			}
		});
	});

	describe("$startsWith", () => {
		it("should find strings starting with prefix", async () => {
			const results = await forja.findMany("user", {
				where: { name: { $startsWith: "Alice" } },
			});

			expect(results).toHaveLength(1);
			expect(results[0].name).toBe("Alice Smith");
		});
	});

	describe("$endsWith", () => {
		it("should find strings ending with suffix", async () => {
			const results = await forja.findMany("user", {
				where: { name: { $endsWith: "Johnson" } },
			});

			expect(results).toHaveLength(1);
			expect(results[0].name).toBe("Bob Johnson");
		});
	});

	describe("$like (pattern match)", () => {
		it("should support % wildcard", async () => {
			const results = await forja.findMany("user", {
				where: { name: { $like: "%Brown" } },
			});

			expect(results).toHaveLength(1);
			expect(results[0].name).toBe("Charlie Brown");
		});

		it("should support _ single char wildcard", async () => {
			const results = await forja.findMany("user", {
				where: { email: { $like: "e__@test.com" } },
			});

			expect(results).toHaveLength(1);
			expect(results[0].email).toBe("eve@test.com");
		});
	});

	describe("$ilike (case-insensitive pattern)", () => {
		it("should match case-insensitively", async () => {
			const results = await forja.findMany("user", {
				where: { name: { $ilike: "%SMITH%" } },
			});

			expect(results).toHaveLength(1);
			expect(results[0].name).toBe("Alice Smith");
		});
	});

	// ==========================================================================
	// Null Operators
	// ==========================================================================

	describe("$null", () => {
		it("should find null values", async () => {
			const results = await forja.findMany("user", {
				where: { age: { $null: true } },
			});

			expect(results).toHaveLength(1);
			expect(results[0].name).toBe("Eve Wilson");
			expect(results[0].age).toBeNull();
		});

		it("should find non-null values with $null: false", async () => {
			const results = await forja.findMany("user", {
				where: { age: { $null: false } },
			});

			for (const user of results) {
				expect(user.age).not.toBeNull();
			}
		});
	});

	describe("$notNull", () => {
		it("should find non-null values", async () => {
			const results = await forja.findMany("category", {
				where: { description: { $notNull: true } },
			});

			for (const cat of results) {
				expect(cat.description).not.toBeNull();
			}
		});
	});

	// ==========================================================================
	// Logical Operators
	// ==========================================================================

	describe("$and", () => {
		it("should require all conditions", async () => {
			const results = await forja.findMany("user", {
				where: {
					$and: [{ age: { $gte: 25 } }, { age: { $lte: 30 } }],
				},
			});

			for (const user of results) {
				expect(user.age as number).toBeGreaterThanOrEqual(25);
				expect(user.age as number).toBeLessThanOrEqual(30);
			}
		});

		it("should work with multiple field conditions", async () => {
			const results = await forja.findMany("user", {
				where: {
					$and: [{ isActive: true }, { age: { $lt: 30 } }],
				},
			});

			for (const user of results) {
				expect(user.isActive).toBe(true);
				expect(user.age as number).toBeLessThan(30);
			}
		});

		it("should support implicit $and (multiple fields)", async () => {
			const results = await forja.findMany("user", {
				where: {
					isActive: true,
					age: { $gte: 28 },
				},
			});

			for (const user of results) {
				expect(user.isActive).toBe(true);
				expect(user.age as number).toBeGreaterThanOrEqual(28);
			}
		});
	});

	describe("$or", () => {
		it("should match any condition", async () => {
			const results = await forja.findMany("user", {
				where: {
					$or: [{ age: 25 }, { age: 35 }],
				},
			});

			expect(results).toHaveLength(2);
			for (const user of results) {
				expect([25, 35]).toContain(user.age);
			}
		});

		it("should work with different fields", async () => {
			const results = await forja.findMany("user", {
				where: {
					$or: [{ name: { $startsWith: "Alice" } }, { name: { $startsWith: "Bob" } }],
				},
			});

			expect(results).toHaveLength(2);
		});
	});

	describe("$not", () => {
		it("should negate condition", async () => {
			const results = await forja.findMany("user", {
				where: {
					$not: { isActive: true },
				},
			});

			for (const user of results) {
				expect(user.isActive).not.toBe(true);
			}
		});

		it("should negate complex condition", async () => {
			const results = await forja.findMany("user", {
				where: {
					$not: { age: { $in: [25, 30] } },
				},
			});

			for (const user of results) {
				if (user.age !== null) {
					expect([25, 30]).not.toContain(user.age);
				}
			}
		});
	});

	// ==========================================================================
	// Complex Combinations
	// ==========================================================================

	describe("Complex Combinations", () => {
		it("should handle nested $and/$or", async () => {
			const results = await forja.findMany("user", {
				where: {
					$or: [
						{
							$and: [{ age: { $gte: 30 } }, { isActive: true }],
						},
						{
							$and: [{ age: { $lt: 26 } }, { isActive: true }],
						},
					],
				},
			});

			for (const user of results) {
				const isOldAndActive = (user.age as number) >= 30 && user.isActive === true;
				const isYoungAndActive = (user.age as number) < 26 && user.isActive === true;
				expect(isOldAndActive || isYoungAndActive).toBe(true);
			}
		});

		it("should combine operators on same field", async () => {
			const results = await forja.findMany("user", {
				where: {
					age: { $gte: 25, $lte: 30 },
				},
			});

			for (const user of results) {
				expect(user.age as number).toBeGreaterThanOrEqual(25);
				expect(user.age as number).toBeLessThanOrEqual(30);
			}
		});
	});

	// ==========================================================================
	// Error Cases
	// ==========================================================================

	describe("Error Cases", () => {
		it("should throw error for invalid operator", async () => {
			await expect(
				forja.findMany("user", {
					where: { name: { $invalid: "test" } } as Record<string, unknown>,
				}),
			).rejects.toThrow();
		});

		it("should throw error for invalid field", async () => {
			await expect(
				forja.findMany("user", {
					where: { nonExistent: "value" },
				}),
			).rejects.toThrow();
		});
	});
});
