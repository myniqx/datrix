/**
 * Playground Data Generator
 *
 * Generates static playground scenarios for the forjaweb landing page.
 * Run with: pnpm generate-playground
 *
 * Output: forjaweb/src/data/playground.json
 */

import { describe, it, beforeAll, afterAll } from "vitest";
import { Forja } from "forja-core";
import fs from "node:fs/promises";
import path from "node:path";
import {
	createTestConfig,
	getTmpDir,
	setupTables,
	seedBasicData,
	seedPosts,
	testSchemas,
	type SeedResult,
} from "../end-to-end/setup";

// ============================================================================
// Output types
// ============================================================================

type ForjaAction =
	| "create"
	| "createMany"
	| "findMany"
	| "count"
	| "update"
	| "updateMany"
	| "delete"
	| "deleteMany";

interface PlaygroundScenario {
	id: string;
	label: string;
	action: ForjaAction;
	model: string;
	/** findMany options: where, select, populate, limit, offset, orderBy */
	query?: unknown;
	/** data for create / createMany / update / updateMany */
	data?: unknown;
	/** id argument for update() and delete() */
	idArg?: number;
	output: unknown;

	options?: unknown; // Additional options for update() and delete(), e.g., { populate: true }
}

interface PlaygroundGroup {
	id: "create" | "read" | "update" | "delete";
	label: string;
	scenarios: PlaygroundScenario[];
}

// ============================================================================
// Collector
// ============================================================================

const groups: PlaygroundGroup[] = [
	{ id: "create", label: "Create", scenarios: [] },
	{ id: "read", label: "Read", scenarios: [] },
	{ id: "update", label: "Update", scenarios: [] },
	{ id: "delete", label: "Delete", scenarios: [] },
];

function collect(
	groupId: PlaygroundGroup["id"],
	scenario: PlaygroundScenario,
): void {
	const group = groups.find((g) => g.id === groupId);
	group?.scenarios.push(scenario);
}

// ============================================================================
// Setup
// ============================================================================

let forja: Forja;
let seed: SeedResult;
const tmpDir = getTmpDir("playground");

beforeAll(async () => {
	await fs.rm(tmpDir, { recursive: true, force: true });
	await fs.mkdir(tmpDir, { recursive: true });

	const getForja = await createTestConfig(tmpDir);
	forja = await getForja();
	await setupTables(forja);

	seed = await seedBasicData(forja);
	const posts = await seedPosts(forja, seed);
	seed.posts = posts;
});

afterAll(async () => {
	const outputPath = path.resolve(
		process.cwd(),
		"forjaweb/src/data/playground.json",
	);

	// Serialize schemas — convert RegExp pattern fields to strings
	const schemas = testSchemas.map((schema) => ({
		...schema,
		fields: Object.fromEntries(
			Object.entries(schema.fields).map(([key, def]) => {
				const field = def as Record<string, unknown>;
				if (field["pattern"] instanceof RegExp) {
					return [key, { ...field, pattern: field["pattern"].toString() }];
				}
				return [key, field];
			}),
		),
	}));

	const output = { schemas, groups };

	await fs.mkdir(path.dirname(outputPath), { recursive: true });
	await fs.writeFile(outputPath, JSON.stringify(output, null, 2), "utf-8");
	console.log(`\nPlayground data written to ${outputPath}`);

	await fs.rm(tmpDir, { recursive: true, force: true });
});

// ============================================================================
// CREATE
// ============================================================================

describe("Create", () => {
	it("create a single record", async () => {
		const data = { name: "GraphQL", color: "#E10098" };
		const output = await forja.create("tag", data);

		collect("create", {
			id: "create-single",
			label: "Create a record",
			action: "create",
			model: "tag",
			data,
			output,
		});
	});

	it("create many records", async () => {
		const data = [
			{ name: "Rust", color: "#CE422B" },
			{ name: "Go", color: "#00ADD8" },
		];
		const output = await forja.createMany("tag", data);

		collect("create", {
			id: "create-many",
			label: "Create many records",
			action: "createMany",
			model: "tag",
			data,
			output,
		});
	});

	it("create with belongsTo relation", async () => {
		const data = {
			title: "Intro to Forja",
			content: "Forja is a type-safe database framework.",
			slug: "intro-to-forja",
			isPublished: true,
			author: seed.users[0]!.id,
			category: seed.categories[1]!.id,
		};
		const options = { populate: true };
		const output = await forja.create("post", data, options);

		collect("create", {
			id: "create-with-relation",
			label: "Create with relation",
			action: "create",
			model: "post",
			data,
			options,
			output,
		});
	});

	it("create with manyToMany relation", async () => {
		const data = {
			title: "Full Stack with TypeScript",
			content: "Building full stack apps with TypeScript.",
			slug: "full-stack-typescript",
			isPublished: true,
			author: seed.users[1]!.id,
			category: seed.categories[1]!.id,
			tags: { connect: [seed.tags[0]!.id, seed.tags[1]!.id] },
		};
		const options = { populate: true };
		const output = await forja.create("post", data, options);

		collect("create", {
			id: "create-many-to-many",
			label: "Create with manyToMany",
			action: "create",
			model: "post",
			data,
			options,
			output,
		});
	});
});

// ============================================================================
// READ
// ============================================================================

