/**
 * idType (int | uuid) — registry, id utilities, query builder normalization,
 * validator and executor id assignment.
 */

import { describe, it, expect } from "vitest";
import { SchemaRegistry } from "../../src/schema";
import type { SchemaDefinition } from "../../src/types/core/schema";
import {
	assignIds,
	generateUuidV7,
	isCanonicalUuid,
	normalizeIdValue,
	normalizeUuid,
} from "../../src/schema/id";
import { insertInto, selectFrom } from "../../src/query-builder/builder";
import {
	getMigrationSchema,
	getDatrixMetaSchema,
} from "../../src/migration/schema";
import { validateField } from "../../src/validator/field-validator";

const UUID_A = "0190a3f2-7b1c-7d2e-8f3a-1b2c3d4e5f60";
const UUID_B = "0190a3f2-7b1c-7d2e-8f3a-1b2c3d4e5f61";

function buildRegistry(idType: "int" | "uuid"): SchemaRegistry {
	const registry = new SchemaRegistry({
		strict: true,
		allowOverwrite: false,
		validateRelations: true,
		idType,
	});
	registry.register(getDatrixMetaSchema());
	const schemas: SchemaDefinition[] = [
		{
			name: "user",
			fields: { name: { type: "string" } },
		},
		{
			name: "tag",
			fields: { label: { type: "string" } },
		},
		{
			name: "post",
			fields: {
				title: { type: "string" },
				author: { type: "relation", kind: "belongsTo", model: "user" },
				tags: { type: "relation", kind: "manyToMany", model: "tag" },
				comments: { type: "relation", kind: "hasMany", model: "comment" },
			},
		},
		{
			name: "comment",
			fields: { body: { type: "string" } },
		},
	];
	for (const s of schemas) registry.register(s);
	registry.register(getMigrationSchema());
	registry.finalizeRegistry();
	return registry;
}

describe("id utilities", () => {
	it("generates canonical, versioned, time-ordered UUID v7", () => {
		const a = generateUuidV7(1_700_000_000_000);
		const b = generateUuidV7(1_700_000_000_001);
		expect(isCanonicalUuid(a)).toBe(true);
		expect(a[14]).toBe("7");
		expect(["8", "9", "a", "b"]).toContain(a[19]);
		expect(a < b).toBe(true);
		expect(a.slice(0, 13)).toBe("018bcfe5-6800");
	});

	it("normalizes uuid case and rejects non-uuids", () => {
		expect(normalizeUuid(UUID_A.toUpperCase())).toBe(UUID_A);
		expect(normalizeUuid("abc")).toBeUndefined();
		expect(normalizeUuid(5)).toBeUndefined();
	});

	it("normalizes ids per kind", () => {
		expect(normalizeIdValue("5", "number")).toBe(5);
		expect(normalizeIdValue("5.5", "number")).toBeUndefined();
		expect(normalizeIdValue(UUID_A, "number")).toBeUndefined();
		expect(normalizeIdValue(5, "uuid")).toBeUndefined();
	});
});

describe("SchemaRegistry idType", () => {
	it("int mode keeps the legacy number/autoIncrement definitions", () => {
		const registry = buildRegistry("int");
		expect(registry.get("post")!.fields["id"]).toEqual({
			type: "number",
			primary: true,
			autoIncrement: true,
			required: true,
		});
		expect(registry.get("post")!.fields["authorId"]!.type).toBe("number");
		expect(registry.get("comment")!.fields["postId"]!.type).toBe("number");
		const junction = registry.getAll().find((s) => s._isJunctionTable)!;
		expect(junction.fields["id"]).toEqual({
			type: "number",
			required: false,
			autoIncrement: true,
		});
	});

	it("uuid mode uses uuid for ids, foreign keys and junction columns", () => {
		const registry = buildRegistry("uuid");
		expect(registry.getIdType()).toBe("uuid");
		expect(registry.get("post")!.fields["id"]!.type).toBe("uuid");
		expect(registry.get("post")!.fields["authorId"]!.type).toBe("uuid");
		expect(registry.get("comment")!.fields["postId"]!.type).toBe("uuid");
		const junction = registry.getAll().find((s) => s._isJunctionTable)!;
		for (const field of Object.values(junction.fields)) {
			if (field.type !== "relation") expect(field.type).toBe("uuid");
		}
	});

	it("internal schemas always keep integer ids", () => {
		const registry = buildRegistry("uuid");
		expect(registry.get("_datrix")!.fields["id"]!.type).toBe("number");
		expect(registry.get("_datrix_migration")!.fields["id"]!.type).toBe(
			"number",
		);
	});

	it("rejects changing idType after user schemas are registered", () => {
		const registry = new SchemaRegistry();
		registry.register({ name: "user", fields: { name: { type: "string" } } });
		expect(() => registry.setIdType("uuid")).toThrow();
	});
});

