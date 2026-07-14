/**
 * Self-Referential manyToMany Regression Tests
 *
 * core issue 2.4: `User manyToMany User` used to collide source/target FK
 * names in the junction table (`UserId` twice). Core now generates
 * `source<Model>Id` / `target<Model>Id`; adapters must resolve junction FK
 * names from the junction schema instead of recomputing `${model}Id`
 * templates (pg Part 10, mysql/mongodb populate paths).
 *
 * Uses its own schema set because the shared e2e schemas contain no
 * self-referential manyToMany relation.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Datrix, defineConfig, defineSchema } from "@datrix/core";
import type { DatrixConfig } from "@datrix/core";
import fs from "node:fs/promises";
import { getAdapter, getAdapterType, getTmpDir, setupTables } from "../setup";

const personSchema = defineSchema({
	name: "person",
	fields: {
		name: {
			type: "string",
			required: true,
		},
		friends: {
			type: "relation",
			kind: "manyToMany",
			model: "person",
		},
	},
	permission: {
		create: true,
		read: true,
		update: true,
		delete: true,
	},
} as const);

describe("Self-referential manyToMany", () => {
	let datrix: Datrix;
	const tmpDir = getTmpDir("self-many-to-many");

	beforeAll(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
		await fs.mkdir(tmpDir, { recursive: true });

		const adapter = await getAdapter(getAdapterType(), tmpDir);
		const getDatrix = defineConfig(() => {
			const config: DatrixConfig = {
				adapter,
				schemas: [personSchema],
				plugins: [],
			};
			return config;
		});
		datrix = await getDatrix();

		await setupTables(datrix);
	});

	afterAll(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	it("connects and populates a self-referential manyToMany relation", async () => {
		const alice = await datrix.create("person", { name: "Alice" });
		const bob = await datrix.create("person", { name: "Bob" });
		const carol = await datrix.create("person", { name: "Carol" });

		await datrix.update("person", alice.id, {
			friends: { connect: [bob.id, carol.id] },
		});

		const fetched = await datrix.findById("person", alice.id, {
			populate: { friends: true },
		});

		const friends = fetched!["friends"] as { id: number; name: string }[];
		expect(friends.length).toBe(2);
		expect(friends.map((f) => f.name).sort()).toEqual(["Bob", "Carol"]);
	});

	it("sets friends via the array shortcut on create", async () => {
		const dave = await datrix.create("person", { name: "Dave" });
		const erin = await datrix.create("person", {
			name: "Erin",
			friends: [dave.id],
		});

		const fetched = await datrix.findById("person", erin.id, {
			populate: { friends: true },
		});

		const friends = fetched!["friends"] as { id: number }[];
		expect(friends.length).toBe(1);
		expect(friends[0]!.id).toBe(dave.id);
	});

	it("replaces and disconnects self-referential friends", async () => {
		const frank = await datrix.create("person", { name: "Frank" });
		const grace = await datrix.create("person", { name: "Grace" });
		const heidi = await datrix.create("person", { name: "Heidi" });

		await datrix.update("person", frank.id, {
			friends: { set: [grace.id, heidi.id] },
		});

		// replace with only heidi
		const replaced = await datrix.update(
			"person",
			frank.id,
			{ friends: { set: [heidi.id] } },
			{ populate: { friends: true } },
		);
		const afterSet = replaced!["friends"] as { id: number }[];
		expect(afterSet.length).toBe(1);
		expect(afterSet[0]!.id).toBe(heidi.id);

		// disconnect the last one
		const cleared = await datrix.update(
			"person",
			frank.id,
			{ friends: { disconnect: [heidi.id] } },
			{ populate: { friends: true } },
		);
		expect((cleared!["friends"] as unknown[]).length).toBe(0);
	});

	it("keeps friendship direction: source and target FKs are distinct columns", async () => {
		const ivan = await datrix.create("person", { name: "Ivan" });
		const judy = await datrix.create("person", { name: "Judy" });

		await datrix.update("person", ivan.id, {
			friends: { connect: [judy.id] },
		});

		// with a collided FK column, both directions would (wrongly) match
		const judySide = await datrix.findById("person", judy.id, {
			populate: { friends: true },
		});
		const judyFriends = judySide!["friends"] as { id: number }[];
		expect(judyFriends.map((f) => f.id)).not.toContain(judy.id);

		const ivanSide = await datrix.findById("person", ivan.id, {
			populate: { friends: true },
		});
		const ivanFriends = ivanSide!["friends"] as { id: number }[];
		expect(ivanFriends.length).toBe(1);
		expect(ivanFriends[0]!.id).toBe(judy.id);
	});

	it("filters by a nested where on the self-referential relation", async () => {
		const kim = await datrix.create("person", { name: "SelfWhere Kim" });
		const liam = await datrix.create("person", { name: "SelfWhere Liam" });
		await datrix.update("person", kim.id, {
			friends: { connect: [liam.id] },
		});

		const results = await datrix.findMany("person", {
			where: { friends: { name: "SelfWhere Liam" } },
		});

		expect(results.length).toBe(1);
		expect(results[0]!["id"]).toBe(kim.id);
	});
});
