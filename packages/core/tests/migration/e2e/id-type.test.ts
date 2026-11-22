/**
 * Migration E2E Tests - idType switch (int ↔ uuid)
 *
 * Runs against whichever adapter `ADAPTER` selects. Verifies:
 * - the session detects an idType switch and refuses regular apply()
 * - idType + other schema changes together are rejected
 * - applyIdTypeChange rewrites ids, FKs and junction rows (both directions)
 * - creation order is preserved and new records keep working afterwards
 */

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { defineConfig, defineSchema } from "@datrix/core";
import type {
	Datrix,
	DatabaseAdapter,
	DatrixEntry,
	ExportMeta,
	ExportWriter,
	IdType,
	ImportReader,
	SchemaDefinition,
} from "@datrix/core";
import { getTmpDir } from "./setup/config";
import { getTestEnv } from "./setup/adapter";
import { dropAllTables } from "./setup/helpers";
import { isCanonicalUuid } from "../../../src/schema/id";

interface Author extends DatrixEntry {
	name: string;
	posts?: Post[];
}

interface Tag extends DatrixEntry {
	label: string;
}

interface Post extends DatrixEntry {
	title: string;
	author?: Author | null;
	tags?: Tag[];
}

const authorSchema = defineSchema({
	name: "idAuthor",
	fields: {
		name: { type: "string", required: true },
		posts: { type: "relation", kind: "hasMany", model: "idPost" },
	},
});

const tagSchema = defineSchema({
	name: "idTag",
	fields: {
		label: { type: "string", required: true },
	},
});

const postSchema = defineSchema({
	name: "idPost",
	fields: {
		title: { type: "string", required: true },
		author: { type: "relation", kind: "belongsTo", model: "idAuthor" },
		tags: { type: "relation", kind: "manyToMany", model: "idTag" },
	},
});

const schemas = [authorSchema, tagSchema, postSchema];

/**
 * In-memory backup, JSON round-tripped like the CLI zip (dates revived
 * per schema, as the CLI's CSV decoder does)
 */
function createMemoryBackup(): {
	writer: ExportWriter;
	open: () => ImportReader;
} {
	let meta: ExportMeta = { version: 1, exportedAt: "" };
	const schemaList: SchemaDefinition[] = [];
	const chunks = new Map<string, string[]>();

	const writer: ExportWriter = {
		async writeMeta(m) {
			meta = m;
		},
		async writeSchema(schema) {
			schemaList.push(JSON.parse(JSON.stringify(schema)));
		},
		async writeChunk(tableName, rows) {
			const list = chunks.get(tableName) ?? [];
			list.push(JSON.stringify(rows));
			chunks.set(tableName, list);
		},
		async finalize() {},
	};

	const open = (): ImportReader => ({
		async readMeta() {
			return meta;
		},
		async *readSchemas() {
			for (const schema of schemaList) yield schema;
		},
		async getTables() {
			return [...chunks.keys()];
		},
		async *readChunks(tableName) {
			// Like the CLI reader: revive date fields from the exported schema
			const schema = schemaList.find(
				(s) => (s.tableName ?? s.name) === tableName,
			);
			const dateFields = Object.entries(schema?.fields ?? {})
				.filter(([, field]) => field.type === "date")
				.map(([name]) => name);
			for (const chunk of chunks.get(tableName) ?? []) {
				const rows = JSON.parse(chunk) as Record<string, unknown>[];
				for (const row of rows) {
					for (const name of dateFields) {
						const value = row[name];
						if (typeof value === "string") row[name] = new Date(value);
					}
				}
				yield rows;
			}
		},
	});

	return { writer, open };
}

