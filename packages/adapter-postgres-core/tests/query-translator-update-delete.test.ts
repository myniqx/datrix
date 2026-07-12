/**
 * Tests for Part 4 (adapter-postgres-core/issue.md): relation-WHERE on
 * UPDATE/DELETE must emit an id-subquery (`"t"."id" IN (SELECT ...)`)
 * instead of the old regex-based LEFT JOIN -> FROM/USING conversion, so that
 * LEFT JOIN semantics (NULL FK rows, $or branches) are preserved.
 */
import { describe, expect, it } from "vitest";
import type {
	ISchemaRegistry,
	QueryDeleteObject,
	QueryUpdateObject,
	SchemaDefinition,
} from "@datrix/core";
import { PostgresQueryTranslator } from "../src/query-translator";

/**
 * Minimal fake schema registry backing three related schemas:
 * - posts: belongsTo authors (FK authorId), manyToMany tags (through post_tags)
 * - authors: target of belongsTo
 * - tags: target of manyToMany
 */
function createRelationalSchemaRegistry(): ISchemaRegistry {
	const postsSchema: SchemaDefinition = {
		name: "Post",
		tableName: "posts",
		fields: {
			id: { type: "number" },
			status: { type: "string" },
			authorId: { type: "number", hidden: true },
			author: {
				type: "relation",
				kind: "belongsTo",
				model: "Author",
				foreignKey: "authorId",
			},
			tags: {
				type: "relation",
				kind: "manyToMany",
				model: "Tag",
				through: "post_tags",
			},
		} as unknown as SchemaDefinition["fields"],
	};

	const authorsSchema: SchemaDefinition = {
		name: "Author",
		tableName: "authors",
		fields: {
			id: { type: "number" },
			verified: { type: "boolean" },
		} as unknown as SchemaDefinition["fields"],
	};

	const tagsSchema: SchemaDefinition = {
		name: "Tag",
		tableName: "tags",
		fields: {
			id: { type: "number" },
			name: { type: "string" },
		} as unknown as SchemaDefinition["fields"],
	};

	const schemas = new Map<string, SchemaDefinition>([
		["Post", postsSchema],
		["Author", authorsSchema],
		["Tag", tagsSchema],
	]);

	const tableToModel = new Map<string, string>([
		["posts", "Post"],
		["authors", "Author"],
		["tags", "Tag"],
	]);

	return {
		register: (schema) => schema,
		get: (name) => schemas.get(name),
		getWithTableName: (modelName) => {
			const schema = schemas.get(modelName);
			return schema ? { schema, tableName: schema.tableName! } : undefined;
		},
		getByTableName: (tableName) => {
			const modelName = tableToModel.get(tableName);
			const schema = modelName ? schemas.get(modelName) : undefined;
			return schema ? { schema, tableName } : undefined;
		},
		has: (name) => schemas.has(name),
		getAll: () => [...schemas.values()],
		getNames: () => [...schemas.keys()],
		size: schemas.size,
		findModelByTableName: (tableName) =>
			tableName ? (tableToModel.get(tableName) ?? null) : null,
		getRelatedSchemas: () => [],
		isLocked: () => true,
		getCachedSelectFields: () => ["id"] as never,
	} as unknown as ISchemaRegistry;
}

