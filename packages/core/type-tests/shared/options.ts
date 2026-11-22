/**
 * SELECT / POPULATE / ORDER BY / groupBy / upsert option typing, in BOTH id
 * modes. Every typed case (`<Model>`, strict) is followed by its untyped
 * twin (no generic, permissive fallback). Typed rejections mirror runtime
 * errors in the query builder (select.ts, populate.ts, orderby.ts,
 * builder.ts), so a typed query that compiles also builds.
 */

import { datrix, someId } from "./models";
import type { Author, Comment, Post } from "./models";

// ════════════════════════════════════════════════════════════════════════
// SELECT
// ════════════════════════════════════════════════════════════════════════
void datrix.findMany<Author>("author", { select: ["name", "email", "age"] });
void datrix.findMany("author", { select: ["name", "email", "age"] });
void datrix.findMany<Author>("author", { select: ["id", "createdAt"] });
void datrix.findMany("author", { select: ["id", "createdAt"] });
void datrix.findMany<Author>("author", { select: ["settings", "aliases"] });
void datrix.findMany("author", { select: ["settings", "aliases"] });
void datrix.findMany<Author>("author", { select: "*" });
void datrix.findMany("author", { select: "*" });
void datrix.findMany<Author>("author", { select: "email" });
void datrix.findMany("author", { select: "email" });
void datrix.findOne<Post>("post", { slug: "s" }, { select: ["title"] });
void datrix.findOne("post", { slug: "s" }, { select: ["title"] });
void datrix.findById<Post>("post", someId, { select: ["views"] });
void datrix.findById("post", someId, { select: ["views"] });
void datrix.create<Post>("post", { slug: "s" }, { select: ["slug"] });
void datrix.create("post", { slug: "s" }, { select: ["slug"] });
void datrix.deleteMany<Post>("post", { slug: "s" }, { select: ["id"] });
void datrix.deleteMany("post", { slug: "s" }, { select: ["id"] });

// typed rejects, untyped accepts
// @ts-expect-error — unknown field
void datrix.findMany<Author>("author", { select: ["missing"] });
void datrix.findMany("author", { select: ["missing"] });
// @ts-expect-error — relations are populated, not selected (throwRelationInSelect)
void datrix.findMany<Author>("author", { select: ["name", "posts"] });
void datrix.findMany("author", { select: ["name", "posts"] });
// @ts-expect-error — relations are populated, not selected (single form)
void datrix.findMany<Post>("post", { select: "author" });
void datrix.findMany("post", { select: "author" });

// rejected in both modes
// @ts-expect-error — select takes field names
void datrix.findMany<Author>("author", { select: [1] });
// @ts-expect-error — select takes field names
void datrix.findMany("author", { select: [1] });

// ════════════════════════════════════════════════════════════════════════
// POPULATE
// ════════════════════════════════════════════════════════════════════════
// Shortcuts
void datrix.findMany<Post>("post", { populate: true });
void datrix.findMany("post", { populate: true });
void datrix.findMany<Post>("post", { populate: "*" });
void datrix.findMany("post", { populate: "*" });
void datrix.findMany<Post>("post", { populate: ["author", "comments"] });
void datrix.findMany("post", { populate: ["author", "comments"] });
void datrix.findMany<Post>("post", { populate: { author: true, comments: "*" } });
void datrix.findMany("post", { populate: { author: true, comments: "*" } });

// Dot notation (populate.ts splits on ".")
void datrix.findMany<Author>("author", { populate: ["posts.comments"] });
void datrix.findMany("author", { populate: ["posts.comments"] });
void datrix.findMany<Comment>("comment", { populate: ["post.author.tags"] });
void datrix.findMany("comment", { populate: ["post.author.tags"] });

// Options on the related model
void datrix.findMany<Post>("post", {
	populate: {
		author: {
			select: ["name", "email"],
			where: { verified: true, age: { $gt: 18 } },
			limit: 1,
			offset: 0,
		},
		comments: {
			select: "*",
			where: { likes: { $gte: 1 } },
			orderBy: [{ field: "likes", direction: "desc" }],
		},
	},
});
void datrix.findMany("post", {
	populate: {
		author: {
			select: ["name", "email"],
			where: { verified: true, age: { $gt: 18 } },
			limit: 1,
			offset: 0,
		},
		comments: {
			select: "*",
			where: { likes: { $gte: 1 } },
			orderBy: [{ field: "likes", direction: "desc" }],
		},
	},
});

// orderBy inside populate accepts every OrderByClause form
void datrix.findMany<Author>("author", {
	populate: { posts: { orderBy: ["-views", "title"] } },
});
void datrix.findMany("author", {
	populate: { posts: { orderBy: ["-views", "title"] } },
});
void datrix.findMany<Author>("author", {
	populate: { posts: { orderBy: { views: "desc" } } },
});
void datrix.findMany("author", {
	populate: { posts: { orderBy: { views: "desc" } } },
});

