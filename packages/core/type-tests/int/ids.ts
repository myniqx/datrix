/**
 * int mode (no DatrixRegister augmentation): DatrixId = number.
 * Typed cases are followed by their untyped twins. `id` parameters
 * (findById/update/delete) and relation inputs are `DatrixId` in both
 * modes; WHERE on `id` is only checked with a model.
 */

import type {
	DatrixId,
	RelationBelongsTo,
	RelationHasMany,
	RelationIdRef,
} from "@datrix/core";
import { datrix } from "../shared/models";
import type { Author, CreatePostInput, Post } from "../shared/models";

const id: DatrixId = 1;
// @ts-expect-error — ids are numbers in int mode
const badId: DatrixId = "0190a3f2-7b1c-7d2e-8f3a-1b2c3d4e5f60";
const ref: RelationIdRef = { id: 2 };
void id;
void badId;
void ref;

// ── WHERE on ids ────────────────────────────────────────────────────────
void datrix.findOne<Post>("post", { id: 1, views: 1 });
void datrix.findOne("post", { id: 1, views: 1 });
void datrix.findMany<Post>("post", { where: { id: { $in: [1, 2] } } });
void datrix.findMany("post", { where: { id: { $in: [1, 2] } } });
void datrix.findOne<Post>("post", { author: { id: 3 } });
void datrix.findOne("post", { author: { id: 3 } });
// @ts-expect-error — string id in int mode
void datrix.findOne<Post>("post", { id: "abc" });
void datrix.findOne("post", { id: "abc" });

// ── id parameters ───────────────────────────────────────────────────────
void datrix.findById<Author>("author", 1);
void datrix.findById("author", 1);
void datrix.update<Post>("post", 1, { views: 1 });
void datrix.update("post", 1, { views: 1 });
void datrix.delete<Post>("post", 1);
void datrix.delete("post", 1);
// @ts-expect-error — string id in int mode
void datrix.findById<Author>("author", "abc");
// @ts-expect-error — string id in int mode
void datrix.findById("author", "abc");
// @ts-expect-error — string id in int mode
void datrix.delete<Post>("post", "abc");
// @ts-expect-error — string id in int mode
void datrix.delete("post", "abc");

// ── relation write input ────────────────────────────────────────────────
const rel: RelationBelongsTo<Author> = { connect: 2 };
// @ts-expect-error — string id in int mode
const badRel: RelationBelongsTo<Author> = { connect: "abc" };
// @ts-expect-error — string ids in int mode
const badMany: RelationHasMany<Post> = ["abc"];
void rel;
void badRel;
void badMany;

const post = { title: "t", slug: "s", views: 0, published: false };
void datrix.create<Post, CreatePostInput>("post", { ...post, author: 2 });
void datrix.create("post", { ...post, author: 2 });
// @ts-expect-error — string relation id in int mode
void datrix.create<Post, CreatePostInput>("post", { ...post, author: "abc" });
// untyped: any object is valid input (json fields), so relation shapes are
// only checked with a generated input type
void datrix.create("post", { ...post, author: { connect: "abc" } });
