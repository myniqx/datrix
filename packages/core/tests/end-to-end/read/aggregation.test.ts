/**
 * Aggregation Tests (groupBy / having / distinct / countMany)
 *
 * Adapter Issue 13: mongodb/json silently ignored groupBy/having/distinct —
 * a count with groupBy returned the plain total, a select with distinct
 * returned duplicates. Now every adapter must either implement them
 * correctly or throw a clear "not supported" error (no silent wrong data).
 *
 * `findMany`'s `distinct`/`groupBy` return one row per distinct
 * group/combination (no aggregate columns beyond the grouped fields
 * themselves). `count` stays a single total and does NOT accept `groupBy` —
 * `countMany` is the dedicated API for "one count per group": it requires
 * `groupBy`, returns `(groupFields + count)[]`, and resolves to `[]` (never
 * a bare `0`) when nothing matches.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Datrix } from "@datrix/core";
import fs from "node:fs/promises";
import { createTestConfig, getTmpDir, setupTables } from "../setup";

describe("Aggregation (groupBy / having / distinct)", () => {
	let datrix: Datrix;
	const tmpDir = getTmpDir("aggregation");

	beforeAll(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
		await fs.mkdir(tmpDir, { recursive: true });

		const getDatrix = await createTestConfig(tmpDir);
		datrix = await getDatrix();

		await setupTables(datrix);

		// 5 active, 3 inactive — enough to distinguish "grouped" from "plain total"
		await datrix.createMany("user", [
			{ email: "agg-1@test.com", name: "Agg Active 1", age: 20, isActive: true },
			{ email: "agg-2@test.com", name: "Agg Active 2", age: 25, isActive: true },
			{ email: "agg-3@test.com", name: "Agg Active 3", age: 30, isActive: true },
			{ email: "agg-4@test.com", name: "Agg Active 4", age: 35, isActive: true },
			{ email: "agg-5@test.com", name: "Agg Active 5", age: 40, isActive: true },
			{ email: "agg-6@test.com", name: "Agg Inactive 1", age: 45, isActive: false },
			{ email: "agg-7@test.com", name: "Agg Inactive 2", age: 50, isActive: false },
			{ email: "agg-8@test.com", name: "Agg Inactive 3", age: 55, isActive: false },
		]);
	});

	afterAll(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	describe("groupBy", () => {
		it("returns one row per distinct group, not the flat row list", async () => {
			const groups = await datrix.findMany("user", {
				where: { email: { $startsWith: "agg-" } },
				select: ["isActive"],
				groupBy: ["isActive"],
			});

			// If groupBy were silently ignored, this would return 8 rows (one per
			// user) instead of 2 (one per distinct isActive value).
			expect(groups.length).toBe(2);
			const values = groups.map((g) => g["isActive"]).sort();
			expect(values).toEqual([false, true]);
		});

		it("throws when a selected field is not part of groupBy", async () => {
			await expect(
				datrix.findMany("user", {
					where: { email: { $startsWith: "agg-" } },
					select: ["isActive", "name"],
					groupBy: ["isActive"],
				}),
			).rejects.toThrow();
		});

		it("throws on a groupBy field that does not exist in the schema", async () => {
			await expect(
				datrix.findMany("user", {
					select: ["noSuchField"] as never,
					groupBy: ["noSuchField"] as never,
				}),
			).rejects.toThrow();
		});
	});

	describe("having", () => {
		it("filters groups after aggregation", async () => {
			// Both groups (true/false) exist; having narrows to just one.
			const groups = await datrix.findMany("user", {
				where: { email: { $startsWith: "agg-" } },
				select: ["isActive"],
				groupBy: ["isActive"],
				having: { isActive: true },
			});

			expect(groups.length).toBe(1);
			expect(groups[0]!["isActive"]).toBe(true);
		});

		it("returns zero groups when the having condition matches nothing", async () => {
			// No row in the fixture matches this prefix, so grouping its (empty)
			// result set must yield zero groups, not the two groups from the
			// full table.
			const empty = await datrix.findMany("user", {
				where: { email: { $startsWith: "no-such-prefix-" } },
				select: ["isActive"],
				groupBy: ["isActive"],
				having: { isActive: true },
			});
			expect(empty.length).toBe(0);
		});

		it("throws when having references a field outside groupBy", async () => {
			await expect(
				datrix.findMany("user", {
					where: { email: { $startsWith: "agg-" } },
					select: ["isActive"],
					groupBy: ["isActive"],
					having: { age: { $gt: 30 } } as never,
				}),
			).rejects.toThrow();
		});

	});

	describe("countMany", () => {
		it("returns one count per distinct group", async () => {
			const counts = await datrix.countMany("user", {
				where: { email: { $startsWith: "agg-" } },
				groupBy: ["isActive"],
			});

			expect(counts.length).toBe(2);
			const active = counts.find((c) => c["isActive"] === true);
			const inactive = counts.find((c) => c["isActive"] === false);
			expect(active?.count).toBe(5);
			expect(inactive?.count).toBe(3);
		});

		it("narrows to a single group's count via having", async () => {
			const counts = await datrix.countMany("user", {
				where: { email: { $startsWith: "agg-" } },
				groupBy: ["isActive"],
				having: { isActive: true },
			});

			expect(counts.length).toBe(1);
			expect(counts[0]!["isActive"]).toBe(true);
			expect(counts[0]!.count).toBe(5);
		});

		it("returns an empty array, never a bare 0, when nothing matches", async () => {
			const counts = await datrix.countMany("user", {
				where: { email: { $startsWith: "no-such-prefix-" } },
				groupBy: ["isActive"],
			});

			expect(counts).toEqual([]);
		});

		it("throws when having references a field outside groupBy", async () => {
			await expect(
				datrix.countMany("user", {
					where: { email: { $startsWith: "agg-" } },
					groupBy: ["isActive"],
					having: { age: { $gt: 30 } } as never,
				}),
			).rejects.toThrow();
		});

		// countMany without a groupBy is meaningless — it's just `count` — so
		// `groupBy` is a required field on RawCountManyOptions at the type
		// level. TypeScript blocks omitting it entirely, but a caller can still
		// bypass that at runtime (`groupBy: undefined!`, a JS caller with no
		// types at all, etc.) — this must fail loudly with a clear error, not
		// crash on an unrelated internals error (e.g. spreading `undefined`)
		// or silently behave like plain `count`.
		it("rejects a runtime call with groupBy missing, instead of crashing on an internal error", async () => {
			await expect(
				datrix.countMany("user", {
					where: { email: { $startsWith: "agg-" } },
					groupBy: undefined as unknown as string[],
				}),
			).rejects.toThrow();
		});
	});

	describe("distinct", () => {
		it("deduplicates rows without an explicit groupBy", async () => {
			const distinctValues = await datrix.findMany("user", {
				where: { email: { $startsWith: "agg-" } },
				select: ["isActive"],
				distinct: true,
			});

			// Without distinct this would return 8 rows (one per user).
			expect(distinctValues.length).toBe(2);
			const values = distinctValues.map((r) => r["isActive"]).sort();
			expect(values).toEqual([false, true]);
		});

		// countMany has no `distinct` option — groupBy already IS "distinct
		// combinations + a count per combination", so a separate distinct flag
		// would be redundant. This locks in that the option is absent from the
		// type, not silently ignored if someone adds it back without wiring it.
		it("does not accept a distinct option on countMany (compile-time only)", () => {
			const build = () =>
				datrix.countMany("user", {
					groupBy: ["isActive"],
					// @ts-expect-error countMany has no `distinct` option
					distinct: true,
				});
			expect(typeof build).toBe("function");
		});
	});
});
