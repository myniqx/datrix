/**
 * Issue Regression Tests
 *
 * Covers the defects documented in packages/core/issue.md and each
 * packages/adapter-* /issue.md. Every test triggers a query shape that
 * previously produced silently-wrong results (or a crash) in at least one
 * adapter. Since the e2e suite runs once per adapter, a single test here
 * covers the same defect across all adapters.
 *
 * Issue references are noted per describe/it block:
 *   core X.Y  -> packages/core/issue.md
 *   pg AX/PY  -> packages/adapter-postgres-core/issue.md
 *   my AX/PY  -> packages/adapter-mysql/issue.md
 *   mg AX/PY  -> packages/adapter-mongodb/issue.md
 *   js AX/PY  -> packages/adapter-json/issue.md
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Datrix } from "@datrix/core";
import fs from "node:fs/promises";
import { createTestConfig, getTmpDir, setupTables } from "../setup";

describe("Issue Regressions", () => {
	let datrix: Datrix;
	const tmpDir = getTmpDir("issue-regressions");

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

	// ==========================================================================
	// WHERE operator semantics
	// pg A1/A2, my A1/A2/Part6, mg A1/A2/A3, js A1/A2
	// ==========================================================================
	describe("where operator semantics", () => {
		beforeAll(async () => {
			await datrix.createMany("user", [
				{ email: "op-cs1@test.com", name: "OpSensitive Alpha", age: 31 },
				{ email: "op-cs2@test.com", name: "opsensitive beta", age: 32 },
				{ email: "op-wc1@test.com", name: "OpWild 50%_off deal", age: 33 },
				{ email: "op-wc2@test.com", name: "OpWild 50XoffYdeal", age: 34 },
				{ email: "op-se1@test.com", name: "OpAnchorz", age: 35 },
				{ email: "op-se2@test.com", name: "OpAmber", age: 36 },
				{ email: "op-se3@test.com", name: "OpBlitz", age: 37 },
				{
					email: "op-null1@test.com",
					name: "OpNull HasLast",
					lastName: "Present",
					age: 38,
				},
				{ email: "op-null2@test.com", name: "OpNull NoLast", age: 39 },
			]);
		});

		// pg A1, my Part6, mg A1, js A1 — $contains must be case-SENSITIVE
		it("$contains is case-sensitive", async () => {
			const results = await datrix.findMany("user", {
				where: { name: { $contains: "OpSensitive" } },
			});

			expect(results.length).toBe(1);
			expect(results[0]!["name"]).toBe("OpSensitive Alpha");
		});

		// pg A1, my A1, mg A1, js A1 — $icontains must exist and be case-INsensitive
		it("$icontains is case-insensitive", async () => {
			const results = await datrix.findMany("user", {
				where: { name: { $icontains: "opsensitive" } },
			});

			expect(results.length).toBe(2);
		});

		// pg A1, mg A1 — $notContains must be case-sensitive
		it("$notContains is case-sensitive", async () => {
			const results = await datrix.findMany("user", {
				where: {
					email: { $startsWith: "op-cs" },
					name: { $notContains: "OpSensitive" },
				},
			});

			// only the lowercase variant survives the NOT filter
			expect(results.length).toBe(1);
			expect(results[0]!["name"]).toBe("opsensitive beta");
		});

		// pg A2, my A2, js A2 — %/_ in the user value must be escaped, not act as wildcards
		it("$contains escapes LIKE metacharacters (% and _)", async () => {
			const results = await datrix.findMany("user", {
				where: { name: { $contains: "50%_off" } },
			});

			// unescaped, "%50%_off%" would also match "OpWild 50XoffYdeal"
			expect(results.length).toBe(1);
			expect(results[0]!["name"]).toBe("OpWild 50%_off deal");
		});

		// mg A3 — multiple pattern operators on one field must AND, not overwrite
		it("$startsWith and $endsWith on the same field combine with AND", async () => {
			const results = await datrix.findMany("user", {
				where: { name: { $startsWith: "OpA", $endsWith: "z" } },
			});

			// OpAmber starts right but ends wrong; OpBlitz ends right but starts wrong
			expect(results.length).toBe(1);
			expect(results[0]!["name"]).toBe("OpAnchorz");
		});

		// contract §4 — multiple comparison operators AND on one field
		it("combines $gte and $lt on the same field", async () => {
			const results = await datrix.findMany("user", {
				where: {
					email: { $startsWith: "op-" },
					age: { $gte: 33, $lt: 36 },
				},
			});

			expect(results.length).toBe(3);
			for (const user of results) {
				const age = user["age"] as number;
				expect(age).toBeGreaterThanOrEqual(33);
				expect(age).toBeLessThan(36);
			}
		});

		// mg A2 — NULL semantics: applyDefaults stores explicit null; $notNull must
		// NOT match null-valued fields
		it("$null / $notNull have IS NULL / IS NOT NULL semantics", async () => {
			const withLast = await datrix.findMany("user", {
				where: { name: { $startsWith: "OpNull" }, lastName: { $notNull: true } },
			});
			expect(withLast.length).toBe(1);
			expect(withLast[0]!["name"]).toBe("OpNull HasLast");

			const withoutLast = await datrix.findMany("user", {
				where: { name: { $startsWith: "OpNull" }, lastName: { $null: true } },
			});
			expect(withoutLast.length).toBe(1);
			expect(withoutLast[0]!["name"]).toBe("OpNull NoLast");
		});

		// js A1 — unknown operators must throw, never match-everything
		it("throws on an unknown operator", async () => {
			await expect(
				datrix.findMany("user", {
					where: { name: { $bogusOperator: "x" } } as never,
				}),
			).rejects.toThrow();
		});

		// js A1, my Part6 — $regex must be implemented and anchored patterns work
		it("$regex matches with an anchored pattern", async () => {
			const results = await datrix.findMany("user", {
				where: { name: { $regex: "^OpWild " } },
			});

			expect(results.length).toBe(2);
		});
	});

	// ==========================================================================
	// orderBy / select interactions
	// js A3, pg A7, my A8, core 1.4
	// ==========================================================================
	describe("orderBy validation and interactions", () => {
		beforeAll(async () => {
			await datrix.createMany("user", [
				{ email: "ord-1@test.com", name: "Ord Young", age: 20 },
				{ email: "ord-2@test.com", name: "Ord Middle", age: 40 },
				{ email: "ord-3@test.com", name: "Ord Old", age: 60 },
			]);
		});

		// js A3 — sort must run before projection
		it("orders by a field that is not in the select list", async () => {
			const results = await datrix.findMany("user", {
				where: { email: { $startsWith: "ord-" } },
				select: ["id", "name"],
				orderBy: [{ field: "age", direction: "desc" }],
			});

			expect(results.map((r) => r["name"])).toEqual([
				"Ord Old",
				"Ord Middle",
				"Ord Young",
			]);
		});

		// pg A7, my A8 — orderBy columns must be table-qualified when populate joins
		// add tables that share column names (createdAt/id exist everywhere)
		it("orders by createdAt while populating a relation (no ambiguous column)", async () => {
			const author = await datrix.create("user", {
				email: "ord-author@test.com",
				name: "Ord Author",
			});
			await datrix.create("post", {
				title: "Ord Post",
				content: "c",
				slug: "ord-post",
				author: author.id,
			});

			const results = await datrix.findMany("post", {
				where: { slug: "ord-post" },
				orderBy: [{ field: "createdAt", direction: "asc" }],
				populate: { author: true },
			});

			expect(results.length).toBe(1);
			expect((results[0]!["author"] as { id: number }).id).toBe(author.id);
		});

		// core 1.4 — orderBy field names are SQL identifiers; must be validated
		it("throws on an orderBy field that does not exist in the schema", async () => {
			await expect(
				datrix.findMany("user", {
					orderBy: [{ field: "noSuchColumn", direction: "asc" }] as never,
				}),
			).rejects.toThrow();
		});
	});

	// ==========================================================================
	// COUNT + nested relation WHERE
	// pg A8, my A7 — LEFT JOINs must not multiply the count
	// ==========================================================================
	describe("count with relation where", () => {
		it("does not overcount when a hasMany relation condition joins rows", async () => {
			const author = await datrix.create("user", {
				email: "cnt-author@test.com",
				name: "Cnt Author",
			});
			const post = await datrix.create("post", {
				title: "Cnt Post",
				content: "c",
				slug: "cnt-post",
				author: author.id,
			});
			// 3 approved comments on ONE post: a joined count would report 3
			for (let i = 1; i <= 3; i++) {
				await datrix.create("comment", {
					content: `cnt-comment-${i}`,
					isApproved: true,
					post: post.id,
				});
			}

			const count = await datrix.count("post", {
				slug: { $startsWith: "cnt-" },
				comments: { isApproved: true },
			});
			expect(count).toBe(1);

			// the select path must also deduplicate (SELECT DISTINCT)
			const rows = await datrix.findMany("post", {
				where: {
					slug: { $startsWith: "cnt-" },
					comments: { isApproved: true },
				},
			});
			expect(rows.length).toBe(1);
		});
	});

	// ==========================================================================
	// DELETE / UPDATE result rows and relation-WHERE semantics
	// mg A9, mg A11, pg Part4, my A9
	// ==========================================================================
	describe("delete/update returning and relation-where", () => {
		// mg A9 — delete must return the deleted rows
		it("deleteMany returns the deleted rows", async () => {
			await datrix.createMany("tag", [
				{ name: "del-ret-1" },
				{ name: "del-ret-2" },
			]);

			const deleted = await datrix.deleteMany("tag", {
				name: { $startsWith: "del-ret-" },
			});

			expect(deleted.length).toBe(2);
			for (const row of deleted) {
				expect(row["id"]).toBeDefined();
			}
		});

		// pg Part4 — $or of a scalar branch and a relation branch: rows whose FK is
		// NULL must still match the scalar branch (inner-join conversion loses them)
		it("updateMany matches NULL-FK rows via the scalar branch of $or", async () => {
			const author = await datrix.create("user", {
				email: "orfk-author@test.com",
				name: "OrFk Author",
			});
			// post 1: no author, unpublished -> matches scalar branch only
			await datrix.create("post", {
				title: "OrFk NoAuthor",
				content: "c",
				slug: "orfk-noauthor",
				isPublished: false,
			});
			// post 2: has the author, published -> matches relation branch only
			await datrix.create("post", {
				title: "OrFk Authored",
				content: "c",
				slug: "orfk-authored",
				isPublished: true,
				author: author.id,
			});

			const updated = await datrix.updateMany(
				"post",
				{
					slug: { $startsWith: "orfk-" },
					$or: [{ isPublished: false }, { author: { name: "OrFk Author" } }],
				},
				{ viewCount: 777 },
			);

			expect(updated.length).toBe(2);

			const check = await datrix.findMany("post", {
				where: { slug: { $startsWith: "orfk-" }, viewCount: 777 },
			});
			expect(check.length).toBe(2);
		});

		// mg A11 — an `id` condition and a relation-derived id constraint must both
		// apply (merge, not overwrite)
		it("combines an explicit id condition with a relation condition", async () => {
			const postA = await datrix.create("post", {
				title: "IdMerge A",
				content: "c",
				slug: "idmerge-a",
			});
			const postB = await datrix.create("post", {
				title: "IdMerge B",
				content: "c",
				slug: "idmerge-b",
			});
			for (const p of [postA, postB]) {
				await datrix.create("comment", {
					content: `idmerge-comment-${p.id}`,
					isApproved: true,
					post: p.id,
				});
			}

			const results = await datrix.findMany("post", {
				where: {
					id: { $gt: postA.id },
					comments: { isApproved: true },
					slug: { $startsWith: "idmerge-" },
				},
			});

			// dropping either condition would return 2 rows (or the wrong row)
			expect(results.length).toBe(1);
			expect(results[0]!["id"]).toBe(postB.id);
		});
	});

	// ==========================================================================
	// Populate behavior
	// core 1.9/1.10/1.11, pg Part2/Part3/Part5, my Part3/Part4/Part5/A3,
	// mg A6/A7/A8/A10/Part3/Part4, js A4/Part1/Part2
	// ==========================================================================
	describe("populate", () => {
		let ppAuthorId: number;
		let ppPostIds: number[] = [];

		beforeAll(async () => {
			const author = await datrix.create("user", {
				email: "pp-author@test.com",
				name: "PP Author",
			});
			ppAuthorId = author.id;

			// 3 posts x 5 comments for per-parent windowing tests
			ppPostIds = [];
			for (let p = 1; p <= 3; p++) {
				const post = await datrix.create("post", {
					title: `PP Post ${p}`,
					content: "c",
					slug: `pp-limit-${p}`,
					author: author.id,
				});
				ppPostIds.push(post.id);
				for (let c = 1; c <= 5; c++) {
					await datrix.create("comment", {
						content: `pp-limit-${p}-c${c}`,
						post: post.id,
					});
				}
			}
		});

		// core 1.9 — populate: { rel: false } must NOT populate
		it("populate: { relation: false } does not populate the relation", async () => {
			const post = await datrix.findById("post", ppPostIds[0]!, {
				populate: { author: false } as never,
			});

			expect(post).toBeDefined();
			const author = post!["author"];
			expect(
				author === undefined || author === null || typeof author === "number",
			).toBe(true);
		});

		// pg Part2, my Part3, mg Part3 — limit/offset must apply PER PARENT
		it("applies populate limit per parent row, not globally", async () => {
			const posts = await datrix.findMany("post", {
				where: { slug: { $startsWith: "pp-limit-" } },
				populate: {
					comments: {
						limit: 2,
						orderBy: [{ field: "content", direction: "asc" }],
					},
				},
			});

			expect(posts.length).toBe(3);
			for (const post of posts) {
				const slug = post["slug"] as string;
				const comments = post["comments"] as { content: string }[];
				// a global LIMIT 2 would starve two of the three posts entirely
				expect(comments.length).toBe(2);
				expect(comments[0]!.content).toBe(`${slug}-c1`);
				expect(comments[1]!.content).toBe(`${slug}-c2`);
			}
		});

		// pg Part2, my Part3, mg Part3 — same guarantee for offset
		it("applies populate offset per parent row", async () => {
			const posts = await datrix.findMany("post", {
				where: { slug: { $startsWith: "pp-limit-" } },
				populate: {
					comments: {
						offset: 3,
						orderBy: [{ field: "content", direction: "asc" }],
					},
				},
			});

			expect(posts.length).toBe(3);
			for (const post of posts) {
				const slug = post["slug"] as string;
				const comments = post["comments"] as { content: string }[];
				expect(comments.map((c) => c.content).sort()).toEqual([
					`${slug}-c4`,
					`${slug}-c5`,
				]);
			}
		});

		// mg Part3 — depth >= 2 flips to the batched strategy which had global limits
		it("applies populate limit per parent at nested depth 2", async () => {
			const users = await datrix.findMany("user", {
				where: { email: "pp-author@test.com" },
				populate: {
					posts: {
						populate: {
							comments: {
								limit: 2,
								orderBy: [{ field: "content", direction: "asc" }],
							},
						},
					},
				},
			});

			expect(users.length).toBe(1);
			const posts = users[0]!["posts"] as {
				slug: string;
				comments: { content: string }[];
			}[];
			expect(posts.length).toBe(3);
			for (const post of posts) {
				expect(post.comments.length).toBe(2);
				expect(post.comments[0]!.content).toBe(`${post.slug}-c1`);
			}
		});

		// pg Part5, my Part4 — belongsTo populate where: "populate only if the
		// target matches, else null" — must not be silently ignored
		it("applies populate-level where on a belongsTo relation", async () => {
			const posts = await datrix.findMany("post", {
				where: { slug: "pp-limit-1" },
				populate: { author: { where: { name: "PP Author" } } },
			});
			expect((posts[0]!["author"] as { id: number }).id).toBe(ppAuthorId);

			const noMatch = await datrix.findMany("post", {
				where: { slug: "pp-limit-1" },
				populate: { author: { where: { name: "Somebody Else" } } },
			});
			expect(noMatch[0]!["author"]).toBeNull();
		});

		// js A4 — hasOne populate must honor its where option too
		it("applies populate-level where on a hasOne relation", async () => {
			const cat = await datrix.create("category", {
				name: "PP HasOne Cat",
				slug: "pp-hasone-cat",
			});
			const user = await datrix.create("user", {
				email: "pp-hasone@test.com",
				name: "PP HasOne User",
				favoriteCategory: cat.id,
			});

			const match = await datrix.findById("user", user.id, {
				populate: { favoriteCategory: { where: { name: "PP HasOne Cat" } } },
			});
			expect((match!["favoriteCategory"] as { id: number }).id).toBe(cat.id);

			const noMatch = await datrix.findById("user", user.id, {
				populate: { favoriteCategory: { where: { name: "Wrong Name" } } },
			});
			expect(noMatch!["favoriteCategory"]).toBeNull();
		});

		// my A3 — populate orderBy with nulls option must not emit invalid SQL
		it("populate orderBy with nulls option does not crash", async () => {
			const posts = await datrix.findMany("post", {
				where: { slug: { $startsWith: "pp-limit-" } },
				populate: {
					comments: {
						orderBy: [{ field: "content", direction: "desc", nulls: "last" }],
					},
				},
			});

			expect(posts.length).toBe(3);
			for (const post of posts) {
				const comments = post["comments"] as { content: string }[];
				expect(comments.length).toBe(5);
			}
		});

		// pg Part3, my Part5, js Part1 — date fields must come back as Date objects,
		// both on main rows and inside populated relations (row_to_json/JSON_OBJECT
		// paths return ISO strings without conversion)
		it("returns Date objects for date fields on main and populated rows", async () => {
			const posts = await datrix.findMany("post", {
				where: { slug: "pp-limit-1" },
				populate: { author: true },
			});

			const post = posts[0]!;
			expect(post["createdAt"]).toBeInstanceOf(Date);
			const author = post["author"] as { createdAt: unknown };
			expect(author.createdAt).toBeInstanceOf(Date);
		});

		// js Part1 — date range queries must work regardless of storage format
		it("supports date range queries on createdAt", async () => {
			const dayMs = 24 * 60 * 60 * 1000;
			const results = await datrix.findMany("post", {
				where: {
					slug: { $startsWith: "pp-limit-" },
					createdAt: {
						$gte: new Date(Date.now() - dayMs),
						$lte: new Date(Date.now() + dayMs),
					},
				},
			});

			expect(results.length).toBe(3);
		});

		// mg A10 — limit: 0 must return an empty result, with and without populate
		it("limit: 0 returns no rows, also with populate", async () => {
			const plain = await datrix.findMany("post", {
				where: { slug: { $startsWith: "pp-limit-" } },
				limit: 0,
			});
			expect(plain.length).toBe(0);

			const populated = await datrix.findMany("post", {
				where: { slug: { $startsWith: "pp-limit-" } },
				limit: 0,
				populate: { comments: true },
			});
			expect(populated.length).toBe(0);
		});

		// core 2.2, pg Part1, my Part8, mg A6/A7 — post-write refetch with populate:
		// scalar fields must survive and hidden FK columns must not leak
		it("create with populate returns scalar fields and hides FK columns", async () => {
			const created = await datrix.create(
				"post",
				{
					title: "Refetch Post",
					content: "refetch content",
					slug: "refetch-post",
					author: ppAuthorId,
				},
				{ populate: { author: true } },
			);

			// mg A7: inclusion-projection bug stripped all scalar columns
			expect(created["title"]).toBe("Refetch Post");
			expect(created["content"]).toBe("refetch content");
			expect((created["author"] as { id: number }).id).toBe(ppAuthorId);
			// mg A6: hidden FK column must not leak into the row
			expect(created["authorId"]).toBeUndefined();
		});

		// core 1.10 — dot-notation populate must respect the depth limit
		it("throws when a dot-notation populate path exceeds the depth limit", async () => {
			const deepPath = Array(12).fill("parent").join(".");

			await expect(
				datrix.findMany("category", {
					populate: [deepPath] as never,
				}),
			).rejects.toThrow();
		});

		// core 1.11 — populate-level where must be validated against target schema
		it("throws on a populate-level where with an unknown field", async () => {
			await expect(
				datrix.findMany("post", {
					where: { slug: "pp-limit-1" },
					populate: { comments: { where: { noSuchField: 1 } } } as never,
				}),
			).rejects.toThrow();
		});

		// pg Part5, mg Part4, my Part4 — nested relation filters inside a
		// populate-level where must either work correctly or throw a clear error;
		// silently-empty / broken-alias SQL is the bug
		it("populate-where with a nested relation filter never silently corrupts", async () => {
			let resolved: Record<string, unknown>[] | null = null;
			try {
				resolved = await datrix.findMany("post", {
					where: { slug: "pp-limit-1" },
					populate: {
						comments: { where: { post: { slug: "pp-limit-1" } } },
					} as never,
				});
			} catch {
				// rejecting with a clear error is an accepted outcome
				return;
			}

			// if the adapter resolves it, the filter must actually be applied:
			// all 5 comments of this post match the condition
			const comments = resolved![0]!["comments"] as unknown[];
			expect(comments.length).toBe(5);
		});

		// self-referential belongsTo populate chain (core 3.1 family)
		it("populates a self-referential belongsTo chain", async () => {
			const root = await datrix.create("category", {
				name: "Self Root",
				slug: "self-root",
			});
			const mid = await datrix.create("category", {
				name: "Self Mid",
				slug: "self-mid",
				parent: root.id,
			});
			const leaf = await datrix.create("category", {
				name: "Self Leaf",
				slug: "self-leaf",
				parent: mid.id,
			});

			const fetched = await datrix.findById("category", leaf.id, {
				populate: { parent: { populate: { parent: true } } },
			});

			const parent = fetched!["parent"] as {
				name: string;
				parent: { name: string };
			};
			expect(parent.name).toBe("Self Mid");
			expect(parent.parent.name).toBe("Self Root");
		});
	});

	// ==========================================================================
	// Data validation and relation-write contracts
	// core 1.5/1.7/1.13/1.14/2.1/2.3/4.2, core 1.1, js Part8
	// ==========================================================================
	describe("data validation and relation writes", () => {
		let valCategoryId: number;

		beforeAll(async () => {
			const cat = await datrix.create("category", {
				name: "Val Category",
				slug: "val-category",
			});
			valCategoryId = cat.id;
		});

		// core 1.5/1.7/4.2 — number-only ID policy: string IDs must throw, never
		// coerce to NaN/0 or pass through
		it("throws on a non-numeric string relation ID", async () => {
			await expect(
				datrix.create("post", {
					title: "Bad Id Post",
					content: "c",
					slug: "bad-id-post",
					author: "abc" as never,
				}),
			).rejects.toThrow();
		});

		it("throws on a numeric-looking string relation ID (number-only policy)", async () => {
			await expect(
				datrix.create("post", {
					title: "Bad Id Post 2",
					content: "c",
					slug: "bad-id-post-2",
					author: "5" as never,
				}),
			).rejects.toThrow();
		});

		// core 1.13 — hasOne accepts exactly one reference
		it("throws when hasOne receives multiple references", async () => {
			const catA = await datrix.create("category", {
				name: "HasOne Multi A",
				slug: "hasone-multi-a",
			});
			const catB = await datrix.create("category", {
				name: "HasOne Multi B",
				slug: "hasone-multi-b",
			});

			await expect(
				datrix.create("user", {
					email: "hasone-multi@test.com",
					name: "HasOne Multi",
					favoriteCategory: { set: [catA.id, catB.id] } as never,
				}),
			).rejects.toThrow();
		});

		// core Issue 6 — combining connect + create on a manyToMany relation is
		// valid ("link this existing tag AND create+link a new one"), but it must
		// be expressed as ONE RelationInput object with both keys — not as an
		// ARRAY of separate RelationInput objects, which is ambiguous (each
		// array element looks like a complete op; nothing says whether they
		// merge or which one wins) and now throws instead of silently
		// normalizing to `{}` (the whole relation operation vanishing).
		it("allows connect and create together on a manyToMany relation via one object", async () => {
			const tag = await datrix.create("tag", { name: "Existing Combo Tag" });

			const post = await datrix.create(
				"post",
				{
					title: "Combo Tags Post",
					content: "c",
					slug: "combo-tags-post",
					tags: { connect: [tag.id], create: { name: "New Combo Tag" } },
				},
				{ populate: { tags: true } },
			);

			const tagNames = (post["tags"] as { name: string }[])
				.map((t) => t.name)
				.sort();
			expect(tagNames).toEqual(["Existing Combo Tag", "New Combo Tag"]);
		});

		it("throws when a relation field receives an array of RelationInput objects", async () => {
			const tag = await datrix.create("tag", { name: "Ambiguous Tag" });

			await expect(
				datrix.create("post", {
					title: "Ambiguous Tags Post",
					content: "c",
					slug: "ambiguous-tags-post",
					tags: [{ connect: [tag.id] }, { create: { name: "New Tag" } }] as never,
				}),
			).rejects.toThrow();
		});

		// core 2.3 — nested create payloads must respect the reserved-field check
		it("throws when a nested create supplies a reserved field", async () => {
			await expect(
				datrix.create("post", {
					title: "Reserved Nested",
					content: "c",
					slug: "reserved-nested",
					author: {
						create: {
							email: "reserved-nested@test.com",
							name: "Reserved Nested",
							id: 99999,
						},
					} as never,
				}),
			).rejects.toThrow();
		});

		// core 1.14 — nested update where must be validated against target schema
		it("throws on a nested update whose where has an unknown field", async () => {
			const author = await datrix.create("user", {
				email: "nested-where@test.com",
				name: "Nested Where",
			});
			const post = await datrix.create("post", {
				title: "Nested Where Post",
				content: "c",
				slug: "nested-where-post",
				author: author.id,
			});

			await expect(
				datrix.update("post", post.id, {
					author: {
						update: {
							where: { noSuchField: 1 },
							data: { name: "Changed" },
						},
					} as never,
				}),
			).rejects.toThrow();
		});

		// core 2.1 — nested relations in a multi-row update resolve ONCE
		it("multi-row update with nested create creates the record once", async () => {
			await datrix.createMany("post", [
				{ title: "NC One", content: "c", slug: "nc-once-1" },
				{ title: "NC Two", content: "c", slug: "nc-once-2" },
			]);

			await datrix.updateMany(
				"post",
				{ slug: { $startsWith: "nc-once-" } },
				{
					category: {
						create: { name: "Nested Once Cat", slug: "nested-once-cat" },
					},
				},
			);

			// N-loop resolution would create (or fail on) a second category
			const cats = await datrix.findMany("category", {
				where: { slug: { $startsWith: "nested-once-cat" } },
			});
			expect(cats.length).toBe(1);

			const posts = await datrix.findMany("post", {
				where: { slug: { $startsWith: "nc-once-" } },
				populate: { category: true },
			});
			expect(posts.length).toBe(2);
			for (const post of posts) {
				expect((post["category"] as { id: number }).id).toBe(cats[0]!["id"]);
			}
		});

		// core 1.1 — bulk insert: first item's relations apply to every record;
		// differing relation ops on later items must throw, not be silently dropped
		it("createMany applies the first item's relations to all records", async () => {
			const rows = await datrix.createMany("post", [
				{
					title: "Bulk Rel 1",
					content: "c",
					slug: "bulk-rel-1",
					category: valCategoryId,
				},
				{
					title: "Bulk Rel 2",
					content: "c",
					slug: "bulk-rel-2",
					category: valCategoryId,
				},
			]);
			expect(rows.length).toBe(2);

			const posts = await datrix.findMany("post", {
				where: { slug: { $startsWith: "bulk-rel-" } },
				populate: { category: true },
			});
			for (const post of posts) {
				expect((post["category"] as { id: number }).id).toBe(valCategoryId);
			}
		});

		// A plain belongsTo ID shortcut inlines straight into the row's own FK
		// column (data.ts STEP 3) — it never becomes an async "relation op", so
		// each item is free to reference a different id in one createMany call:
		// no N-query loop is needed, the adapter writes every row's FK in the
		// single bulk insert.
		it("createMany allows each item to reference a different belongsTo id", async () => {
			const otherCat = await datrix.create("category", {
				name: "Bulk Other Cat",
				slug: "bulk-other-cat",
			});

			await datrix.createMany("post", [
				{
					title: "Bulk Diff 1",
					content: "c",
					slug: "bulk-diff-1",
					category: valCategoryId,
				},
				{
					title: "Bulk Diff 2",
					content: "c",
					slug: "bulk-diff-2",
					category: otherCat.id,
				},
			]);

			const posts = await datrix.findMany("post", {
				where: { slug: { $startsWith: "bulk-diff-" } },
				populate: { category: true },
				orderBy: [{ field: "slug", direction: "asc" }],
			});
			expect(posts.length).toBe(2);
			expect((posts[0]!["category"] as { id: number }).id).toBe(valCategoryId);
			expect((posts[1]!["category"] as { id: number }).id).toBe(otherCat.id);
		});

		// core 1.1 (refined): relation ops that CANNOT be inlined into a scalar FK
		// (create/update/delete — anything needing async resolution) still share
		// ONE set across the whole batch, taken from the first item. A later item
		// carrying a different unresolvable op would otherwise be silently
		// dropped (only the first item's create/update/delete ever runs) — reject
		// it instead of resolving it once per item, since that would require an
		// N-query loop this bulk path intentionally does not perform.
		it("createMany throws when later items carry different unresolvable relation ops", async () => {
			await expect(
				datrix.createMany("post", [
					{
						title: "Bulk Create Diff 1",
						content: "c",
						slug: "bulk-create-diff-1",
						category: { create: { name: "Bulk Create Cat A", slug: "bulk-create-cat-a" } },
					},
					{
						title: "Bulk Create Diff 2",
						content: "c",
						slug: "bulk-create-diff-2",
						category: { create: { name: "Bulk Create Cat B", slug: "bulk-create-cat-b" } },
					},
				]),
			).rejects.toThrow();
		});

		// Mixed batch: 2 inline ids + 1 unresolvable `create` — the create item
		// differs from item[0]'s (empty) relation set and must be rejected,
		// regardless of where in the batch it sits.
		it("createMany throws when one item in a mixed batch carries a create op", async () => {
			await expect(
				datrix.createMany("post", [
					{
						title: "Bulk Mixed 1",
						content: "c",
						slug: "bulk-mixed-1",
						category: valCategoryId,
					},
					{
						title: "Bulk Mixed 2",
						content: "c",
						slug: "bulk-mixed-2",
						category: valCategoryId,
					},
					{
						title: "Bulk Mixed 3",
						content: "c",
						slug: "bulk-mixed-3",
						category: {
							create: { name: "Bulk Mixed Cat", slug: "bulk-mixed-cat" },
						},
					},
				]),
			).rejects.toThrow();
		});

		// Mixed batch: 2 unresolvable `create` ops + 1 inline id — item[0]'s
		// create becomes the shared relation set, so the trailing inline-id item
		// (empty relation set) differs from it and must be rejected too.
		it("createMany throws when a trailing inline id follows create ops in a mixed batch", async () => {
			await expect(
				datrix.createMany("post", [
					{
						title: "Bulk Mixed2 1",
						content: "c",
						slug: "bulk-mixed2-1",
						category: {
							create: { name: "Bulk Mixed2 Cat A", slug: "bulk-mixed2-cat-a" },
						},
					},
					{
						title: "Bulk Mixed2 2",
						content: "c",
						slug: "bulk-mixed2-2",
						category: {
							create: { name: "Bulk Mixed2 Cat A", slug: "bulk-mixed2-cat-a" },
						},
					},
					{
						title: "Bulk Mixed2 3",
						content: "c",
						slug: "bulk-mixed2-3",
						category: valCategoryId,
					},
				]),
			).rejects.toThrow();
		});

		// js Part8(1) — unique constraint must hold WITHIN a batch, not only
		// against rows already persisted
		it("throws on duplicate unique values inside one createMany batch", async () => {
			await expect(
				datrix.createMany("user", [
					{ email: "dup-batch@test.com", name: "Dup One" },
					{ email: "dup-batch@test.com", name: "Dup Two" },
				]),
			).rejects.toThrow();
		});

		it("throws when updateMany would set the same unique value on two rows", async () => {
			const u1 = await datrix.create("user", {
				email: "dup-upd-1@test.com",
				name: "Dup Upd 1",
			});
			const u2 = await datrix.create("user", {
				email: "dup-upd-2@test.com",
				name: "Dup Upd 2",
			});

			await expect(
				datrix.updateMany(
					"user",
					{ id: { $in: [u1.id, u2.id] } },
					{ email: "dup-upd-same@test.com" },
				),
			).rejects.toThrow();
		});
	});
});
