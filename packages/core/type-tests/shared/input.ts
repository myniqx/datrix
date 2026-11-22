/**
 * create / update input with the generated `CreateXInput` / `UpdateXInput`
 * types (typed, strict), each followed by its untyped twin (`FallbackInput`,
 * permissive). Relation id shortcuts use `DatrixId`, so they follow the id
 * mode; the mode-specific rejections live in int/ids.ts and uuid/ids.ts.
 */

import { datrix, someId } from "./models";
import type {
	CreateAuthorInput,
	CreatePostInput,
	Post,
	UpdatePostInput,
} from "./models";

const base = { title: "t", slug: "s", views: 0, published: false };

// ── create: relation shortcuts and operations ───────────────────────────
void datrix.create<Post, CreatePostInput>("post", { ...base, author: someId });
void datrix.create("post", { ...base, author: someId });
void datrix.create<Post, CreatePostInput>("post", {
	...base,
	author: { id: someId },
	comments: [someId, { id: someId }],
});
void datrix.create("post", {
	...base,
	author: { id: someId },
	comments: [someId, { id: someId }],
});
void datrix.create<Post, CreatePostInput>("post", {
	...base,
	author: { connect: someId },
	comments: { connect: [someId], create: [{ body: "b", likes: 0 }] },
});
void datrix.create("post", {
	...base,
	author: { connect: someId },
	comments: { connect: [someId], create: [{ body: "b", likes: 0 }] },
});
void datrix.create<Post, CreatePostInput>(
	"post",
	{ ...base, author: null },
	{ select: ["title"], populate: ["author"] },
);
void datrix.create(
	"post",
	{ ...base, author: null },
	{ select: ["title"], populate: ["author"] },
);
// json / array / manyToMany
void datrix.create<Post, CreateAuthorInput>("author", {
	name: "n",
	email: "e",
	age: 1,
	verified: true,
	bornAt: new Date(),
	role: "admin",
	settings: { theme: "dark", flags: [1, 2] },
	aliases: ["a"],
	tags: { set: [someId] },
});
void datrix.create("author", {
	name: "n",
	settings: { theme: "dark", flags: [1, 2] },
	aliases: ["a"],
	tags: { set: [someId] },
});
void datrix.createMany<Post, CreatePostInput>("post", [base, base]);
void datrix.createMany("post", [base, base]);

// ── update ──────────────────────────────────────────────────────────────
void datrix.update<Post, UpdatePostInput>("post", someId, { views: 1 });
void datrix.update("post", someId, { views: 1 });
void datrix.update<Post, UpdatePostInput>("post", someId, {
	author: { disconnect: true },
	comments: { set: [someId], delete: [someId] },
});
void datrix.update("post", someId, {
	author: { disconnect: true },
	comments: { set: [someId], delete: [someId] },
});
void datrix.updateMany<Post, UpdatePostInput>(
	"post",
	{ views: { $lt: 10 } },
	{ published: true },
);
void datrix.updateMany("post", { views: { $lt: 10 } }, { published: true });

// ── typed rejects, untyped accepts ──────────────────────────────────────
// @ts-expect-error — required field missing
void datrix.create<Post, CreatePostInput>("post", { title: "t" });
void datrix.create("post", { title: "t" });
// @ts-expect-error — wrong scalar type
void datrix.update<Post, UpdatePostInput>("post", someId, { views: "1" });
void datrix.update("post", someId, { views: "1" });
// @ts-expect-error — belongsTo takes a single reference
void datrix.update<Post, UpdatePostInput>("post", someId, { author: [someId] });
void datrix.update("post", someId, { author: [someId] });
// @ts-expect-error — unknown field
void datrix.update<Post, UpdatePostInput>("post", someId, { missing: 1 });
void datrix.update("post", someId, { missing: 1 });
void datrix.update<Post, UpdatePostInput>("post", someId, {
	// @ts-expect-error — nested create checked against the related model
	comments: { create: [{ body: 1 }] },
});
void datrix.update("post", someId, { comments: { create: [{ body: 1 }] } });

// ── rejected in both modes ──────────────────────────────────────────────
// @ts-expect-error — data is an object
void datrix.create<Post, CreatePostInput>("post", "title");
// @ts-expect-error — data is an object
void datrix.create("post", "title");
// @ts-expect-error — createMany takes an array
void datrix.createMany<Post, CreatePostInput>("post", base);
// @ts-expect-error — createMany takes an array
void datrix.createMany("post", base);