describe("Migration E2E - idType switch", () => {
	const tmpDir = getTmpDir("id-type");
	let adapter: DatabaseAdapter;
	let current: Datrix | undefined;

	async function boot(
		idType: IdType,
		list: readonly SchemaDefinition[] = schemas,
	): Promise<Datrix> {
		if (current) await current.shutdown();
		const { adapter: instanceAdapter } = await getTestEnv(tmpDir, {
			skipCreate: true,
		});
		const factory = defineConfig(() => ({
			adapter: instanceAdapter,
			idType,
			schemas: [...list],
			plugins: [],
			migration: { modelName: "_datrix_migration" },
		}));
		current = await factory();
		return current;
	}

	async function migrate(datrix: Datrix): Promise<void> {
		const session = await datrix.beginMigrate();
		await session.apply();
	}

	async function convert(datrix: Datrix) {
		const session = await datrix.beginMigrate();
		const backup = createMemoryBackup();
		return session.applyIdTypeChange({
			backup: backup.writer,
			openBackup: backup.open,
		});
	}

	async function readGraph(datrix: Datrix) {
		const authors = await datrix.findMany<Author>("idAuthor", {
			populate: { posts: true },
			orderBy: [{ field: "id", direction: "asc" }],
		} as never);
		const posts = await datrix.findMany<Post>("idPost", {
			populate: { author: true, tags: true },
			orderBy: [{ field: "id", direction: "asc" }],
		} as never);
		return {
			authors: authors.map((a) => ({
				name: a.name,
				posts: (a.posts ?? []).map((p) => p.title).sort(),
			})),
			posts: posts.map((p) => ({
				title: p.title,
				author: p.author?.name ?? null,
				tags: (p.tags ?? []).map((t) => t.label).sort(),
			})),
			authorIds: authors.map((a) => a.id),
		};
	}

	beforeAll(async () => {
		({ adapter } = await getTestEnv(tmpDir));
		await adapter.connect();
		await dropAllTables(adapter);
	});

	afterAll(async () => {
		if (current) await current.shutdown();
		await dropAllTables(adapter);
		await adapter.disconnect();
	});

	it("converts int → uuid → int preserving relations and order", async () => {
		// Seed with integer ids
		const intDb = await boot("int");
		await migrate(intDb);

		const tags = await intDb.createMany<Tag>("idTag", [
			{ label: "a" },
			{ label: "b" },
		]);
		const ada = await intDb.create<Author>("idAuthor", { name: "Ada" });
		await new Promise((r) => setTimeout(r, 5));
		const bob = await intDb.create<Author>("idAuthor", { name: "Bob" });
		await intDb.create("idPost", {
			title: "p1",
			author: ada.id,
			tags: tags.map((t) => t.id),
		} as never);
		await intDb.create("idPost", {
			title: "p2",
			author: bob.id,
			tags: [tags[1]!.id],
		} as never);
		await intDb.create("idPost", { title: "p3" } as never);

		const before = await readGraph(intDb);

		// Switch to uuid
		const uuidDb = await boot("uuid");
		const session = await uuidDb.beginMigrate();
		expect(session.idTypeChange).toEqual({ from: "int", to: "uuid" });
		expect(session.hasChanges()).toBe(true);
		await expect(session.apply()).rejects.toThrow(/applyIdTypeChange/);

		const toUuid = await convert(uuidDb);
		const authorTable = uuidDb.getSchemas().get("idAuthor")!.tableName!;
		expect(Object.keys(toUuid.mapping[authorTable] ?? {})).toHaveLength(2);
		expect(toUuid.nulledReferences).toBe(0);

		const afterUuid = await readGraph(uuidDb);
		expect(afterUuid.authors).toEqual(before.authors);
		expect(afterUuid.posts).toEqual(before.posts);
		for (const id of afterUuid.authorIds) {
			expect(isCanonicalUuid(id)).toBe(true);
		}

		// Nothing left to migrate, new records get uuids
		const settled = await uuidDb.beginMigrate();
		expect(settled.hasChanges()).toBe(false);
		const carl = await uuidDb.create<Author>("idAuthor", { name: "Carl" });
		expect(isCanonicalUuid(carl.id)).toBe(true);
		await uuidDb.create("idPost", { title: "p4", author: carl.id } as never);

		const beforeBack = await readGraph(uuidDb);

		// And back to int
		const backDb = await boot("int");
		const backSession = await backDb.beginMigrate();
		expect(backSession.idTypeChange).toEqual({ from: "uuid", to: "int" });
		await convert(backDb);

		const afterInt = await readGraph(backDb);
		expect(afterInt.authors).toEqual(beforeBack.authors);
		expect(afterInt.posts).toEqual(beforeBack.posts);
		expect(afterInt.authorIds).toEqual([1, 2, 3]);

		// Sequences / counters continue after the highest id
		const dan = await backDb.create<Author>("idAuthor", { name: "Dan" });
		expect(dan.id).toBe(4);
		expect((await backDb.beginMigrate()).hasChanges()).toBe(false);
	});

	it("rejects an idType switch combined with other schema changes", async () => {
		await dropAllTables(adapter);
		const intDb = await boot("int");
		await migrate(intDb);
		await intDb.create("idTag", { label: "x" });

		const changedTag = defineSchema({
			name: "idTag",
			fields: {
				label: { type: "string", required: true },
				color: { type: "string" },
			},
		});
		const uuidDb = await boot("uuid", [authorSchema, changedTag, postSchema]);
		await expect(uuidDb.beginMigrate()).rejects.toThrow(/other schema change/);
	});
});
