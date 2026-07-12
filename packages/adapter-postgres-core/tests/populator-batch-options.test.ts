/**
 * Tests for Part 2 (per-relation limit/offset via window function) and
 * Part 5 (populate `where` for belongsTo/hasOne in the batched strategy) from
 * `packages/adapter-postgres-core/issue.md`.
 *
 * These are unit-level tests: a fake schema registry backs a small relational
 * schema (posts -> author (belongsTo), profile (hasOne), comments (hasMany),
 * tags (manyToMany)), and a fake PgConnection records every SQL/params call so
 * we can assert on the generated SQL without a real database.
 */
import { describe, expect, it } from "vitest";
import type {
	ISchemaRegistry,
	QuerySelectObject,
	SchemaDefinition,
} from "@datrix/core";
import { DatrixAdapterError } from "@datrix/core";
import { PostgresQueryTranslator } from "../src/query-translator";
import { PostgresPopulator } from "../src/populate/populator";
import { PgClient } from "../src/pg-client";
import type { PgQueryResult } from "../src/driver";
import { FakeConnection } from "./test-helpers";

/**
 * Fake schema registry:
 * - posts: belongsTo author (FK authorId), hasOne profile (target FK postId),
 *   hasMany comments (target FK postId), manyToMany tags (through post_tags)
 * - authors: target of belongsTo
 * - profiles: target of hasOne
 * - comments: target of hasMany
 * - tags: target of manyToMany
 */
