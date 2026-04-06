import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { JsonAdapter } from "../src/adapter";
import { QueryObject } from "../../core/src/types";
import {
	expectFailureError,
	expectSuccessData,
} from "../../core/tests/test/helpers";

describe.skip("JsonAdapter - Advanced Features Error/Edge Cases", () => {
	const root = path.join(__dirname, "tmp_features_error_test");
	let adapter: JsonAdapter;

	beforeEach(async () => {
		await fs.rm(root, { recursive: true, force: true });
		adapter = new JsonAdapter({ root, standalone: true });
		await adapter.connect();
		await adapter.createTable({
			name: "users",
			tableName: "users",
			fields: {
				name: { type: "string", required: true },
				id: { type: "number" },
			},
		});
		await adapter.executeQuery({
			type: "insert",
			table: "users",
			data: [{ name: "Alice" }],
		});
	});

	afterEach(async () => {
		await adapter.disconnect();
		await fs.rm(root, { recursive: true, force: true });
	});

	describe("Data Corruption: JSON File Integrity", () => {
		it("should handle corrupted JSON files gracefully", async () => {
			const filePath = path.join(root, "users.json");
			await fs.writeFile(filePath, "{invalid json:::");

			const result = await adapter.executeQuery({
				type: "select",
				table: "users",
			});

			const error = expectFailureError(result);
			expect(error.code).toBe("QUERY_ERROR");
			expect(error.message.toLowerCase()).toMatch(/parse|json/);
		});

		it("should handle missing data/rows field", async () => {
			const filePath = path.join(root, "users.json");
			await fs.writeFile(filePath, '{"wrong": "structure"}');

			const result = expectSuccessData(
				await adapter.executeQuery({
					type: "select",
					table: "users",
				}),
			);

			expect(result.rows).toEqual([]);
		});

		it("should handle truncated JSON files", async () => {
			const filePath = path.join(root, "users.json");
			await fs.writeFile(filePath, '{"data":{"rows":[{"id":1');

			const result = await adapter.executeQuery({
				type: "select",
				table: "users",
			});

			const error = expectFailureError(result);
			expect(error.code).toBe("QUERY_ERROR");
		});

		it("should handle empty file", async () => {
			const filePath = path.join(root, "users.json");
			await fs.writeFile(filePath, "");

			const result = await adapter.executeQuery({
				type: "select",
				table: "users",
			});

			if (!result.success) {
				expect(result.error.code).toBe("QUERY_ERROR");
			} else {
				expect(result.data.rows).toEqual([]);
			}
		});
	});

	describe("Projection (Select)", () => {
		it("should handle non-existent fields gracefully (ignore them)", async () => {
			const result = expectSuccessData(
				await adapter.executeQuery({
					type: "select",
					table: "users",
					select: ["name", "nonExistentField"],
				}),
			);

			expect(result.rows[0]).toHaveProperty("name");
			expect(result.rows[0]).not.toHaveProperty("nonExistentField");
		});

		it("should return empty objects if no fields match", async () => {
			const result = expectSuccessData(
				await adapter.executeQuery({
					type: "select",
					table: "users",
					select: ["invalid"],
				}),
			);

			expect(result.rows).toHaveLength(1);
			expect(result.rows[0]).toEqual({});
		});
	});

	describe("Populate", () => {
		it("should throw when relation target model not found", async () => {
			// Create table with relation to non-existent model
			await adapter.createTable({
				name: "UserWithProfile",
				tableName: "users_with_profile",
				fields: {
					name: { type: "string", required: true },
					profile: {
						type: "relation",
						kind: "hasOne",
						model: "NonExistentProfile",
						foreignKey: "userId",
					},
				},
			});

			await adapter.executeQuery({
				type: "insert",
				table: "users_with_profile",
				data: [{ name: "Test User" }],
			});

			const query: QueryObject = {
				type: "select",
				table: "users_with_profile",
				populate: { profile: {} },
			};

			// Should throw error for broken relation
			const result = await adapter.executeQuery(query);
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error.code).toBe("ADAPTER_TARGET_MODEL_NOT_FOUND");
				expect(result.error.message.toLowerCase()).toMatch(
					/not found|nonexistent/,
				);
			}
		});
	});

	describe("Returning", () => {
		it.fails("should ignore returning fields that do not exist", async () => {
			const result = expectSuccessData(
				await adapter.executeQuery({
					type: "insert",
					table: "users",
					data: [{ name: "Bob" }],
					returning: ["id", "ghost_field", "name"],
				}),
			);

			expect(result.rows[0]).toHaveProperty("id");
			expect(result.rows[0]).toHaveProperty("name");
			expect(result.rows[0]).not.toHaveProperty("ghost_field");
		});
	});

	describe("Boundary: Data Limits", () => {
		it("should handle very large records", async () => {
			const hugeString = "x".repeat(10 * 1024 * 1024);

			const result = await adapter.executeQuery({
				type: "insert",
				table: "users",
				data: [{ name: "Test", bio: hugeString }],
			});

			if (!result.success) {
				expect(result.error.code).toBe("QUERY_ERROR");
				expect(result.error.message.toLowerCase()).toMatch(/size|large|limit/);
			}
		});

		it("should handle empty where clause as match-all", async () => {
			await adapter.executeQuery({
				type: "insert",
				table: "users",
				data: [{ name: "Bob" }],
			});
			await adapter.executeQuery({
				type: "insert",
				table: "users",
				data: [{ name: "Charlie" }],
			});

			const deleteResult = expectSuccessData(
				await adapter.executeQuery({
					type: "delete",
					table: "users",
					where: {},
				}),
			);

			expect(deleteResult.metadata.affectedRows).toBeGreaterThanOrEqual(3);
		});

		it("should handle deeply nested populate gracefully", async () => {
			await adapter.createTable({
				name: "A",
				tableName: "a",
				fields: {
					name: { type: "string", required: true },
					b: {
						type: "relation",
						kind: "hasMany",
						model: "B",
						foreignKey: "aId",
					},
				},
			});
			await adapter.createTable({
				name: "B",
				tableName: "b",
				fields: {
					name: { type: "string", required: true },
					aId: { type: "number", required: true },
					a: {
						type: "relation",
						kind: "belongsTo",
						model: "A",
						foreignKey: "aId",
					},
					c: {
						type: "relation",
						kind: "hasMany",
						model: "C",
						foreignKey: "bId",
					},
				},
			});
			await adapter.createTable({
				name: "C",
				tableName: "c",
				fields: {
					name: { type: "string", required: true },
					bId: { type: "number", required: true },
					b: {
						type: "relation",
						kind: "belongsTo",
						model: "B",
						foreignKey: "bId",
					},
					d: {
						type: "relation",
						kind: "hasMany",
						model: "D",
						foreignKey: "cId",
					},
				},
			});
			await adapter.createTable({
				name: "D",
				tableName: "d",
				fields: {
					name: { type: "string", required: true },
					cId: { type: "number", required: true },
					c: {
						type: "relation",
						kind: "belongsTo",
						model: "C",
						foreignKey: "cId",
					},
				},
			});

			await adapter.executeQuery({
				type: "insert",
				table: "a",
				data: [{ name: "A1" }],
			});
			await adapter.executeQuery({
				type: "insert",
				table: "b",
				data: [{ name: "B1", aId: 1 }],
			});
			await adapter.executeQuery({
				type: "insert",
				table: "c",
				data: [{ name: "C1", bId: 1 }],
			});
			await adapter.executeQuery({
				type: "insert",
				table: "d",
				data: [{ name: "D1", cId: 1 }],
			});

			const deepQuery: QueryObject = {
				type: "select",
				table: "a",
				populate: {
					b: {
						populate: {
							c: {
								populate: {
									d: {},
								},
							},
						},
					},
				},
			};

			// This should work - 4 level nesting is supported
			const result = expectSuccessData(await adapter.executeQuery(deepQuery));
			const a = result.rows[0] as any;

			expect(a.b).toBeDefined();
			expect(Array.isArray(a.b)).toBe(true);
			if (a.b.length > 0) {
				expect(a.b[0].c).toBeDefined();
			}
		});

		it("should handle zero-length arrays and objects", async () => {
			const result = expectSuccessData(
				await adapter.executeQuery({
					type: "select",
					table: "users",
					select: [],
				}),
			);

			expect(Array.isArray(result.rows)).toBe(true);
		});

		it("should handle extremely long field names", async () => {
			const longFieldName = "a".repeat(10000);

			const result = await adapter.executeQuery({
				type: "select",
				table: "users",
				select: [longFieldName],
			});

			if (result.success) {
				expect(result.data.rows[0]).not.toHaveProperty(longFieldName);
			}
		});
	});

	describe("Invariants: Input Immutability", () => {
		it("should not mutate input query object", async () => {
			const originalQuery: QueryObject = {
				type: "select",
				table: "users",
				where: { name: "Alice" },
				select: ["id", "name"],
			};

			const querySnapshot = JSON.parse(JSON.stringify(originalQuery));

			await adapter.executeQuery(originalQuery);

			expect(originalQuery).toEqual(querySnapshot);
		});

		it("should not mutate input data object on insert", async () => {
			const inputData = { name: "Immutable", age: 25 };
			const dataSnapshot = JSON.parse(JSON.stringify(inputData));

			await adapter.executeQuery({
				type: "insert",
				table: "users",
				data: [inputData],
			});

			expect(inputData).toEqual(dataSnapshot);
		});
	});
});