describe("Read", () => {
	it("find all records", async () => {
		const output = await forja.findMany("user");

		collect("read", {
			id: "read-all",
			label: "Find all records",
			action: "findMany",
			model: "user",
			output,
		});
	});

	it("find with simple where", async () => {
		const query = { where: { isActive: true } };
		const output = await forja.findMany("user", query);

		collect("read", {
			id: "read-where",
			label: "Filter with where",
			action: "findMany",
			model: "user",
			query,
			output,
		});
	});

	it("find with comparison operators", async () => {
		const query = {
			where: { age: { $gte: 30 } },
			orderBy: [{ field: "age", direction: "asc" as const }],
		};
		const output = await forja.findMany("user", query);

		collect("read", {
			id: "read-operators",
			label: "Comparison operators",
			action: "findMany",
			model: "user",
			query,
			output,
		});
	});

	it("find with $and", async () => {
		const query = {
			where: {
				$and: [{ isActive: true }, { age: { $gte: 25 } }],
			},
		};
		const output = await forja.findMany("user", query);

		collect("read", {
			id: "read-and",
			label: "$and / $or operators",
			action: "findMany",
			model: "user",
			query,
			output,
		});
	});

	it("find with select fields", async () => {
		const query = {
			select: ["id", "name", "email"] as unknown,
			where: { isActive: true },
		};
		const output = await forja.findMany("user", query as never);

		collect("read", {
			id: "read-select",
			label: "Select specific fields",
			action: "findMany",
			model: "user",
			query,
			output,
		});
	});

	it("find with pagination", async () => {
		const query = {
			limit: 2,
			offset: 0,
			orderBy: [{ field: "id", direction: "asc" as const }],
		};
		const output = await forja.findMany("user", query);

		collect("read", {
			id: "read-pagination",
			label: "Pagination",
			action: "findMany",
			model: "user",
			query,
			output,
		});
	});

	it("find with populate", async () => {
		const query = {
			where: { isPublished: true },
			populate: {
				author: { select: "*" as const },
				category: { select: "*" as const },
			},
		};
		const output = await forja.findMany("post", query);

		collect("read", {
			id: "read-populate",
			label: "Populate relations",
			action: "findMany",
			model: "post",
			query,
			output,
		});
	});

	it("find with nested populate", async () => {
		const query = {
			where: { isPublished: true },
			populate: {
				author: {
					select: ["id", "name", "email"] as unknown,
					populate: {
						organization: { select: "*" as const },
					},
				},
			},
		};
		const output = await forja.findMany("post", query as never);

		collect("read", {
			id: "read-nested-populate",
			label: "Nested populate",
			action: "findMany",
			model: "post",
			query,
			output,
		});
	});

	it("find with nested where on relation", async () => {
		const query = {
			where: {
				author: {
					isActive: true,
					age: { $gte: 30 },
				},
			},
		};
		const output = await forja.findMany("post", query);

		collect("read", {
			id: "read-nested-where",
			label: "Filter by relation field",
			action: "findMany",
			model: "post",
			query,
			output,
		});
	});

	it("count records", async () => {
		const query = { isActive: true };
		const output = await forja.count("user", query);

		collect("read", {
			id: "read-count",
			label: "Count records",
			action: "count",
			model: "user",
			query,
			output,
		});
	});
});

// ============================================================================
// UPDATE
// ============================================================================

describe("Update", () => {
	it("update a single record by id", async () => {
		const id = seed.users[2]!.id as number;
		const data = { age: 26 };
		const options = { populate: true };
		const output = await forja.update("user", id, data, options);

		collect("update", {
			id: "update-single",
			label: "Update a record",
			action: "update",
			model: "user",
			idArg: id,
			data,
			options,
			output,
		});
	});

	it("update many records", async () => {
		const query = { isPublished: false };
		const data = { viewCount: 0 };
		const options = { populate: true };
		const output = await forja.updateMany("post", query, data, options);

		collect("update", {
			id: "update-many",
			label: "Update many records",
			action: "updateMany",
			model: "post",
			query,
			data,
			options,
			output,
		});
	});

	it("set manyToMany relation", async () => {
		const id = seed.users[0]!.id as number;
		const data = { roles: { set: [seed.roles[0]!.id, seed.roles[1]!.id] } };
		const options = { populate: true };
		const output = await forja.update("user", id, data, options);

		collect("update", {
			id: "update-relation-set",
			label: "Set manyToMany relation",
			action: "update",
			model: "user",
			idArg: id,
			data,
			options,
			output,
		});
	});

	it("connect and disconnect manyToMany relation", async () => {
		const id = seed.users[1]!.id as number;

		await forja.update("user", id, { roles: { connect: [seed.roles[2]!.id] } });

		const data = { roles: { disconnect: [seed.roles[2]!.id] } };
		const options = { populate: true };
		const output = await forja.update("user", id, data, options);

		collect("update", {
			id: "update-relation-connect-disconnect",
			label: "Connect / disconnect relation",
			action: "update",
			model: "user",
			idArg: id,
			data: {
				connect: { roles: { connect: [seed.roles[2]!.id] } },
				disconnect: data,
			},
			options,
			output,
		});
	});
});

// ============================================================================
// DELETE
// ============================================================================

describe("Delete", () => {
	it("delete a single record by id", async () => {
		const temp = await forja.create("tag", {
			name: "TempTag",
			color: "#AAAAAA",
		});
		const id = temp.id as number;
		const options = { populate: true };
		const output = await forja.delete("tag", id, options);

		collect("delete", {
			id: "delete-single",
			label: "Delete a record",
			action: "delete",
			model: "tag",
			idArg: id,
			options,
			output,
		});
	});

	it("delete many records", async () => {
		await forja.createMany("tag", [
			{ name: "OldTag1", color: "#111111" },
			{ name: "OldTag2", color: "#222222" },
		]);

		const query = { name: { $like: "OldTag%" } };
		const output = await forja.deleteMany("tag", query);

		collect("delete", {
			id: "delete-many",
			label: "Delete many records",
			action: "deleteMany",
			model: "tag",
			query,
			output,
		});
	});
});
