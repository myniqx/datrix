/**
 * Models shared by the int and uuid type-test programs, written in the exact
 * shape `datrix generate types` emits (packages/cli/src/type-generator):
 * `XBase extends DatrixEntry` (scalars, optional = `?`), `XRelation` (read
 * mode), `XRelationUpdate` (write mode, a type alias so `CreateXInput`
 * satisfies the `FallbackInput` constraint of create/update) and the `X` / `CreateXInput` /
 * `UpdateXInput` aliases. Generated types are the contract these tests
 * guard; hand-written models and open generics (`T extends Post`) are out of
 * scope.
 *
 * Each program compiles this file on its own, so `DatrixId` resolves to
 * `number` (int) or `string` (uuid — the uuid program declares the
 * DatrixRegister augmentation the generator emits).
 */

import type {
	Datrix,
	DatrixEntry,
	DatrixId,
	RelationBelongsTo,
	RelationHasMany,
	RelationManyToMany,
} from "@datrix/core";

export type JsonValue =
	| string
	| number
	| boolean
	| null
	| JsonValue[]
	| { [key: string]: JsonValue };

// ── Author  (relations: posts → hasMany(post), tags → manyToMany(tag)) ──
export interface AuthorBase extends DatrixEntry {
	name: string;
	email: string;
	age: number;
	verified: boolean;
	bornAt: Date;
	role: "admin" | "editor";
	nickname?: string;
	score?: number;
	externalRef?: string; // uuid field
	settings?: JsonValue;
	aliases?: string[];
}
export interface AuthorRelation {
	posts?: Post[];
	tags?: Tag[];
}
export type AuthorRelationUpdate = {
	posts?: RelationHasMany<Post>;
	tags?: RelationManyToMany<Tag>;
};
export type Author = AuthorBase & AuthorRelation;
export type CreateAuthorInput = Omit<AuthorBase, keyof DatrixEntry> &
	AuthorRelationUpdate;
export type UpdateAuthorInput = Partial<Omit<AuthorBase, keyof DatrixEntry>> &
	AuthorRelationUpdate;

// ── Post  (relations: author → belongsTo(author), comments → hasMany(comment)) ──
export interface PostBase extends DatrixEntry {
	title: string;
	slug: string;
	views: number;
	published: boolean;
	publishedAt?: Date;
}
export interface PostRelation {
	author?: Author;
	comments?: Comment[];
}
export type PostRelationUpdate = {
	author?: RelationBelongsTo<Author>;
	comments?: RelationHasMany<Comment>;
};
export type Post = PostBase & PostRelation;
export type CreatePostInput = Omit<PostBase, keyof DatrixEntry> &
	PostRelationUpdate;
export type UpdatePostInput = Partial<Omit<PostBase, keyof DatrixEntry>> &
	PostRelationUpdate;

// ── Comment  (relations: post → belongsTo(post)) ──
export interface CommentBase extends DatrixEntry {
	body: string;
	likes: number;
}
export interface CommentRelation {
	post?: Post;
}
export type CommentRelationUpdate = {
	post?: RelationBelongsTo<Post>;
};
export type Comment = CommentBase & CommentRelation;

// ── Tag  (relations: authors → manyToMany(author)) ──
export interface TagBase extends DatrixEntry {
	label: string;
}
export interface TagRelation {
	authors?: Author[];
}
export type Tag = TagBase & TagRelation;

export declare const datrix: Datrix;
export declare const someId: DatrixId;