// Nested populate, three levels
void datrix.findMany<Author>("author", {
	populate: {
		posts: {
			select: ["title"],
			populate: {
				comments: {
					select: ["body"],
					where: { likes: 0 },
					populate: { post: { select: ["slug"] } },
				},
			},
		},
	},
});
void datrix.findMany("author", {
	populate: {
		posts: {
			select: ["title"],
			populate: {
				comments: {
					select: ["body"],
					where: { likes: 0 },
					populate: { post: { select: ["slug"] } },
				},
			},
		},
	},
});
void datrix.findMany<Author>("author", {
	populate: { posts: { populate: ["comments", "comments.post"] } },
});
void datrix.findMany("author", {
	populate: { posts: { populate: ["comments", "comments.post"] } },
});

// typed rejects, untyped accepts
// @ts-expect-error — scalar fields cannot be populated
void datrix.findMany<Post>("post", { populate: { title: true } });
void datrix.findMany("post", { populate: { title: true } });
// @ts-expect-error — scalar fields cannot be populated (array form)
void datrix.findMany<Post>("post", { populate: ["title"] });
void datrix.findMany("post", { populate: ["title"] });
// @ts-expect-error — unknown relation
void datrix.findMany<Post>("post", { populate: { missing: true } });
void datrix.findMany("post", { populate: { missing: true } });
// @ts-expect-error — unknown relation (array form)
void datrix.findMany<Post>("post", { populate: ["missing"] });
void datrix.findMany("post", { populate: ["missing"] });
// @ts-expect-error — second dot segment must be a relation of the target
void datrix.findMany<Author>("author", { populate: ["posts.title"] });
void datrix.findMany("author", { populate: ["posts.title"] });
// @ts-expect-error — second dot segment unknown on the target
void datrix.findMany<Author>("author", { populate: ["posts.missing"] });
void datrix.findMany("author", { populate: ["posts.missing"] });
void datrix.findMany<Post>("post", {
	// @ts-expect-error — select checked against the related model
	populate: { author: { select: ["slug"] } },
});
void datrix.findMany("post", { populate: { author: { select: ["slug"] } } });
void datrix.findMany<Post>("post", {
	// @ts-expect-error — relation select inside populate options
	populate: { author: { select: ["posts"] } },
});
void datrix.findMany("post", { populate: { author: { select: ["posts"] } } });
void datrix.findMany<Post>("post", {
	// @ts-expect-error — where checked against the related model
	populate: { author: { where: { slug: "x" } } },
});
void datrix.findMany("post", { populate: { author: { where: { slug: "x" } } } });
void datrix.findMany<Post>("post", {
	// @ts-expect-error — where value type checked against the related model
	populate: { author: { where: { age: "x" } } },
});
void datrix.findMany("post", { populate: { author: { where: { age: "x" } } } });
void datrix.findMany<Post>("post", {
	// @ts-expect-error — orderBy checked against the related model
	populate: { author: { orderBy: ["-slug"] } },
});
void datrix.findMany("post", { populate: { author: { orderBy: ["-slug"] } } });
void datrix.findMany<Author>("author", {
	// @ts-expect-error — nested populate checked against the related model
	populate: { posts: { populate: { author: { select: ["slug"] } } } },
});
void datrix.findMany("author", {
	populate: { posts: { populate: { author: { select: ["slug"] } } } },
});
void datrix.findMany<Author>("author", {
	// @ts-expect-error — scalar populate two levels down
	populate: { posts: { populate: { comments: { populate: { body: true } } } } },
});
void datrix.findMany("author", {
	populate: { posts: { populate: { comments: { populate: { body: true } } } } },
});

// rejected in both modes
void datrix.findMany<Post>("post", {
	// @ts-expect-error — unknown option key (populate.ts rejects it)
	populate: { author: { sort: "name" } },
});
void datrix.findMany("post", {
	// @ts-expect-error — unknown option key (populate.ts rejects it)
	populate: { author: { sort: "name" } },
});
void datrix.findMany<Post>("post", {
	// @ts-expect-error — limit is a number
	populate: { author: { limit: "1" } },
});
void datrix.findMany("post", {
	// @ts-expect-error — limit is a number
	populate: { author: { limit: "1" } },
});
// @ts-expect-error — populate value is options, "*" or boolean
void datrix.findMany<Post>("post", { populate: { author: 1 } });
// @ts-expect-error — populate value is options, "*" or boolean
void datrix.findMany("post", { populate: { author: 1 } });

// ════════════════════════════════════════════════════════════════════════
// ORDER BY
// ════════════════════════════════════════════════════════════════════════
void datrix.findMany<Author>("author", {
	orderBy: [
		{ field: "age", direction: "asc", nulls: "last" },
		{ field: "createdAt", direction: "desc" },
	],
});
void datrix.findMany("author", {
	orderBy: [
		{ field: "age", direction: "asc", nulls: "last" },
		{ field: "createdAt", direction: "desc" },
	],
});
void datrix.findMany<Author>("author", { orderBy: { name: "asc" } });
void datrix.findMany("author", { orderBy: { name: "asc" } });
void datrix.findMany<Author>("author", { orderBy: ["age", "-name", "-id"] });
void datrix.findMany("author", { orderBy: ["age", "-name", "-id"] });

