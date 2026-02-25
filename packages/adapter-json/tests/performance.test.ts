import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { JsonAdapter } from "../src/adapter";
import { expectSuccessData } from "../../types/src/test/helpers";

describe("JsonAdapter - Performance & Resource Usage", () => {
	const root = path.join(__dirname, "tmp_performance_test");
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

	describe("Memory Management", () => {
		it("should not leak memory on repeated queries", async () => {
			await adapter.createTable({
				name: "users",
				tableName: "users",
				tableName: "users",
				fields: { name: { type: "string", required: true } },
			});
			await adapter.executeQuery({
				type: "insert",
				table: "users",
				data: [{ name: "Test" }],
			});

			const initialMemory = process.memoryUsage().heapUsed;

			for (let i = 0; i < 1000; i++) {
				await adapter.executeQuery({ type: "select", table: "users" });
			}

			if (global.gc) global.gc();

			const memoryGrowth = process.memoryUsage().heapUsed - initialMemory;
			expect(memoryGrowth).toBeLessThan(10 * 1024 * 1024);
		});

		it("should handle large result sets efficiently", async () => {
			await adapter.createTable({
				name: "users",
				tableName: "users",
				fields: { name: { type: "string", required: true } },
			});

			for (let i = 0; i < 200; i++) {
				await adapter.executeQuery({
					type: "insert",
					table: "users",
					data: [{ name: `User${i}` }],
				});
			}

			const initialMemory = process.memoryUsage().heapUsed;

			const result = expectSuccessData(
				await adapter.executeQuery({ type: "select", table: "users" }),
			);

			expect(result.rows.length).toBeGreaterThanOrEqual(190);

			const memoryUsed = process.memoryUsage().heapUsed - initialMemory;
			expect(memoryUsed).toBeLessThan(50 * 1024 * 1024);
		}, 30000);

		it("should clean up resources after disconnect", async () => {
			await adapter.createTable({
				name: "users",
				tableName: "users",
				fields: { name: { type: "string", required: true } },
			});

			const beforeDisconnect = process.memoryUsage().heapUsed;

			await adapter.disconnect();

			if (global.gc) global.gc();

			const afterDisconnect = process.memoryUsage().heapUsed;
			const memoryReleased = beforeDisconnect - afterDisconnect;

			expect(memoryReleased).toBeGreaterThanOrEqual(-1024 * 1024);
		});
	});

	describe("Query Performance", () => {
		it("should execute simple select query quickly", async () => {
			await adapter.createTable({
				name: "users",
				tableName: "users",
				fields: { name: { type: "string", required: true } },
			});
			await adapter.executeQuery({
				type: "insert",
				table: "users",
				data: [{ name: "Test" }],
			});

			const start = Date.now();

			for (let i = 0; i < 100; i++) {
				await adapter.executeQuery({ type: "select", table: "users" });
			}

			const duration = Date.now() - start;

			expect(duration).toBeLessThan(1000);
		});

		it("should handle large table scans efficiently", async () => {
			await adapter.createTable({
				name: "users",
				tableName: "users",
				fields: { name: { type: "string", required: true } },
			});

			for (let i = 0; i < 300; i++) {
				await adapter.executeQuery({
					type: "insert",
					table: "users",
					data: [{ name: `User${i}` }],
				});
			}

			const start = Date.now();

			const result = expectSuccessData(
				await adapter.executeQuery({ type: "select", table: "users" }),
			);

			const duration = Date.now() - start;

			expect(result.rows.length).toBeGreaterThanOrEqual(290);
			expect(duration).toBeLessThan(300);
		}, 45000);

		it("should execute filtered queries efficiently", async () => {
			await adapter.createTable({
				name: "users",
				tableName: "users",
				fields: {
					name: { type: "string", required: true },
					role: { type: "string", required: true },
				},
			});

			for (let i = 0; i < 200; i++) {
				await adapter.executeQuery({
					type: "insert",
					table: "users",
					data: [{ name: `User${i}`, role: i % 2 === 0 ? "admin" : "user" }],
				});
			}

			const start = Date.now();

			const result = expectSuccessData(
				await adapter.executeQuery({
					type: "select",
					table: "users",
					where: { role: "admin" },
				}),
			);

			const duration = Date.now() - start;

			expect(result.rows.length).toBeGreaterThanOrEqual(95);
			expect(duration).toBeLessThan(200);
		}, 30000);
	});

	describe("Write Performance", () => {
		it("should handle batch inserts efficiently", async () => {
			await adapter.createTable({
				name: "users",
				tableName: "users",
				fields: { name: { type: "string", required: true } },
			});

			const start = Date.now();

			for (let i = 0; i < 100; i++) {
				await adapter.executeQuery({
					type: "insert",
					table: "users",
					data: [{ name: `User${i}` }],
				});
			}

			const duration = Date.now() - start;

			expect(duration).toBeLessThan(2000);
		});

		it("should handle updates on large tables efficiently", async () => {
			await adapter.createTable({
				name: "users",
				tableName: "users",
				fields: {
					name: { type: "string", required: true },
					id: { type: "number" },
				},
			});

			for (let i = 0; i < 180; i++) {
				await adapter.executeQuery({
					type: "insert",
					table: "users",
					data: [{ name: `User${i}` }],
				});
			}

			const start = Date.now();

			await adapter.executeQuery({
				type: "update",
				table: "users",
				where: { id: 100 },
				data: { name: "UpdatedUser" },
			});

			const duration = Date.now() - start;

			expect(duration).toBeLessThan(200);
		}, 30000);

		it("should handle deletes efficiently", async () => {
			await adapter.createTable({
				name: "users",
				tableName: "users",
				fields: {
					name: { type: "string", required: true },
					id: { type: "number" },
				},
			});

			for (let i = 0; i < 200; i++) {
				await adapter.executeQuery({
					type: "insert",
					table: "users",
					data: [{ name: `User${i}` }],
				});
			}

			const start = Date.now();

			await adapter.executeQuery({
				type: "delete",
				table: "users",
				where: { id: 100 },
			});

			const duration = Date.now() - start;

			expect(duration).toBeLessThan(200);
		}, 30000);
	});

	describe("File Size Growth", () => {
		it("should maintain reasonable file sizes", async () => {
			await adapter.createTable({
				name: "users",
				tableName: "users",
				fields: { name: { type: "string", required: true } },
			});

			for (let i = 0; i < 100; i++) {
				await adapter.executeQuery({
					type: "insert",
					table: "users",
					data: [{ name: `User${i}` }],
				});
			}

			const filePath = path.join(root, "users.json");
			const stats = await fs.stat(filePath);

			expect(stats.size).toBeLessThan(50 * 1024);
		});

		it("should not create excessive temporary files", async () => {
			await adapter.createTable({
				name: "users",
				tableName: "users",
				fields: { name: { type: "string", required: true } },
			});

			for (let i = 0; i < 50; i++) {
				await adapter.executeQuery({
					type: "insert",
					table: "users",
					data: [{ name: `User${i}` }],
				});
			}

			const files = await fs.readdir(root);
			const jsonFiles = files.filter((f) => f.endsWith(".json"));

			expect(jsonFiles).toHaveLength(2); // users.json + _forja.json
		}, 15000);
	});

	describe("Stress Testing", () => {
		it("should handle rapid successive operations", async () => {
			await adapter.createTable({
				name: "users",
				tableName: "users",
				fields: { name: { type: "string", required: true } },
			});

			const operations = [];
			for (let i = 0; i < 50; i++) {
				operations.push(
					adapter.executeQuery({
						type: "insert",
						table: "users",
						data: [{ name: `User${i}` }],
					}),
				);
			}

			const results = await Promise.all(operations);

			const successCount = results.filter((r) => r.success).length;
			expect(successCount).toBeGreaterThan(20);
		}, 30000);

		it("should maintain performance under mixed workload", async () => {
			await adapter.createTable({
				name: "users",
				tableName: "users",
				fields: {
					name: { type: "string", required: true },
					id: { type: "number" },
				},
			});

			for (let i = 0; i < 30; i++) {
				await adapter.executeQuery({
					type: "insert",
					table: "users",
					data: [{ name: `Initial${i}` }],
				});
			}

			const start = Date.now();

			const operations = [];
			for (let i = 0; i < 30; i++) {
				operations.push(
					adapter.executeQuery({ type: "select", table: "users" }),
				);
				operations.push(
					adapter.executeQuery({
						type: "insert",
						table: "users",
						data: [{ name: `New${i}` }],
					}),
				);
				operations.push(
					adapter.executeQuery({
						type: "update",
						table: "users",
						where: { id: i + 1 },
						data: { name: `Updated${i}` },
					}),
				);
			}

			await Promise.all(operations);

			const duration = Date.now() - start;

			expect(duration).toBeLessThan(10000);
		}, 30000);
	});
});
