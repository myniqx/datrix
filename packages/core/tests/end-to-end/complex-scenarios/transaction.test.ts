/**
 * datrix.transaction() Tests
 *
 * Covers:
 * - commit on resolve, rollback on throw
 * - reads inside the transaction see its own writes
 * - tx.rollback() rejects with DatrixTransactionRollbackError
 * - a failed operation aborts the transaction even if the error is caught
 * - tx is unusable after the transaction finishes
 * - afterCommit: runs after commit in order, dropped on rollback, errors
 *   reported to the transaction option and plugin onAfterCommitError
 * - hooks: context.crud joins the transaction, context.afterCommit defers
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
	BasePlugin,
	Datrix,
	DatrixTransactionRollbackError,
	defineConfig,
	defineSchema,
} from "@datrix/core";
import type {
	DatrixEntry,
	DatrixTransaction,
	PluginContext,
} from "@datrix/core";
import fs from "node:fs/promises";
import {
	createTestConfig,
	getAdapter,
	getAdapterType,
	getTmpDir,
	setupTables,
} from "../setup";

describe("datrix.transaction()", () => {
	let datrix: Datrix;
	const tmpDir = getTmpDir("transaction");

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

	const countByPrefix = (prefix: string) =>
		datrix.count("user", { email: { $startsWith: prefix } });

	describe("commit / rollback", () => {
		it("commits every operation and returns the callback value", async () => {
			const result = await datrix.transaction(async (tx) => {
				const a = await tx.create("user", {
					email: "tx-commit-a@test.com",
					name: "Commit A",
				});
				await tx.create("user", {
					email: "tx-commit-b@test.com",
					name: "Commit B",
				});
				await tx.update("user", a.id, { name: "Commit A2" });
				await tx.deleteMany("user", { email: "tx-commit-b@test.com" });
				return a.id;
			});

			const a = await datrix.findById("user", result);
			expect(a?.["name"]).toBe("Commit A2");
			expect(await countByPrefix("tx-commit-")).toBe(1);
		});

		it("rolls back every operation when the callback throws", async () => {
			const existing = await datrix.create("user", {
				email: "tx-throw-existing@test.com",
				name: "Existing",
			});

			await expect(
				datrix.transaction(async (tx) => {
					await tx.create("user", {
						email: "tx-throw-new@test.com",
						name: "New",
					});
					await tx.update("user", existing.id, { name: "Changed" });
					await tx.delete("user", existing.id);
					throw new Error("boom");
				}),
			).rejects.toThrow("boom");

			const after = await datrix.findById("user", existing.id);
			expect(after?.["name"]).toBe("Existing");
			expect(await countByPrefix("tx-throw-")).toBe(1);
		});

		it("reads inside the transaction see its own uncommitted writes", async () => {
			await datrix.transaction(async (tx) => {
				await tx.createMany("user", [
					{ email: "tx-read-1@test.com", name: "Read 1" },
					{ email: "tx-read-2@test.com", name: "Read 2" },
				]);

				const rows = await tx.findMany("user", {
					where: { email: { $startsWith: "tx-read-" } },
				});
				expect(rows).toHaveLength(2);
				expect(
					await tx.count("user", { email: { $startsWith: "tx-read-" } }),
				).toBe(2);
			});
		});

		it("tx.rollback() rejects with DatrixTransactionRollbackError", async () => {
			const promise = datrix.transaction(async (tx) => {
				await tx.create("user", {
					email: "tx-manual@test.com",
					name: "Manual",
				});
				tx.rollback();
			});

			await expect(promise).rejects.toBeInstanceOf(
				DatrixTransactionRollbackError,
			);
			expect(await countByPrefix("tx-manual")).toBe(0);
		});

		it("tx.rollback() still rolls back when its error is caught", async () => {
			await expect(
				datrix.transaction(async (tx) => {
					await tx.create("user", {
						email: "tx-manual-caught@test.com",
						name: "Manual Caught",
					});
					try {
						tx.rollback();
					} catch {
						// swallowed on purpose
					}
				}),
			).rejects.toBeInstanceOf(DatrixTransactionRollbackError);

			expect(await countByPrefix("tx-manual-caught")).toBe(0);
		});
	});

	describe("failed operations", () => {
		it("a caught operation error still rolls the transaction back", async () => {
			await expect(
				datrix.transaction(async (tx) => {
					await tx.create("user", {
						email: "tx-swallow-ok@test.com",
						name: "Swallow OK",
					});
					try {
						await tx.create("user", {
							email: "tx-swallow-bad@test.com",
							name: "x",
						});
					} catch {
						// swallowed on purpose
					}
				}),
			).rejects.toThrow();

			expect(await countByPrefix("tx-swallow-")).toBe(0);
		});

		it("operations after a failed one are rejected as aborted", async () => {
			let abortedError: unknown;

			await expect(
				datrix.transaction(async (tx) => {
					try {
						await tx.create("user", {
							email: "tx-abort-bad@test.com",
							name: "x",
						});
					} catch {
						// swallowed on purpose
					}
					try {
						await tx.create("user", {
							email: "tx-abort-next@test.com",
							name: "Next",
						});
					} catch (error) {
						abortedError = error;
						throw error;
					}
				}),
			).rejects.toThrow();

			expect(abortedError).toMatchObject({ code: "TRANSACTION_ABORTED" });
			expect(await countByPrefix("tx-abort-")).toBe(0);
		});

		it("tx cannot be used after the transaction finished", async () => {
			let leaked = null as DatrixTransaction | null;

			await datrix.transaction(async (tx) => {
				leaked = tx;
			});

			await expect(
				leaked!.create("user", { email: "tx-leak@test.com", name: "Leak" }),
			).rejects.toMatchObject({ code: "TRANSACTION_CLOSED" });
			expect(() => leaked!.afterCommit(() => {})).toThrow();
		});
	});

	describe("afterCommit", () => {
		it("runs callbacks after commit, in registration order", async () => {
			const calls: string[] = [];

			await datrix.transaction(async (tx) => {
				tx.afterCommit(() => {
					calls.push("first");
				});
				await tx.create("user", {
					email: "tx-after-1@test.com",
					name: "After 1",
				});
				tx.afterCommit(async () => {
					calls.push(`second:${await countByPrefix("tx-after-")}`);
				});
				calls.push("callback-end");
			});

			expect(calls).toEqual(["callback-end", "first", "second:1"]);
		});

		it("drops callbacks on rollback", async () => {
			const calls: string[] = [];

			await expect(
				datrix.transaction(async (tx) => {
					tx.afterCommit(() => {
						calls.push("should-not-run");
					});
					throw new Error("rollback");
				}),
			).rejects.toThrow("rollback");

			expect(calls).toEqual([]);
		});

		it("callback errors do not fail the transaction and reach onAfterCommitError", async () => {
			const reported: unknown[] = [];
			const calls: string[] = [];

			const result = await datrix.transaction(
				async (tx) => {
					await tx.create("user", {
						email: "tx-after-err@test.com",
						name: "After Err",
					});
					tx.afterCommit(() => {
						throw new Error("side effect failed");
					});
					tx.afterCommit(() => {
						calls.push("still-runs");
					});
					return "done";
				},
				{ onAfterCommitError: (error) => void reported.push(error) },
			);

			expect(result).toBe("done");
			expect(calls).toEqual(["still-runs"]);
			expect(reported).toHaveLength(1);
			expect((reported[0] as Error).message).toBe("side effect failed");
			expect(await countByPrefix("tx-after-err")).toBe(1);
		});
	});
});

// ============================================================================
// Hooks and plugins inside a transaction
// ============================================================================

interface TxItem extends DatrixEntry {
	name: string;
}

describe("datrix.transaction() with hooks and plugins", () => {
	let datrix: Datrix;
	const tmpDir = getTmpDir("transaction_hooks");
	const hookAfterCommit: string[] = [];
	const pluginErrors: unknown[] = [];

	class AfterCommitErrorPlugin extends BasePlugin<Record<string, never>> {
		readonly name = "after-commit-error-plugin";
		readonly version = "1.0.0";
		async init(ctx: PluginContext): Promise<void> {
			this.context = ctx;
		}
		async destroy(): Promise<void> {}
		override async onAfterCommitError(error: unknown): Promise<void> {
			pluginErrors.push(error);
		}
	}

	beforeAll(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
		await fs.mkdir(tmpDir, { recursive: true });

		const itemSchema = defineSchema({
			name: "txItem",
			fields: {
				name: { type: "string", required: true },
			},
			hooks: {
				afterCreate: async (records: TxItem[], context) => {
					for (const record of records) {
						await context.crud.create("txAudit", { itemName: record.name });
						context.afterCommit(() => {
							if (record.name === "explode") {
								throw new Error("hook side effect failed");
							}
							hookAfterCommit.push(record.name);
						});
					}
					return records;
				},
			},
		});
		const auditSchema = defineSchema({
			name: "txAudit",
			fields: {
				itemName: { type: "string", required: true },
			},
		});

		const adapter = await getAdapter(getAdapterType(), tmpDir);
		const getDatrix = defineConfig(() => ({
			adapter,
			schemas: [itemSchema, auditSchema],
			plugins: [new AfterCommitErrorPlugin({})],
		}));
		datrix = await getDatrix();
		const migration = await datrix.beginMigrate();
		await migration.apply();
	});

	afterAll(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	it("context.crud writes inside a hook roll back with the transaction", async () => {
		await expect(
			datrix.transaction(async (tx) => {
				await tx.create("txItem", { name: "hook-rollback" });
				expect(await tx.count("txAudit", { itemName: "hook-rollback" })).toBe(
					1,
				);
				throw new Error("rollback");
			}),
		).rejects.toThrow("rollback");

		expect(await datrix.count("txItem", { name: "hook-rollback" })).toBe(0);
		expect(await datrix.count("txAudit", { itemName: "hook-rollback" })).toBe(
			0,
		);
		expect(hookAfterCommit).not.toContain("hook-rollback");
	});

	it("context.afterCommit inside a transaction waits for the commit", async () => {
		await datrix.transaction(async (tx) => {
			await tx.create("txItem", { name: "hook-commit" });
			expect(hookAfterCommit).not.toContain("hook-commit");
		});

		expect(hookAfterCommit).toContain("hook-commit");
		expect(await datrix.count("txAudit", { itemName: "hook-commit" })).toBe(1);
	});

	it("context.afterCommit outside a transaction runs once the operation commits", async () => {
		await datrix.create("txItem", { name: "hook-standalone" });

		expect(hookAfterCommit).toContain("hook-standalone");
	});

	it("tx.raw skips hooks but stays inside the transaction", async () => {
		await expect(
			datrix.transaction(async (tx) => {
				await tx.raw.create("txItem", { name: "raw-item" });
				throw new Error("rollback");
			}),
		).rejects.toThrow("rollback");

		expect(await datrix.count("txItem", { name: "raw-item" })).toBe(0);
		expect(await datrix.count("txAudit", { itemName: "raw-item" })).toBe(0);
	});

	it("afterCommit errors reach plugin onAfterCommitError and the transaction option", async () => {
		const optionErrors: unknown[] = [];

		await datrix.transaction(
			async (tx) => {
				await tx.create("txItem", { name: "explode" });
			},
			{ onAfterCommitError: (error) => void optionErrors.push(error) },
		);

		expect(pluginErrors).toHaveLength(1);
		expect(optionErrors).toHaveLength(1);
		expect((optionErrors[0] as Error).message).toBe("hook side effect failed");
		expect(await datrix.count("txItem", { name: "explode" })).toBe(1);
	});
});