function createSchemaRegistry(): ISchemaRegistry {
	const postsSchema: SchemaDefinition = {
		name: "Post",
		tableName: "posts",
		fields: {
			id: { type: "number" },
			title: { type: "string" },
			authorId: { type: "number", hidden: true },
			author: {
				type: "relation",
				kind: "belongsTo",
				model: "Author",
				foreignKey: "authorId",
			},
			profile: {
				type: "relation",
				kind: "hasOne",
				model: "Profile",
				foreignKey: "postId",
			},
			comments: {
				type: "relation",
				kind: "hasMany",
				model: "Comment",
				foreignKey: "postId",
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
			name: { type: "string" },
			verified: { type: "boolean" },
			// Inverse relation used only to exercise the "nested relation filter
			// inside populate-where" rejection path (Part 5).
			posts: {
				type: "relation",
				kind: "hasMany",
				model: "Post",
				foreignKey: "authorId",
			},
		} as unknown as SchemaDefinition["fields"],
	};

	const profilesSchema: SchemaDefinition = {
		name: "Profile",
		tableName: "profiles",
		fields: {
			id: { type: "number" },
			postId: { type: "number", hidden: true },
			bio: { type: "string" },
			// Inverse relation used only to give the hasOne populate a nested
			// populate target (forces depth > 1 => batched strategy).
			post: {
				type: "relation",
				kind: "belongsTo",
				model: "Post",
				foreignKey: "postId",
			},
		} as unknown as SchemaDefinition["fields"],
	};

	const commentsSchema: SchemaDefinition = {
		name: "Comment",
		tableName: "comments",
		fields: {
			id: { type: "number" },
			postId: { type: "number", hidden: true },
			body: { type: "string" },
			createdAt: { type: "date" },
			// Inverse relation used only to exercise the "nested relation filter
			// inside populate-where" rejection path (Part 5).
			post: {
				type: "relation",
				kind: "belongsTo",
				model: "Post",
				foreignKey: "postId",
			},
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
		["Profile", profilesSchema],
		["Comment", commentsSchema],
		["Tag", tagsSchema],
	]);

	const tableToModel = new Map<string, string>([
		["posts", "Post"],
		["authors", "Author"],
		["profiles", "Profile"],
		["comments", "Comment"],
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

/**
 * Build a populator wired to a fake connection whose `query` handler is
 * invoked for every SQL call (main query + batch queries). The handler
 * receives (sql, params) in call order.
 */
function createPopulator(
	handler: (
		sql: string,
		params: readonly unknown[],
	) => PgQueryResult<any> | Promise<PgQueryResult<any>>,
): { populator: PostgresPopulator; connection: FakeConnection } {
	const registry = createSchemaRegistry();
	const translator = new PostgresQueryTranslator(registry);
	const connection = new FakeConnection(handler);
	const client = new PgClient(connection, {
		type: "select",
		table: "posts",
	} as any);
	const populator = new PostgresPopulator(client, translator, registry);
	return { populator, connection };
}

describe("populator: Part 2 - per-relation limit/offset (window function)", () => {
	it("hasMany populate with limit uses ROW_NUMBER PARTITION BY fk, no OFFSET clause", async () => {
		const { populator, connection } = createPopulator((sql) => {
			if (sql.includes('FROM "posts"') && !sql.includes("comments")) {
				return {
					rows: [{ id: 1 }, { id: 2 }, { id: 3 }],
					rowCount: 3,
				};
			}
			// batched comments query
			return { rows: [], rowCount: 0 };
		});

		const query: QuerySelectObject<any> = {
			type: "select",
			table: "posts",
			select: ["id"],
			populate: {
				comments: { select: ["id", "body"], limit: 2 },
			},
		};

		await populator.populate(query);

		const batchCall = connection.calls.find((c) => c.sql.includes("comments"));
		expect(batchCall).toBeDefined();
		expect(batchCall!.sql).toContain("ROW_NUMBER() OVER (PARTITION BY");
		expect(batchCall!.sql).toContain('t."postId"');
		expect(batchCall!.sql).toContain("_rn");
		expect(batchCall!.sql).toContain("w._rn > 0");
		expect(batchCall!.sql).toContain("w._rn <= $2");
		expect(batchCall!.params).toEqual([[1, 2, 3], 2]);
	});

	it("hasMany populate with limit and offset bounds _rn correctly", async () => {
		const { populator, connection } = createPopulator((sql) => {
			if (sql.includes('FROM "posts"') && !sql.includes("comments")) {
				return { rows: [{ id: 1 }, { id: 2 }], rowCount: 2 };
			}
			return { rows: [], rowCount: 0 };
		});

		const query: QuerySelectObject<any> = {
			type: "select",
			table: "posts",
			select: ["id"],
			populate: {
				comments: { select: ["id"], limit: 5, offset: 10 },
			},
		};

		await populator.populate(query);

		const batchCall = connection.calls.find((c) => c.sql.includes("comments"));
		expect(batchCall).toBeDefined();
		expect(batchCall!.sql).toContain("w._rn > $2");
		expect(batchCall!.sql).toContain("w._rn <= $3");
		// offset (10) then offset+limit (15)
		expect(batchCall!.params).toEqual([[1, 2], 10, 15]);
	});

	it("hasMany populate without limit/offset uses plain ANY($1), no window function", async () => {
		const { populator, connection } = createPopulator((sql) => {
			if (sql.includes('FROM "posts"') && !sql.includes("comments")) {
				return { rows: [{ id: 1 }], rowCount: 1 };
			}
			return { rows: [], rowCount: 0 };
		});

		const query: QuerySelectObject<any> = {
			type: "select",
			table: "posts",
			select: ["id"],
			populate: {
				comments: {
					select: ["id"],
					orderBy: [{ field: "id", direction: "asc" }],
				},
			},
		};

		await populator.populate(query);

		const batchCall = connection.calls.find((c) => c.sql.includes("comments"));
		expect(batchCall).toBeDefined();
		expect(batchCall!.sql).not.toContain("ROW_NUMBER");
		expect(batchCall!.sql).not.toContain("_rn");
		expect(batchCall!.sql).toContain('t."postId" = ANY($1)');
		expect(batchCall!.sql).toContain("ORDER BY");
		expect(batchCall!.params).toEqual([[1]]);
	});

	it("manyToMany populate with limit partitions by the junction sourceFK", async () => {
		const { populator, connection } = createPopulator((sql) => {
			if (sql.includes('FROM "posts"') && !sql.includes("tags")) {
				return { rows: [{ id: 1 }, { id: 2 }], rowCount: 2 };
			}
			return { rows: [], rowCount: 0 };
		});

		const query: QuerySelectObject<any> = {
			type: "select",
			table: "posts",
			select: ["id"],
			populate: {
				tags: { select: ["id", "name"], limit: 3 },
			},
		};

		await populator.populate(query);

		const batchCall = connection.calls.find((c) => c.sql.includes("post_tags"));
		expect(batchCall).toBeDefined();
		expect(batchCall!.sql).toContain("ROW_NUMBER() OVER (PARTITION BY");
		expect(batchCall!.sql).toContain('j."PostId"');
		expect(batchCall!.sql).toContain("INNER JOIN");
		expect(batchCall!.params).toEqual([[1, 2], 3]);
	});
});

describe("populator: Part 5 - populate where for belongsTo/hasOne (batched strategy)", () => {
	it("belongsTo populate with where includes the where clause in the batched SQL", async () => {
		const { populator, connection } = createPopulator((sql) => {
			if (sql.includes('FROM "authors"')) {
				// Only author 10 is verified; 11 does not match -> null
				return {
					rows: [{ _fk: 10, data: { id: 10, name: "Alice" } }],
					rowCount: 1,
				};
			}
			if (sql.includes('FROM "posts"')) {
				return {
					rows: [
						{ id: 1, authorId: 10 },
						{ id: 2, authorId: 11 },
					],
					rowCount: 2,
				};
			}
			return { rows: [], rowCount: 0 };
		});

		// Depth > 1 forces the batched strategy (author has a nested populate).
		const query: QuerySelectObject<any> = {
			type: "select",
			table: "posts",
			select: ["id"],
			populate: {
				author: {
					select: ["id", "name"],
					where: { verified: { $eq: true } },
					populate: { posts: { select: ["id"] } } as any,
				},
			},
		};

		const rows = await populator.populate(query);

		const authorCall = connection.calls.find((c) => c.sql.includes("authors"));
		expect(authorCall).toBeDefined();
		expect(authorCall!.sql).toContain('WHERE t."id" = ANY($1)');
		expect(authorCall!.sql).toContain("AND");
		expect(authorCall!.params).toEqual([[10, 11], true]);

		// Row 2's author (11) did not match the where -> relation is null.
		expect((rows[1] as any).author).toBeNull();
		// Row 1's author (10) matched; the nested `posts` populate ran too
		// (empty result from the fake connection) and is attached alongside
		// the selected fields.
		expect((rows[0] as any).author).toEqual({
			id: 10,
			name: "Alice",
			posts: [],
		});
	});

	it("hasOne populate with where includes the where clause in the batched SQL (nested/populateBatchedRows path)", async () => {
		const { populator, connection } = createPopulator((sql) => {
			if (sql.includes('FROM "posts"')) {
				return { rows: [{ id: 1 }, { id: 2 }], rowCount: 2 };
			}
			// profiles batch (and any nested "post" lookup) returns no rows
			return { rows: [], rowCount: 0 };
		});

		const query: QuerySelectObject<any> = {
			type: "select",
			table: "posts",
			select: ["id"],
			populate: {
				profile: {
					select: ["id", "bio"],
					where: { bio: { $ne: null } },
					populate: { post: { select: ["id"] } } as any,
				},
			},
		};

		await populator.populate(query);

		const profileCall = connection.calls.find((c) =>
			c.sql.includes("profiles"),
		);
		expect(profileCall).toBeDefined();
		expect(profileCall!.sql).toContain("AND");
		expect(profileCall!.params[0]).toEqual([1, 2]);
	});
});

describe("populator: Part 5 - nested relation filter in populate-where rejected", () => {
	it("hasMany populate-where with a nested relation condition throws DatrixAdapterError", async () => {
		const { populator } = createPopulator((sql) => {
			if (sql.includes('FROM "posts"') && !sql.includes("comments")) {
				return { rows: [{ id: 1 }], rowCount: 1 };
			}
			return { rows: [], rowCount: 0 };
		});

		const query: QuerySelectObject<any> = {
			type: "select",
			table: "posts",
			select: ["id"],
			populate: {
				// limit forces the window/batch path through buildOneToManyBatchQuery
				comments: {
					select: ["id"],
					limit: 2,
					where: { post: { author: { verified: true } } } as any,
				},
			},
		};

		await expect(populator.populate(query)).rejects.toThrow(DatrixAdapterError);
	});

	it("belongsTo populate-where with a nested relation condition throws DatrixAdapterError", async () => {
		const { populator } = createPopulator((sql) => {
			if (sql.includes('FROM "posts"')) {
				return { rows: [{ id: 1, authorId: 10 }], rowCount: 1 };
			}
			return { rows: [], rowCount: 0 };
		});

		const query: QuerySelectObject<any> = {
			type: "select",
			table: "posts",
			select: ["id"],
			populate: {
				author: {
					select: ["id"],
					where: { posts: { title: { $eq: "x" } } } as any,
					populate: { posts: { select: ["id"] } } as any,
				},
			},
		};

		await expect(populator.populate(query)).rejects.toThrow(DatrixAdapterError);
	});
});
