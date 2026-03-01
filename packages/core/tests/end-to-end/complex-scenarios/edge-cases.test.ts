/**
 * Edge Cases Tests
 *
 * Tests for unusual scenarios and boundary conditions
 *
 * Covers:
 * - Empty values (null, undefined, empty string, empty array)
 * - Boundary values (min/max numbers, long strings)
 * - Special characters in data
 * - Unicode and emoji handling
 * - JSON field edge cases
 * - Date edge cases
 * - Concurrent operations
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Forja } from "forja-core";
import fs from "node:fs/promises";
import { createTestConfig, getTmpDir, setupTables } from "../setup";

describe("Edge Cases", () => {
	let forja: Forja;
	const tmpDir = getTmpDir("edge_cases");

	beforeAll(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
		await fs.mkdir(tmpDir, { recursive: true });

		const getForja = await createTestConfig(tmpDir);
		forja = await getForja();

		await setupTables(forja);
	});

	afterAll(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	// ==========================================================================
	// Empty Values
	// ==========================================================================

	describe("Empty Values", () => {
		it("should handle empty string in string field", async () => {
			const user = await forja.create("user", {
				email: "empty-name@test.com",
				name: "Empty Name",
				lastName: "",
			});

			expect(user["lastName"]).toBe("");
		});

		it("should handle null in optional field", async () => {
			const user = await forja.create("user", {
				email: "null-age@test.com",
				name: "Null Age",
				age: null,
			});

			expect(user["age"]).toBeNull();
		});

		it("should handle empty object in JSON field", async () => {
			const user = await forja.create("user", {
				email: "empty-meta@test.com",
				name: "Empty Meta",
				metadata: {},
			});

			expect(user["metadata"]).toEqual({});
		});

		it("should handle empty array in JSON field", async () => {
			const user = await forja.create("user", {
				email: "array-meta@test.com",
				name: "Array Meta",
				metadata: [],
			});

			expect(user["metadata"]).toEqual([]);
		});

		it("should handle null in JSON field", async () => {
			const user = await forja.create("user", {
				email: "null-meta@test.com",
				name: "Null Meta",
				metadata: null,
			});

			expect(user["metadata"]).toBeNull();
		});
	});

	// ==========================================================================
	// Boundary Values
	// ==========================================================================

	describe("Boundary Values", () => {
		it("should handle age at minimum (0)", async () => {
			const user = await forja.create("user", {
				email: "min-age@test.com",
				name: "Min Age",
				age: 0,
			});

			expect(user["age"]).toBe(0);
		});

		it("should handle age at maximum (150)", async () => {
			const user = await forja.create("user", {
				email: "max-age@test.com",
				name: "Max Age",
				age: 150,
			});

			expect(user["age"]).toBe(150);
		});

		it("should handle very long valid string", async () => {
			const longName = "A".repeat(200); // Within maxLength
			const user = await forja.create("user", {
				email: "long-name@test.com",
				name: "Long Name",
				lastName: longName,
			});

			expect(user["lastName"]).toBe(longName);
		});

		it("should handle large budget number", async () => {
			const org = await forja.create("organization", {
				name: "Big Budget Org",
				country: "USA",
			});

			const dept = await forja.create("department", {
				name: "Big Budget Dept",
				code: "BBD",
				budget: 999999999,
				organization: org.id,
			});

			expect(dept["budget"]).toBe(999999999);
		});

		it("should handle decimal numbers", async () => {
			const org = await forja.create("organization", {
				name: "Decimal Org",
				country: "USA",
			});

			const dept = await forja.create("department", {
				name: "Decimal Dept",
				code: "DEC",
				budget: 12345.67,
				organization: org.id,
			});

			expect(dept["budget"]).toBeCloseTo(12345.67);
		});
	});

	// ==========================================================================
	// Special Characters
	// ==========================================================================

	describe("Special Characters", () => {
		it("should handle quotes in string fields", async () => {
			const user = await forja.create("user", {
				email: "quotes@test.com",
				name: 'User "with" quotes',
			});

			expect(user["name"]).toBe('User "with" quotes');
		});

		it("should handle single quotes", async () => {
			const user = await forja.create("user", {
				email: "single-quotes@test.com",
				name: "User's name",
			});

			expect(user["name"]).toBe("User's name");
		});

		it("should handle backslashes", async () => {
			const user = await forja.create("user", {
				email: "backslash@test.com",
				name: "User\\with\\backslash",
			});

			expect(user["name"]).toBe("User\\with\\backslash");
		});

		it("should handle newlines in string", async () => {
			const post = await forja.create("post", {
				title: "Post with newlines",
				content: "Line 1\nLine 2\nLine 3",
				slug: "post-newlines",
				author: (
					await forja.create("user", { email: "newline@test.com", name: "NL" })
				).id,
			});

			expect(post["content"]).toContain("\n");
		});

		it("should handle SQL injection attempt in data", async () => {
			const user = await forja.create("user", {
				email: "injection@test.com",
				name: "'; DROP TABLE users; --",
			});

			// Should be stored as-is, not executed
			expect(user["name"]).toBe("'; DROP TABLE users; --");

			// Table should still exist
			const count = await forja.count("user");
			expect(count).toBeGreaterThan(0);
		});
	});

	// ==========================================================================
	// Unicode and Emoji
	// ==========================================================================

	describe("Unicode and Emoji", () => {
		it("should handle unicode characters", async () => {
			const user = await forja.create("user", {
				email: "unicode@test.com",
				name: "用户名称", // Chinese characters
			});

			expect(user["name"]).toBe("用户名称");
		});

		it("should handle mixed unicode", async () => {
			const user = await forja.create("user", {
				email: "mixed-unicode@test.com",
				name: "Пользователь User ユーザー",
			});

			expect(user["name"]).toBe("Пользователь User ユーザー");
		});

		it("should handle emoji in string field", async () => {
			const user = await forja.create("user", {
				email: "emoji@test.com",
				name: "User 👋 Hello 🌍",
			});

			expect(user["name"]).toContain("👋");
			expect(user["name"]).toContain("🌍");
		});

		it("should handle emoji in search", async () => {
			await forja.create("user", {
				email: "emoji-search@test.com",
				name: "Emoji 🔥 User",
			});

			const found = await forja.findOne("user", {
				name: { $like: "%🔥%" },
			});

			expect(found).not.toBeNull();
		});
	});

	// ==========================================================================
	// JSON Field Edge Cases
	// ==========================================================================

	describe("JSON Field Edge Cases", () => {
		it("should handle nested JSON object", async () => {
			const user = await forja.create("user", {
				email: "nested-json@test.com",
				name: "Nested JSON",
				metadata: {
					level1: {
						level2: {
							level3: {
								value: "deep",
							},
						},
					},
				},
			});

			expect((user.metadata as Record<string, unknown>).level1).toBeDefined();
		});

		it("should handle JSON with array of objects", async () => {
			const user = await forja.create("user", {
				email: "json-array@test.com",
				name: "JSON Array",
				metadata: {
					items: [
						{ id: 1, name: "Item 1" },
						{ id: 2, name: "Item 2" },
					],
				},
			});

			const meta = user.metadata as { items: unknown[] };
			expect(meta.items).toHaveLength(2);
		});

		it("should handle JSON with special values", async () => {
			const user = await forja.create("user", {
				email: "json-special@test.com",
				name: "JSON Special",
				metadata: {
					nullValue: null,
					boolTrue: true,
					boolFalse: false,
					number: 42,
					float: 3.14,
					string: "text",
				},
			});

			const meta = user["metadata"] as Record<string, unknown>;
			expect(meta.nullValue).toBeNull();
			expect(meta.boolTrue).toBe(true);
			expect(meta.boolFalse).toBe(false);
		});
	});

	// ==========================================================================
	// Date Edge Cases
	// ==========================================================================

	describe("Date Edge Cases", () => {
		it("should handle createdAt/updatedAt automatically", async () => {
			const user = await forja.create("user", {
				email: "dates@test.com",
				name: "Date User",
			});

			expect(user.createdAt).toBeDefined();
			expect(user.updatedAt).toBeDefined();
			expect(new Date(user.createdAt)).toBeInstanceOf(Date);
		});

		it("should update updatedAt on modification", async () => {
			const user = await forja.create("user", {
				email: "update-date@test.com",
				name: "Update Date User",
			});

			const originalUpdatedAt = new Date(user.updatedAt).getTime();

			// Wait a bit
			await new Promise((r) => setTimeout(r, 50));

			const updated = await forja.update("user", user.id, {
				name: "Updated Name",
			});

			const newUpdatedAt = new Date(updated.updatedAt).getTime();
			expect(newUpdatedAt).toBeGreaterThan(originalUpdatedAt);
		});
	});

	// ==========================================================================
	// Concurrent Operations
	// ==========================================================================

	describe("Concurrent Operations", () => {
		it("should handle concurrent creates", async () => {
			const promises = Array.from({ length: 10 }, (_, i) =>
				forja.create("user", {
					email: `concurrent-create-${i}@test.com`,
					name: `Concurrent User ${i}`,
				}),
			);

			const results = await Promise.all(promises);

			expect(results).toHaveLength(10);
			const uniqueIds = new Set(results.map((r) => r.id));
			expect(uniqueIds.size).toBe(10);
		});

		it("should handle concurrent reads", async () => {
			const user = await forja.create("user", {
				email: "concurrent-read@test.com",
				name: "Concurrent Read User",
			});

			const promises = Array.from({ length: 10 }, () =>
				forja.findById("user", user.id),
			);

			const results = await Promise.all(promises);

			for (const result of results) {
				expect(result).not.toBeNull();
				expect(result!.id).toBe(user.id);
			}
		});

		it("should handle concurrent updates to different records", async () => {
			const users = await forja.createMany("user", [
				{ email: "concurrent-update-1@test.com", name: "CU 1" },
				{ email: "concurrent-update-2@test.com", name: "CU 2" },
				{ email: "concurrent-update-3@test.com", name: "CU 3" },
			]);

			const promises = users.map((u, i) =>
				forja.update("user", u.id, { name: `Updated CU ${i}` }),
			);

			const results = await Promise.all(promises);

			expect(results).toHaveLength(3);
		});
	});

	// ==========================================================================
	// Query Edge Cases
	// ==========================================================================

	describe("Query Edge Cases", () => {
		it("should handle query with many conditions", async () => {
			const users = await forja.findMany("user", {
				where: {
					$and: [
						{ isActive: true },
						{ age: { $gte: 0 } },
						{ age: { $lte: 150 } },
						{ email: { $like: "%@test.com" } },
						{ name: { $ne: "" } },
					],
				},
			});

			expect(Array.isArray(users)).toBe(true);
		});

		it("should handle deeply nested $or/$and", async () => {
			const users = await forja.findMany("user", {
				where: {
					$or: [
						{
							$and: [{ isActive: true }, { age: { $gte: 30 } }],
						},
						{
							$and: [{ isActive: false }, { age: { $lt: 30 } }],
						},
					],
				},
			});

			expect(Array.isArray(users)).toBe(true);
		});

		it("should handle empty $in array", async () => {
			const users = await forja.findMany("user", {
				where: { id: { $in: [] } },
			});

			expect(users).toHaveLength(0);
		});

		it("should handle $in with single value", async () => {
			const user = await forja.create("user", {
				email: "single-in@test.com",
				name: "Single In",
			});

			const found = await forja.findMany("user", {
				where: { id: { $in: [user.id] } },
			});

			expect(found).toHaveLength(1);
		});
	});
});
