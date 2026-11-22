/**
 * WHERE typing, in BOTH id modes, through the public `datrix.*` API.
 * Every typed case (`<Model>`, strict) is followed by its untyped twin (no
 * generic, permissive fallback), so one block proves both modes.
 *
 * Regression: scalar fields whose type equals `DatrixId` (number in int
 * mode, string in uuid mode) were matched by the relation check and
 * required a nested WHERE (`email: "x"` failed in uuid mode, `views: 5`
 * in int mode).
 */

import { datrix } from "./models";
import type { Author, Post } from "./models";

// ── Direct scalar values ────────────────────────────────────────────────
void datrix.findMany<Author>("author", {
	where: { name: "Ada", email: "ada@x.io", age: 36, verified: true },
});
void datrix.findMany("author", {
	where: { name: "Ada", email: "ada@x.io", age: 36, verified: true },
});

void datrix.findOne<Author>("author", { bornAt: new Date(), role: "admin" });
void datrix.findOne("author", { bornAt: new Date(), role: "admin" });

void datrix.count<Post>("post", { title: "t", slug: "s", views: 5 });
void datrix.count("post", { title: "t", slug: "s", views: 5 });

// optional, uuid-typed and json fields
void datrix.findOne<Author>("author", {
	nickname: "ada",
	score: 3,
	externalRef: "0190a3f2-7b1c-7d2e-8f3a-1b2c3d4e5f60",
});
void datrix.findOne("author", {
	nickname: "ada",
	score: 3,
	externalRef: "0190a3f2-7b1c-7d2e-8f3a-1b2c3d4e5f60",
});
void datrix.findOne<Post>("post", { publishedAt: new Date() });
void datrix.findOne("post", { publishedAt: new Date() });

// ── Operators ───────────────────────────────────────────────────────────
void datrix.findMany<Author>("author", {
	where: {
		email: { $eq: "a@x.io", $like: "%@x.io" },
		name: { $in: ["Ada", "Grace"], $startsWith: "A" },
		age: { $gt: 18, $lte: 99, $nin: [42] },
		bornAt: { $gte: new Date(0) },
		role: { $in: ["admin", "editor"] },
		nickname: { $null: true },
		score: { $notNull: true },
	},
});
void datrix.findMany("author", {
	where: {
		email: { $eq: "a@x.io", $like: "%@x.io" },
		name: { $in: ["Ada", "Grace"], $startsWith: "A" },
		age: { $gt: 18, $lte: 99, $nin: [42] },
		bornAt: { $gte: new Date(0) },
		role: { $in: ["admin", "editor"] },
		nickname: { $null: true },
		score: { $notNull: true },
	},
});

// ── Relations: nested WHERE ─────────────────────────────────────────────
void datrix.findMany<Post>("post", {
	where: { author: { email: "a@x.io", age: { $gt: 18 } } },
});
void datrix.findMany("post", {
	where: { author: { email: "a@x.io", age: { $gt: 18 } } },
});

void datrix.count<Author>("author", { posts: { slug: "s" }, tags: { label: "x" } });
void datrix.count("author", { posts: { slug: "s" }, tags: { label: "x" } });

// two levels deep
void datrix.findMany<Author>("author", {
	where: { posts: { comments: { body: "first", likes: { $gt: 0 } } } },
});
void datrix.findMany("author", {
	where: { posts: { comments: { body: "first", likes: { $gt: 0 } } } },
});

// ── Logical operators ───────────────────────────────────────────────────
void datrix.findMany<Post>("post", {
	where: {
		$or: [{ slug: "a" }, { views: { $gt: 100 } }],
		$and: [{ published: true }, { author: { email: "a@x.io" } }],
		$not: { title: "draft" },
	},
});
void datrix.findMany("post", {
	where: {
		$or: [{ slug: "a" }, { views: { $gt: 100 } }],
		$and: [{ published: true }, { author: { email: "a@x.io" } }],
		$not: { title: "draft" },
	},
});

// ── Other entry points taking a WHERE ───────────────────────────────────
void datrix.updateMany<Post>("post", { views: { $lt: 1 } }, { published: false });
void datrix.updateMany("post", { views: { $lt: 1 } }, { published: false });
void datrix.deleteMany<Post>("post", { slug: { $startsWith: "tmp-" } });
void datrix.deleteMany("post", { slug: { $startsWith: "tmp-" } });
void datrix.countMany<Post>("post", { groupBy: ["published"], having: { published: true } });
void datrix.countMany("post", { groupBy: ["published"], having: { published: true } });

// ── Typed rejects, untyped accepts (no model to check against) ──────────
// @ts-expect-error — wrong scalar type
void datrix.findOne<Author>("author", { email: 5 });
void datrix.findOne("author", { email: 5 });
// @ts-expect-error — wrong scalar type
void datrix.findOne<Author>("author", { age: "36" });
void datrix.findOne("author", { age: "36" });
// @ts-expect-error — enum value outside the union
void datrix.findOne<Author>("author", { role: "owner" });
void datrix.findOne("author", { role: "owner" });
// @ts-expect-error — unknown field
void datrix.findOne<Author>("author", { missing: 1 });
void datrix.findOne("author", { missing: 1 });
// @ts-expect-error — unknown field inside a nested relation WHERE
void datrix.findOne<Post>("post", { author: { missing: "x" } });
void datrix.findOne("post", { author: { missing: "x" } });
// @ts-expect-error — wrong scalar type inside a nested relation WHERE
void datrix.findOne<Post>("post", { author: { email: 5 } });
void datrix.findOne("post", { author: { email: 5 } });
// @ts-expect-error — relation filters take a nested WHERE, not a plain value
void datrix.findOne<Post>("post", { author: "a@x.io" });
void datrix.findOne("post", { author: "a@x.io" });
// @ts-expect-error — array fields have no WHERE support
void datrix.findOne<Author>("author", { aliases: ["a"] });

// Operator misuse is only caught with a model: untyped, `{ $gt: "a" }`
// could just as well be a nested WHERE on a relation named "email".
// @ts-expect-error — $gt is not valid for strings
void datrix.findOne<Author>("author", { email: { $gt: "a" } });
void datrix.findOne("author", { email: { $gt: "a" } });
// @ts-expect-error — $like is not valid for numbers
void datrix.findOne<Author>("author", { age: { $like: 1 } });
void datrix.findOne("author", { age: { $like: 1 } });
// @ts-expect-error — $in takes an array
void datrix.findOne<Post>("post", { slug: { $in: "a" } });
void datrix.findOne("post", { slug: { $in: "a" } });

// ── Rejected in both modes ──────────────────────────────────────────────
// @ts-expect-error — $and takes an array
void datrix.findOne<Post>("post", { $and: { slug: "a" } });
// @ts-expect-error — $and takes an array
void datrix.findOne("post", { $and: { slug: "a" } });
// @ts-expect-error — $or takes an array
void datrix.findOne<Post>("post", { $or: { slug: "a" } });
// @ts-expect-error — $or takes an array
void datrix.findOne("post", { $or: { slug: "a" } });
// @ts-expect-error — a WHERE is an object
void datrix.findOne<Post>("post", "slug");
// @ts-expect-error — a WHERE is an object
void datrix.findOne("post", "slug");