describe("query-translator: relation-WHERE on UPDATE/DELETE (Part 4)", () => {
	it("plain UPDATE without relation conditions is unchanged (no subquery)", () => {
		const translator = new PostgresQueryTranslator(
			createRelationalSchemaRegistry(),
		);
		const query: QueryUpdateObject<any> = {
			type: "update",
			table: "posts",
			data: { status: "archived" },
			where: { id: { $eq: 5 } },
		};

		const result = translator.translate(query);

		expect(result.sql).not.toContain(" IN (SELECT");
		expect(result.sql).toBe(
			'UPDATE "posts" SET "status" = $1 WHERE "posts"."id" = $2 RETURNING "posts"."id"',
		);
		expect(result.params).toEqual(["archived", 5]);
	});

	it("plain DELETE without relation conditions is unchanged (no subquery)", () => {
		const translator = new PostgresQueryTranslator(
			createRelationalSchemaRegistry(),
		);
		const query: QueryDeleteObject<any> = {
			type: "delete",
			table: "posts",
			where: { id: { $eq: 5 } },
		};

		const result = translator.translate(query);

		expect(result.sql).not.toContain(" IN (SELECT");
		expect(result.sql).toBe(
			'DELETE FROM "posts" WHERE "posts"."id" = $1 RETURNING "posts"."id"',
		);
		expect(result.params).toEqual([5]);
	});

	it("UPDATE with $or across a scalar branch and a relation branch preserves LEFT JOIN (NULL-FK rows still match via draft branch)", () => {
		const translator = new PostgresQueryTranslator(
			createRelationalSchemaRegistry(),
		);
		const query: QueryUpdateObject<any> = {
			type: "update",
			table: "posts",
			data: { status: "flagged" },
			where: {
				$or: [{ status: "draft" }, { author: { verified: true } }],
			},
		};

		const result = translator.translate(query);

		// Must be an id-subquery, not FROM/USING (which would turn LEFT JOIN
		// into INNER JOIN and drop NULL-FK rows even for the draft branch).
		expect(result.sql).toContain(
			'"posts"."id" IN (SELECT "posts"."id" FROM "posts"',
		);
		expect(result.sql).toContain("LEFT JOIN");
		expect(result.sql).not.toContain(" USING ");
		expect(result.sql).not.toMatch(/FROM "authors" AS "author"\s+WHERE/);

		// SET param ($1) comes first, then the subquery's WHERE params.
		expect(result.params[0]).toBe("flagged");
		expect(result.params).toContain("draft");
		expect(result.params).toContain(true);

		// Placeholder count must match params length, strictly increasing $n.
		const placeholders = [...result.sql.matchAll(/\$(\d+)/g)].map((m) =>
			Number(m[1]),
		);
		expect(new Set(placeholders).size).toBe(result.params.length);
		expect(Math.max(...placeholders)).toBe(result.params.length);
	});

	it("DELETE with a manyToMany nested relation condition dedupes ids via IN-subquery (no duplicate RETURNING rows possible from the join)", () => {
		const translator = new PostgresQueryTranslator(
			createRelationalSchemaRegistry(),
		);
		const query: QueryDeleteObject<any> = {
			type: "delete",
			table: "posts",
			where: {
				tags: { name: { $eq: "featured" } },
			},
		};

		const result = translator.translate(query);

		expect(result.sql).toContain(
			'"posts"."id" IN (SELECT "posts"."id" FROM "posts"',
		);
		expect(result.sql).toContain('LEFT JOIN "post_tags" AS "tags_junction"');
		expect(result.sql).toContain('LEFT JOIN "tags" AS "tags"');
		// The outer DELETE matches ids via IN, so even though the inner
		// SELECT may produce multiple rows per matching post (one per tag),
		// the DELETE itself only ever touches each id once and RETURNING
		// cannot produce duplicate ids.
		expect(result.sql.match(/DELETE FROM/g)?.length).toBe(1);
		expect(result.params).toEqual(["featured"]);
	});

	it("param ordering: UPDATE SET values and relation-WHERE params share one $n sequence in allocation order", () => {
		const translator = new PostgresQueryTranslator(
			createRelationalSchemaRegistry(),
		);
		const query: QueryUpdateObject<any> = {
			type: "update",
			table: "posts",
			data: { status: "archived", authorId: 9 },
			where: {
				author: { verified: false },
			},
		};

		const result = translator.translate(query);

		// SET params are allocated first (status, authorId), so they must be
		// $1 and $2; the relation-WHERE param (verified: false) must be $3.
		expect(result.sql).toContain('SET "status" = $1, "authorId" = $2');
		expect(result.params).toEqual(["archived", 9, false]);

		const placeholders = [...result.sql.matchAll(/\$(\d+)/g)].map((m) =>
			Number(m[1]),
		);
		expect(new Set(placeholders)).toEqual(new Set([1, 2, 3]));
	});
});
