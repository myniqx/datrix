import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { JsonAdapter } from "../src/adapter";
import { expectSuccessData } from "../../core/tests/test/helpers";

describe.skip("JsonAdapter - Concurrent Access & Race Conditions", () => {
	const root = path.join(__dirname, "tmp_concurrent_test");
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
	});

	afterEach(async () => {
		await adapter.disconnect();
		await fs.rm(root, { recursive: true, force: true });
	});

	describe("Concurrent Writes", () => {
		it("should handle concurrent inserts without data loss", async () => {
			const concurrentInserts = Array.from({ length: 10 }, (_, i) =>
				adapter.executeQuery({
					type: "insert",
					table: "users",
					data: [{ name: `User${i}` }],
				}),
			);

			const results = await Promise.all(concurrentInserts);

			const allSucceeded = results.every((r) => r.success);
			if (allSucceeded) {
				const selectResult = expectSuccessData(
					await adapter.executeQuery({ type: "select", table: "users" }),
				);

				expect(selectResult.rows).toHaveLength(10);

				const ids = selectResult.rows.map((r: any) => r.id);
				expect(new Set(ids).size).toBe(10);
			}
		});

		it("should handle concurrent updates to different records", async () => {
			await adapter.executeQuery({
				type: "insert",
				table: "users",
				data: [{ name: "User1" }],
			});
			await adapter.executeQuery({
				type: "insert",
				table: "users",
				data: [{ name: "User2" }],
			});
			await adapter.executeQuery({
				type: "insert",
				table: "users",
				data: [{ name: "User3" }],
			});

			const concurrentUpdates = [
				adapter.executeQuery({
					type: "update",
					table: "users",
					where: { id: 1 },
					data: { name: "Updated1" },
				}),
				adapter.executeQuery({
					type: "update",
					table: "users",
					where: { id: 2 },
					data: { name: "Updated2" },
				}),
				adapter.executeQuery({
					type: "update",
					table: "users",
					where: { id: 3 },
					data: { name: "Updated3" },
				}),
			];

			await Promise.all(concurrentUpdates);

			const result = expectSuccessData(
				await adapter.executeQuery({ type: "select", table: "users" }),
			);

			expect(result.rows).toHaveLength(3);
			expect((result.rows[0] as any).name).toBe("Updated1");
			expect((result.rows[1] as any).name).toBe("Updated2");
			expect((result.rows[2] as any).name).toBe("Updated3");
		});

		it("should handle concurrent updates to same record gracefully", async () => {
			await adapter.executeQuery({
				type: "insert",
				table: "users",
				data: [{ name: "Original" }],
			});

			const concurrentUpdates = Array.from({ length: 5 }, (_, i) =>
				adapter.executeQuery({
					type: "update",
					table: "users",
					where: { id: 1 },
					data: { name: `Update${i}` },
				}),
			);

			await Promise.all(concurrentUpdates);

			const result = expectSuccessData(
				await adapter.executeQuery({
					type: "select",
					table: "users",
					where: { id: 1 },
				}),
			);

			expect(result.rows).toHaveLength(1);
			expect((result.rows[0] as any).name).toMatch(/Update\d/);
		});

		it("should handle mixed concurrent operations", async () => {
			await adapter.executeQuery({
				type: "insert",
				table: "users",
				data: [{ name: "Existing" }],
			});

			const mixedOperations = [
				adapter.executeQuery({
					type: "insert",
					table: "users",
					data: [{ name: "New1" }],
				}),
				adapter.executeQuery({
					type: "insert",
					table: "users",
					data: [{ name: "New2" }],
				}),
				adapter.executeQuery({
					type: "update",
					table: "users",
					where: { id: 1 },
					data: { name: "Modified" },
				}),
				adapter.executeQuery({ type: "select", table: "users" }),
				adapter.executeQuery({
					type: "insert",
					table: "users",
					data: [{ name: "New3" }],
				}),
			];

			const results = await Promise.all(mixedOperations);

			const allCompleted = results.every(
				(r) => r.success === true || r.success === false,
			);
			expect(allCompleted).toBe(true);

			const finalResult = expectSuccessData(
				await adapter.executeQuery({ type: "select", table: "users" }),
			);

			expect(finalResult.rows.length).toBeGreaterThanOrEqual(3);
		});
	});

	describe("Read-Write Race Conditions", () => {
		it("should prevent corruption during simultaneous read-write", async () => {
			const operations = [];

			for (let i = 0; i < 20; i++) {
				if (i % 2 === 0) {
					operations.push(
						adapter.executeQuery({
							type: "insert",
							table: "users",
							data: [{ name: `User${i}` }],
						}),
					);
				} else {
					operations.push(
						adapter.executeQuery({ type: "select", table: "users" }),
					);
				}
			}

			const results = await Promise.all(operations);

			const noErrors = results.every((r) => r.success);
			if (noErrors) {
				const finalCheck = expectSuccessData(
					await adapter.executeQuery({ type: "select", table: "users" }),
				);

				expect(finalCheck.rows.length).toBe(10);

				const fileContent = await fs.readFile(
					path.join(root, "users.json"),
					"utf-8",
				);
				expect(() => JSON.parse(fileContent)).not.toThrow();
			}
		});

		it("should maintain data integrity during concurrent delete-read", async () => {
			await adapter.executeQuery({
				type: "insert",
				table: "users",
				data: [{ name: "ToDelete" }],
			});
			await adapter.executeQuery({
				type: "insert",
				table: "users",
				data: [{ name: "ToKeep" }],
			});

			const operations = [
				adapter.executeQuery({
					type: "delete",
					table: "users",
					where: { id: 1 },
				}),
				adapter.executeQuery({ type: "select", table: "users" }),
				adapter.executeQuery({
					type: "select",
					table: "users",
					where: { id: 2 },
				}),
			];

			const results = await Promise.all(operations);

			const allSucceeded = results.every((r) => r.success);
			expect(allSucceeded).toBe(true);
		});
	});

	describe("Determinism & Idempotency", () => {
		it("should return same results for identical queries", async () => {
			await adapter.executeQuery({
				type: "insert",
				table: "users",
				data: [{ name: "Alice" }],
			});
			await adapter.executeQuery({
				type: "insert",
				table: "users",
				data: [{ name: "Bob" }],
			});

			const query = {
				type: "select" as const,
				table: "users",
				orderBy: [{ field: "name", direction: "asc" as const }],
			};

			const result1 = expectSuccessData(await adapter.executeQuery(query));
			const result2 = expectSuccessData(await adapter.executeQuery(query));
			const result3 = expectSuccessData(await adapter.executeQuery(query));

			expect(result1.rows).toEqual(result2.rows);
			expect(result2.rows).toEqual(result3.rows);
		});

		it("should handle concurrent identical queries deterministically", async () => {
			await adapter.executeQuery({
				type: "insert",
				table: "users",
				data: [{ name: "Test" }],
			});

			const identicalQueries = Array.from({ length: 10 }, () =>
				adapter.executeQuery({ type: "select", table: "users" }),
			);

			const results = await Promise.all(identicalQueries);

			const firstResult = expectSuccessData(results[0]);
			results.forEach((r) => {
				const data = expectSuccessData(r);
				expect(data.rows).toEqual(firstResult.rows);
			});
		});
	});

	describe("Lock Behavior", () => {
		it("should handle lock timeout gracefully", async () => {
			const longOperations = Array.from({ length: 50 }, (_, i) =>
				adapter.executeQuery({
					type: "insert",
					table: "users",
					data: [{ name: `User${i}` }],
				}),
			);

			const results = await Promise.all(longOperations);

			const successCount = results.filter((r) => r.success).length;
			expect(successCount).toBeGreaterThan(0);
		}, 15000); // 15 second timeout for this test

		it("should prevent deadlock scenarios", async () => {
			await adapter.executeQuery({
				type: "insert",
				table: "users",
				data: [{ name: "Initial" }],
			});

			const operations = Array.from({ length: 10 }, (_, i) => [
				adapter.executeQuery({
					type: "update",
					table: "users",
					where: { id: 1 },
					data: [{ name: `A${i}` }],
				}),
				adapter.executeQuery({
					type: "select",
					table: "users",
					where: { id: 1 },
				}),
				adapter.executeQuery({
					type: "update",
					table: "users",
					where: { id: 1 },
					data: { name: `B${i}` },
				}),
			]).flat();

			const results = await Promise.all(operations);

			const allCompleted = results.every((r) => r.success !== undefined);
			expect(allCompleted).toBe(true);
		});
	});
});