// typed rejects, untyped accepts
// @ts-expect-error — unknown field
void datrix.findMany<Author>("author", { orderBy: ["missing"] });
void datrix.findMany("author", { orderBy: ["missing"] });
// @ts-expect-error — unknown field (desc prefix)
void datrix.findMany<Author>("author", { orderBy: ["-missing"] });
void datrix.findMany("author", { orderBy: ["-missing"] });
void datrix.findMany<Author>("author", {
	// @ts-expect-error — unknown field (full form)
	orderBy: [{ field: "missing", direction: "asc" }],
});
void datrix.findMany("author", {
	orderBy: [{ field: "missing", direction: "asc" }],
});
// @ts-expect-error — relations cannot be ordered by
void datrix.findMany<Author>("author", { orderBy: ["posts"] });
void datrix.findMany("author", { orderBy: ["posts"] });
// @ts-expect-error — relations cannot be ordered by (object form)
void datrix.findMany<Post>("post", { orderBy: { author: "asc" } });
void datrix.findMany("post", { orderBy: { author: "asc" } });
void datrix.findMany<Post>("post", {
	// @ts-expect-error — relations cannot be ordered by (full form)
	orderBy: [{ field: "author", direction: "asc" }],
});
void datrix.findMany("post", {
	orderBy: [{ field: "author", direction: "asc" }],
});

// rejected in both modes
// @ts-expect-error — invalid direction
void datrix.findMany<Author>("author", { orderBy: { name: "up" } });
// @ts-expect-error — invalid direction
void datrix.findMany("author", { orderBy: { name: "up" } });
void datrix.findMany<Author>("author", {
	// @ts-expect-error — full form needs a direction
	orderBy: [{ field: "name" }],
});
void datrix.findMany("author", {
	// @ts-expect-error — full form needs a direction
	orderBy: [{ field: "name" }],
});

// ════════════════════════════════════════════════════════════════════════
// groupBy / having / countMany
// ════════════════════════════════════════════════════════════════════════
void datrix.countMany<Post>("post", { groupBy: ["published"] });
void datrix.countMany("post", { groupBy: ["published"] });
void datrix.countMany<Post>("post", {
	where: { views: { $gt: 0 } },
	groupBy: ["published", "views"],
	having: { published: true },
});
void datrix.countMany("post", {
	where: { views: { $gt: 0 } },
	groupBy: ["published", "views"],
	having: { published: true },
});
void datrix.findMany<Author>("author", { groupBy: ["role"] });
void datrix.findMany("author", { groupBy: ["role"] });

// typed rejects, untyped accepts
// @ts-expect-error — unknown groupBy field
void datrix.countMany<Post>("post", { groupBy: ["missing"] });
void datrix.countMany("post", { groupBy: ["missing"] });
// @ts-expect-error — relations cannot be grouped by
void datrix.countMany<Post>("post", { groupBy: ["author"] });
void datrix.countMany("post", { groupBy: ["author"] });
// @ts-expect-error — having checked against the model
void datrix.countMany<Post>("post", { groupBy: ["slug"], having: { slug: 1 } });
void datrix.countMany("post", { groupBy: ["slug"], having: { slug: 1 } });

// rejected in both modes
// @ts-expect-error — countMany needs groupBy
void datrix.countMany<Post>("post", {});
// @ts-expect-error — countMany needs groupBy
void datrix.countMany("post", {});

// ════════════════════════════════════════════════════════════════════════
// UPSERT
// ════════════════════════════════════════════════════════════════════════
void datrix.upsert<Post>(
	"post",
	{ slug: "s", title: "t" },
	{ conflictOn: ["slug"], update: ["title"] },
);
void datrix.upsert(
	"post",
	{ slug: "s", title: "t" },
	{ conflictOn: ["slug"], update: ["title"] },
);
void datrix.upsertMany<Post>("post", [{ slug: "s" }], {
	conflictOn: ["slug"],
	update: [],
	select: ["id"],
});
void datrix.upsertMany("post", [{ slug: "s" }], {
	conflictOn: ["slug"],
	update: [],
	select: ["id"],
});

// typed rejects, untyped accepts
// @ts-expect-error — unknown conflict field
void datrix.upsert<Post>("post", { slug: "s" }, { conflictOn: ["missing"] });
void datrix.upsert("post", { slug: "s" }, { conflictOn: ["missing"] });
void datrix.upsert<Post>(
	"post",
	{ slug: "s" },
	// @ts-expect-error — unknown update field
	{ conflictOn: ["slug"], update: ["missing"] },
);
void datrix.upsert(
	"post",
	{ slug: "s" },
	{ conflictOn: ["slug"], update: ["missing"] },
);

// rejected in both modes
// @ts-expect-error — conflictOn is required
void datrix.upsert<Post>("post", { slug: "s" }, {});
// @ts-expect-error — conflictOn is required
void datrix.upsert("post", { slug: "s" }, {});
