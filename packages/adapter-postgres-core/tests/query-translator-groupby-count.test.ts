/**
 * Tests for countMany's groupBy/having contract in the Postgres translator.
 *
 * The COUNT branch used to emit a fixed `SELECT COUNT(*)` regardless of
 * `groupBy` — the group's own field values never made it into the result
 * row, only a single total. These tests lock in that a grouped COUNT
 * selects the group fields alongside `COUNT(*) AS count` and groups by the
 * same fields, so the adapter can read `{ ...groupFields, count }` back off
 * each row.
 */
import { describe, expect, it } from "vitest";
import type {
	ISchemaRegistry,
	QueryCountObject,
	SchemaDefinition,
} from "@datrix/core";
import { PostgresQueryTranslator } from "../src/query-translator";

function createUserSchemaRegistry(): ISchemaRegistry {
	const userSchema: SchemaDefinition = {
		name: "User",
		tableName: "users",
		fields: {
			id: { type: "number" },
			email: { type: "string" },
			isActive: { type: "boolean" },
		} as unknown as SchemaDefinition["fields"],
	};

	const schemas = new Map<string, SchemaDefinition>([["User", userSchema]]);
	const tableToModel = new Map<string, string>([["users", "User"]]);

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

describe("query-translator: countMany groupBy/having", () => {
	it("selects the group fields alongside COUNT(*) and groups by them", () => {
		const translator = new PostgresQueryTranslator(createUserSchemaRegistry());
		const query: QueryCountObject<any> = {
			type: "count",
			table: "users",
			groupBy: ["isActive"],
		};

		const { sql } = translator.translate(query);

		expect(sql).toContain('SELECT "users"."isActive", COUNT(*) AS count');
		expect(sql).toContain('GROUP BY "users"."isActive"');
	});

	it("keeps the plain SELECT COUNT(*) shape when there is no groupBy", () => {
		const translator = new PostgresQueryTranslator(createUserSchemaRegistry());
		const query: QueryCountObject<any> = {
			type: "count",
			table: "users",
		};

		const { sql } = translator.translate(query);

		expect(sql).toContain("SELECT COUNT(*)");
		expect(sql).not.toContain("GROUP BY");
	});

	it("applies where before grouping and having after", () => {
		const translator = new PostgresQueryTranslator(createUserSchemaRegistry());
		const query: QueryCountObject<any> = {
			type: "count",
			table: "users",
			where: { email: { $startsWith: "agg-" } },
			groupBy: ["isActive"],
			having: { isActive: { $eq: true } },
		};

		const { sql } = translator.translate(query);

		const whereIdx = sql.indexOf("WHERE");
		const groupByIdx = sql.indexOf("GROUP BY");
		const havingIdx = sql.indexOf("HAVING");

		expect(whereIdx).toBeGreaterThan(-1);
		expect(groupByIdx).toBeGreaterThan(whereIdx);
		expect(havingIdx).toBeGreaterThan(groupByIdx);
	});

	it("switches to COUNT(DISTINCT id) alongside group fields when the WHERE needs a JOIN", () => {
		// Reuse the relational fixture style: a relation-WHERE forces a JOIN,
		// which the non-grouped path already compensates for via
		// COUNT(DISTINCT id) — the grouped path must do the same, keeping the
		// group fields in the SELECT list.
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
		const schemas = new Map<string, SchemaDefinition>([
			["Post", postsSchema],
			["Author", authorsSchema],
		]);
		const tableToModel = new Map<string, string>([
			["posts", "Post"],
			["authors", "Author"],
		]);
		const registry = {
			register: (schema: SchemaDefinition) => schema,
			get: (name: string) => schemas.get(name),
			getWithTableName: (modelName: string) => {
				const schema = schemas.get(modelName);
				return schema ? { schema, tableName: schema.tableName! } : undefined;
			},
			getByTableName: (tableName: string) => {
				const modelName = tableToModel.get(tableName);
				const schema = modelName ? schemas.get(modelName) : undefined;
				return schema ? { schema, tableName } : undefined;
			},
			has: (name: string) => schemas.has(name),
			getAll: () => [...schemas.values()],
			getNames: () => [...schemas.keys()],
			size: schemas.size,
			findModelByTableName: (tableName: string) =>
				tableName ? (tableToModel.get(tableName) ?? null) : null,
			getRelatedSchemas: () => [],
			isLocked: () => true,
			getCachedSelectFields: () => ["id"] as never,
		} as unknown as ISchemaRegistry;

		const translator = new PostgresQueryTranslator(registry);
		const query: QueryCountObject<any> = {
			type: "count",
			table: "posts",
			where: { author: { verified: { $eq: true } } },
			groupBy: ["status"],
		};

		const { sql } = translator.translate(query);

		expect(sql).toContain(
			'SELECT "posts"."status", COUNT(DISTINCT "posts"."id") AS count',
		);
		expect(sql).toContain('GROUP BY "posts"."status"');
	});
});
