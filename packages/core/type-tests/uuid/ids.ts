/**
 * uuid mode: the augmentation `datrix generate types` emits makes
 * DatrixId = string for this whole program.
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

declare module "@datrix/core" {
	interface DatrixRegister {
		idType: "uuid";
	}
}

const UUID = "0190a3f2-7b1c-7d2e-8f3a-1b2c3d4e5f60";

const id: DatrixId = UUID;
// @ts-expect-error — ids are strings in uuid mode
const badId: DatrixId = 1;
const ref: RelationIdRef = { id: UUID };
void id;
void badId;
void ref;

// ── WHERE on ids (and string scalars next to them) ──────────────────────
void datrix.findOne<Post>("post", { id: UUID, slug: "s" });
void datrix.findOne("post", { id: UUID, slug: "s" });
void datrix.findMany<Post>("post", { where: { id: { $in: [UUID] } } });
void datrix.findMany("post", { where: { id: { $in: [UUID] } } });
void datrix.findOne<Post>("post", { author: { id: UUID, email: "a@x.io" } });
void datrix.findOne("post", { author: { id: UUID, email: "a@x.io" } });
// @ts-expect-error — numeric id in uuid mode
void datrix.findOne<Post>("post", { id: 1 });
void datrix.findOne("post", { id: 1 });

// ── id parameters ───────────────────────────────────────────────────────
void datrix.findById<Author>("author", UUID);
void datrix.findById("author", UUID);
void datrix.update<Post>("post", UUID, { views: 1 });
void datrix.update("post", UUID, { views: 1 });
void datrix.delete<Post>("post", UUID);
void datrix.delete("post", UUID);
// @ts-expect-error — numeric id in uuid mode
void datrix.findById<Author>("author", 1);
// @ts-expect-error — numeric id in uuid mode
void datrix.findById("author", 1);
// @ts-expect-error — numeric id in uuid mode
void datrix.delete<Post>("post", 1);
// @ts-expect-error — numeric id in uuid mode
void datrix.delete("post", 1);

// ── relation write input ────────────────────────────────────────────────
const rel: RelationBelongsTo<Author> = { connect: UUID };
// @ts-expect-error — numeric id in uuid mode
const badRel: RelationBelongsTo<Author> = { connect: 1 };
// @ts-expect-error — numeric ids in uuid mode
const badMany: RelationHasMany<Post> = [1];
void rel;
void badRel;
void badMany;

const post = { title: "t", slug: "s", views: 0, published: false };
void datrix.create<Post, CreatePostInput>("post", { ...post, author: UUID });
void datrix.create("post", { ...post, author: UUID });
// @ts-expect-error — numeric relation id in uuid mode
void datrix.create<Post, CreatePostInput>("post", { ...post, author: 1 });
// untyped: any object is valid input (json fields), so relation shapes are
// only checked with a generated input type
void datrix.create("post", { ...post, author: { connect: 1 } });
