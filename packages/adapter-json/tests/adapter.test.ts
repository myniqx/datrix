import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { JsonAdapter } from "../src/adapter";
import { SchemaDefinition } from "../../core/src/types";
import { expectSuccessData } from "../../core/tests/test/helpers";

describe.skip("JsonAdapter - Happy Path", () => {
	const root = path.join(__dirname, "tmp_adapter_happy_test");
	let adapter: JsonAdapter;

	beforeEach(async () => {
		await fs.rm(root, { recursive: true, force: true });
		adapter = new JsonAdapter({ root, standalone: true });
		await adapter.connect();
	});

	afterEach(async () => {
		await adapter.disconnect();
		await fs.rm(root, { recursive: true, force: true });
	});

	it("should create table (json file)", async () => {
		const schema: SchemaDefinition = {
			name: "users",
			tableName: "users",
			fields: {
				id: { type: "number", required: true },
				name: { type: "string", required: true },
			},
		};

		const result = expectSuccessData(await adapter.createTable(schema));
		expect(result).toBeUndefined();

		const fileExists = await fs
			.stat(path.join(root, "users.json"))
			.then(() => true)
			.catch(() => false);
		expect(fileExists).toBe(true);
	});

	it("should insert and select data", async () => {
		await adapter.createTable({
			name: "users",
			tableName: "users",
			fields: { name: { type: "string", required: true } },
		});

		// Insert
		const insertResult = expectSuccessData(
			await adapter.executeQuery({
				type: "insert",
				table: "users",
				data: [{ name: "Burak" }],
			}),
		);

		expect(insertResult.metadata.insertIds[0]).toBe(1);

		// Select
		const selectResult = expectSuccessData(
			await adapter.executeQuery({
				type: "select",
				table: "users",
			}),
		);

		expect(selectResult.rows).toHaveLength(1);
		expect(selectResult.rows[0]).toEqual({ id: 1, name: "Burak" });
	});

	it("should update data", async () => {
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
			data: [{ name: "Old" }],
		});

		const updateResult = expectSuccessData(
			await adapter.executeQuery({
				type: "update",
				table: "users",
				data: { name: "New" },
				where: { id: 1 },
			}),
		);

		expect(updateResult.metadata.affectedRows).toBe(1);

		const selectResult = expectSuccessData(
			await adapter.executeQuery({
				type: "select",
				table: "users",
				where: { id: 1 },
			}),
		);

		expect(selectResult.rows[0]).toEqual({ id: 1, name: "New" });
	});

	it("should delete data", async () => {
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
			data: [{ name: "DeleteMe" }],
		});

		const deleteResult = expectSuccessData(
			await adapter.executeQuery({
				type: "delete",
				table: "users",
				where: { id: 1 },
			}),
		);

		expect(deleteResult.metadata.affectedRows).toBe(1);

		const selectResult = expectSuccessData(
			await adapter.executeQuery({
				type: "select",
				table: "users",
			}),
		);

		expect(selectResult.rows).toHaveLength(0);
	});

	describe("Invariants: Determinism", () => {
		it("should generate sequential IDs", async () => {
			await adapter.createTable({
				name: "users",
				tableName: "users",
				fields: { name: { type: "string", required: true } },
			});

			const insert1 = expectSuccessData(
				await adapter.executeQuery({
					type: "insert",
					table: "users",
					data: [{ name: "First" }],
				}),
			);

			const insert2 = expectSuccessData(
				await adapter.executeQuery({
					type: "insert",
					table: "users",
					data: [{ name: "Second" }],
				}),
			);

			const insert3 = expectSuccessData(
				await adapter.executeQuery({
					type: "insert",
					table: "users",
					data: [{ name: "Third" }],
				}),
			);

			expect(insert1.metadata.insertIds[0]).toBe(1);
			expect(insert2.metadata.insertIds[0]).toBe(2);
			expect(insert3.metadata.insertIds[0]).toBe(3);
		});

		it("should return consistent results for same query", async () => {
			await adapter.createTable({
				name: "users",
				tableName: "users",
				fields: { name: { type: "string", required: true } },
			});
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

			const result1 = expectSuccessData(
				await adapter.executeQuery({
					type: "select",
					table: "users",
					orderBy: [{ field: "name", direction: "asc" }],
				}),
			);

			const result2 = expectSuccessData(
				await adapter.executeQuery({
					type: "select",
					table: "users",
					orderBy: [{ field: "name", direction: "asc" }],
				}),
			);

			expect(result1.rows).toEqual(result2.rows);
		});

		it("should not be affected by object key order", async () => {
			await adapter.createTable({
				name: "users",
				tableName: "users",
				fields: {
					name: { type: "string", required: true },
					age: { type: "number", required: false },
				},
			});

			const data1 = { name: "Test", age: 25 };
			const data2 = { age: 25, name: "Test" };

			await adapter.executeQuery({
				type: "insert",
				table: "users",
				data: [data1],
			});

			const result1 = expectSuccessData(
				await adapter.executeQuery({
					type: "select",
					table: "users",
					where: data1,
				}),
			);

			const result2 = expectSuccessData(
				await adapter.executeQuery({
					type: "select",
					table: "users",
					where: data2,
				}),
			);

			expect(result1.rows).toEqual(result2.rows);
		});
	});

	describe("Invariants: Data Integrity", () => {
		it("should maintain data after disconnect and reconnect", async () => {
			await adapter.createTable({
				name: "users",
				tableName: "users",
				fields: { name: { type: "string", required: true } },
			});
			await adapter.executeQuery({
				type: "insert",
				table: "users",
				data: [{ name: "Persistent" }],
			});

			await adapter.disconnect();
			await adapter.connect();

			const result = expectSuccessData(
				await adapter.executeQuery({
					type: "select",
					table: "users",
				}),
			);

			expect(result.rows).toHaveLength(1);
			expect((result.rows[0] as any).name).toBe("Persistent");
		});

		it("should enforce ID uniqueness", async () => {
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

			const result = expectSuccessData(
				await adapter.executeQuery({
					type: "select",
					table: "users",
				}),
			);

			const ids = result.rows.map((r: any) => r.id);
			const uniqueIds = new Set(ids);

			expect(uniqueIds.size).toBe(ids.length);
		});

		it("should not create record on failed insert", async () => {
			await adapter.createTable({
				name: "users",
				tableName: "users",
				fields: { name: { type: "string", required: true } },
			});

			const beforeCount = expectSuccessData(
				await adapter.executeQuery({
					type: "select",
					table: "users",
				}),
			);

			const result = await adapter.executeQuery({
				type: "insert",
				table: "users",
				// @ts-ignore - Invalid data
				data: [null],
			});

			const afterCount = expectSuccessData(
				await adapter.executeQuery({
					type: "select",
					table: "users",
				}),
			);

			expect(beforeCount.rows.length).toBe(afterCount.rows.length);
		});
	});
});