describe("Query builder id normalization", () => {
	it("uuid mode: relation ids are case-normalized and FK is inlined", () => {
		const registry = buildRegistry("uuid");
		const query = insertInto(
			"post",
			{
				title: "x",
				author: UUID_A.toUpperCase(),
				tags: [UUID_A, { id: UUID_B }],
			} as never,
			registry,
		).build();
		const data = (query as { data: Record<string, unknown>[] }).data[0]!;
		expect(data["authorId"]).toBe(UUID_A);
		const relations = (
			query as { relations?: Record<string, { set?: unknown[] }> }
		).relations!;
		expect(relations["tags"]!.set).toEqual([UUID_A, UUID_B]);
	});

	it("uuid mode: numeric relation ids are rejected", () => {
		const registry = buildRegistry("uuid");
		expect(() =>
			insertInto("post", { title: "x", author: 5 } as never, registry).build(),
		).toThrow();
	});

	it("int mode: numeric strings are coerced, uuids rejected", () => {
		const registry = buildRegistry("int");
		const query = insertInto(
			"post",
			{ title: "x", author: "7" } as never,
			registry,
		).build();
		const data = (query as { data: Record<string, unknown>[] }).data[0]!;
		expect(data["authorId"]).toBe(7);
		expect(() =>
			insertInto(
				"post",
				{ title: "x", author: UUID_A } as never,
				registry,
			).build(),
		).toThrow();
	});

	it("uuid mode: where on id / FK / relation shortcut is normalized", () => {
		const registry = buildRegistry("uuid");
		const query = selectFrom("post", registry)
			.where({
				id: UUID_A.toUpperCase(),
				author: UUID_B.toUpperCase(),
			} as never)
			.build();
		const where = (query as { where: Record<string, unknown> }).where;
		expect(where["id"]).toBe(UUID_A);
		expect(where["authorId"]).toEqual({ $eq: UUID_B });
	});

	it("uuid mode: invalid uuid in where throws", () => {
		const registry = buildRegistry("uuid");
		expect(() =>
			selectFrom("post", registry)
				.where({ id: "nope" } as never)
				.build(),
		).toThrow();
	});
});

describe("Validator uuid", () => {
	it("accepts canonical uuids and rejects others", () => {
		const field = { type: "uuid" } as const;
		expect(validateField(UUID_A, field, "id").success).toBe(true);
		expect(validateField(UUID_A.toUpperCase(), field, "id").success).toBe(
			false,
		);
		expect(validateField(5, field, "id").success).toBe(false);
	});

	it("relation shortcut accepts integer or uuid ids", () => {
		const field = {
			type: "relation",
			kind: "belongsTo",
			model: "user",
		} as const;
		expect(validateField(UUID_A, field, "author").success).toBe(true);
		expect(validateField(3, field, "author").success).toBe(true);
		expect(validateField("abc", field, "author").success).toBe(false);
	});
});

describe("assignIds", () => {
	it("generates ids only for uuid schemas and keeps provided ids", () => {
		const uuidRegistry = buildRegistry("uuid");
		const intRegistry = buildRegistry("int");
		const [generated, kept] = assignIds(
			[{ title: "a" }, { title: "b", id: UUID_A }],
			uuidRegistry.get("post")!,
		);
		expect(isCanonicalUuid(generated!["id"])).toBe(true);
		expect(kept!["id"]).toBe(UUID_A);
		const [intRow] = assignIds([{ title: "a" }], intRegistry.get("post")!);
		expect(intRow).toEqual({ title: "a" });
	});
});
