/**
 * Result types: `<Model>` returns the model, no generic returns
 * `DatrixRecord` (any field, index access) — whatever the arguments are.
 *
 * Regression: with no generic, TypeScript inferred `T` from the WHERE /
 * options argument and settled on `DatrixEntry`, so
 * `(await datrix.findOne("post", { slug })).title` did not compile. The
 * CRUD signatures wrap WHERE/options in `NoInfer`.
 */

import type { DatrixRecord } from "@datrix/core";
import { datrix, someId, type Post } from "./models";

type Is<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
function expectType<T extends true>(): T | void {}

export async function typed(): Promise<void> {
	const one = await datrix.findOne<Post>("post", { slug: "a" });
	expectType<Is<typeof one, Post | null>>();
	const byId = await datrix.findById<Post>("post", someId, { select: "*" });
	expectType<Is<typeof byId, Post | null>>();
	const many = await datrix.findMany<Post>("post", { where: { slug: "a" } });
	expectType<Is<typeof many, Post[]>>();
	const created = await datrix.create<Post>("post", { slug: "a" });
	expectType<Is<typeof created, Post>>();
	const updated = await datrix.update<Post>("post", someId, { views: 1 });
	expectType<Is<typeof updated, Post>>();
	const upd = await datrix.updateMany<Post>("post", { slug: "a" }, {});
	expectType<Is<typeof upd, Post[]>>();
	const ups = await datrix.upsert<Post>(
		"post",
		{ slug: "a" },
		{ conflictOn: ["slug"] },
	);
	expectType<Is<typeof ups, Post>>();
	const del = await datrix.deleteMany<Post>("post", { slug: "a" });
	expectType<Is<typeof del, Post[]>>();
	const n = await datrix.count<Post>("post", { slug: "a" });
	expectType<Is<typeof n, number>>();
	void one?.title;
}

export async function untyped(): Promise<void> {
	const one = await datrix.findOne("post", { slug: "a" });
	expectType<Is<typeof one, DatrixRecord | null>>();
	const oneOpts = await datrix.findOne("post", { slug: "a" }, { select: ["x"] });
	expectType<Is<typeof oneOpts, DatrixRecord | null>>();
	const byId = await datrix.findById("post", someId, { populate: true });
	expectType<Is<typeof byId, DatrixRecord | null>>();
	const many = await datrix.findMany("post", { where: { slug: "a" } });
	expectType<Is<typeof many, DatrixRecord[]>>();
	const all = await datrix.findMany("post");
	expectType<Is<typeof all, DatrixRecord[]>>();
	const created = await datrix.create("post", { slug: "a" }, { select: "*" });
	expectType<Is<typeof created, DatrixRecord>>();
	const createdMany = await datrix.createMany("post", [{ slug: "a" }]);
	expectType<Is<typeof createdMany, DatrixRecord[]>>();
	const updated = await datrix.update("post", someId, { views: 1 });
	expectType<Is<typeof updated, DatrixRecord>>();
	const upd = await datrix.updateMany("post", { slug: "a" }, { views: 1 });
	expectType<Is<typeof upd, DatrixRecord[]>>();
	const ups = await datrix.upsert(
		"post",
		{ slug: "a" },
		{ conflictOn: ["slug"] },
	);
	expectType<Is<typeof ups, DatrixRecord>>();
	const upsMany = await datrix.upsertMany("post", [{ slug: "a" }], {
		conflictOn: ["slug"],
	});
	expectType<Is<typeof upsMany, DatrixRecord[]>>();
	const removed = await datrix.delete("post", someId);
	expectType<Is<typeof removed, DatrixRecord>>();
	const del = await datrix.deleteMany("post", { slug: "a" });
	expectType<Is<typeof del, DatrixRecord[]>>();
	void one?.["title"];

	// the raw (hook-less) CRUD behaves the same
	const raw = await datrix.raw.findOne("post", { slug: "a" });
	expectType<Is<typeof raw, DatrixRecord | null>>();
	const rawMany = await datrix.raw.findMany("post", { where: { slug: "a" } });
	expectType<Is<typeof rawMany, DatrixRecord[]>>();
}
