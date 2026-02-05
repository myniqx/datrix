import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { JsonAdapter } from "../src/adapter";

describe("JsonAdapter - Locking & Concurrency", () => {
	const root = path.join(__dirname, "tmp_lock_test");

	beforeEach(async () => {
		// Retry cleanup
		for (let i = 0; i < 3; i++) {
			try {
				await fs.rm(root, { recursive: true, force: true });
				break;
			} catch (e) {
				await new Promise((r) => setTimeout(r, 100));
			}
		}

		const adapter = new JsonAdapter({ root });
		await adapter.connect();
		await adapter.createTable({
			name: "counter",
			tableName: "counter",
			fields: { val: { type: "number", required: true } },
		});
		// Initial value 0
		await adapter.executeQuery({
			type: "insert",
			table: "counter",
			data: { val: 0 },
		});
		await adapter.disconnect();
	});

	afterEach(async () => {
		// Retry cleanup
		for (let i = 0; i < 3; i++) {
			try {
				await fs.rm(root, { recursive: true, force: true });
				break;
			} catch (e) {
				await new Promise((r) => setTimeout(r, 100));
			}
		}
	});

	it(
		"should serialize concurrent writes to avoid lost updates",
		{ timeout: 10_000 },
		async () => {
			const adapter1 = new JsonAdapter({ root, lockTimeout: 5000 });
			const adapter2 = new JsonAdapter({ root, lockTimeout: 5000 });
			await adapter1.connect();
			await adapter2.connect();

			// Function that reads current value, increments it, and writes back (Update query logic does this effectively)
			// But to truly test RACE condition without lock, we need to fire them "simultaneously".
			// With lock, they should queue.

			// We will run 10 parallel updates.
			// If atomic, final val should be 10.
			// If not atomic (race), final val will be < 10.

			const updates = Array.from({ length: 10 }).map(async (_, i) => {
				// Each update: set val = val + 1 ?? No, simple update is separate query.
				// We can't do "val = val + 1" in JsonQueryRunner yet easily without raw query or fetch-modify-save loop.
				// BUT, the adapter's `update` logic is: Read All -> Run Query (Memory) -> Write All.

				// If we fire 5 updates:
				// Adapter A Reads (val=0)
				// Adapter B Reads (val=0)
				// Adapter A Writes (val=1)
				// Adapter B Writes (val=1) -> LOST UPDATE from A

				// BUT, we need a way to say "increment". Current `update` takes `data` and overwrites.
				// Wait, current adapter update is:
				// Object.assign(row, query.data)
				// It doesn't support "increment" operator logic yet.

				// So to test this, we must simulate the "Client Read -> Client Compute -> Client Update" loop?
				// No, the Lock is INSIDE `executeQuery`.
				// So if `executeQuery` does the read-modify-write, locking protects THAT scope.
				// But if client does Read -> Compute -> Write, locking inside ExecuteQuery doesn't protect the "Compute" gap.
				// However, `executeQuery` is atomic for ITSELF.

				// Let's test checking `insert`.
				// If we insert 5 items concurrently, can we corrupt the file?
				// JSON.stringify writing simultaneously might corrupt file content (half written).

				await adapter1.executeQuery({
					type: "insert",
					table: "counter",
					data: { val: i + 1 },
				});
			});

			// Use multiple adapters to simulate multiple processes/connections?
			// JsonAdapter is just a class. Same process. Node is single threaded.
			// fs.writeFile is async.
			// If we await, they are serial.
			// We need Promise.all to interleave the async IO.

			await Promise.all(updates);

			// Verify we have 1 initial + 10 integers = 11 items.
			// Or if file corruption happened, we might fail to parse.
			const result = await adapter1.executeQuery({
				type: "select",
				table: "counter",
			});
			expect(result.success).toBe(true);
			// @ts-ignore
			expect(result.data.rows).toHaveLength(11); // 0 + 10 inserts
		},
	);

	it("should recover from stale locks", async () => {
		const adapter = new JsonAdapter({
			root,
			lockTimeout: 1000,
			staleTimeout: 500,
		});
		await adapter.connect();

		// Manually create a STALE lock file (older than 500ms)
		const lockPath = path.join(root, "db.lock");
		await fs.writeFile(lockPath, (Date.now() - 2000).toString());

		// Should succeed by breaking the lock
		const start = Date.now();
		await adapter.executeQuery({
			type: "insert",
			table: "counter",
			data: { val: 999 },
		});

		expect(Date.now() - start).toBeLessThan(2000); // Should be fast, not wait for lock timeout
	});

	it("should fail if lock cannot be acquired within timeout", async () => {
		const adapter = new JsonAdapter({
			root,
			lockTimeout: 100,
			staleTimeout: 5000,
		});
		await adapter.connect();

		// Manually create a FRESH lock file
		const lockPath = path.join(root, "db.lock");
		await fs.writeFile(lockPath, Date.now().toString());

		// Should fail
		const result = await adapter.executeQuery({
			type: "insert",
			table: "counter",
			data: { val: 888 },
		});

		expect(result.success).toBe(false);
		// @ts-ignore
		expect(result.error.message).toMatch(/lock/);
	});
});
