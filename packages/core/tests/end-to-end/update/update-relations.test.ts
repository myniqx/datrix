/**
 * Update Relations Tests
 *
 * Tests for updating records with relation API
 *
 * Covers:
 * - BelongsTo: change, set null
 * - ManyToMany: connect, disconnect, set
 * - ManyToMany: create new while updating
 * - Complex: move records between relations
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Datrix } from "@datrix/core";
import fs from "node:fs/promises";
import { createTestConfig, getTmpDir, setupTables } from "../setup";

describe("Update Relations", () => {
	let datrix: Datrix;
	const tmpDir = getTmpDir("update_relations");

	beforeAll(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
		await fs.mkdir(tmpDir, { recursive: true });

		const getDatrix = await createTestConfig(tmpDir);
		datrix = await getDatrix();

		await setupTables(datrix);
	});

	afterAll(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	// ==========================================================================
	// BelongsTo Updates
	// ==========================================================================

	describe("BelongsTo - Change Relation", () => {
		it("should change belongsTo to different record", async () => {
			const org1 = await datrix.create("organization", {
				name: "BT Change Org 1",
				country: "USA",
			});
			const org2 = await datrix.create("organization", {
				name: "BT Change Org 2",
				country: "UK",
			});

			const user = await datrix.create("user", {
				email: "bt-change@test.com",
				name: "BT Change User",
				organization: org1.id,
			});

			// Change organization
			const updated = await datrix.update(
				"user",
				user.id,
				{ organization: org2.id },
				{ populate: { organization: true } },
			);

			expect((updated.organization as { id: number }).id).toBe(org2.id);
			expect((updated.organization as { name: string }).name).toBe(
				"BT Change Org 2",
			);
		});

		it("should set belongsTo to null", async () => {
			const org = await datrix.create("organization", {
				name: "BT Null Org",
				country: "Germany",
			});

			const user = await datrix.create("user", {
				email: "bt-null@test.com",
				name: "BT Null User",
				organization: org.id,
			});

			// Set to null
			const updated = await datrix.update(
				"user",
				user.id,
				{ organization: null },
				{ populate: { organization: true } },
			);

			expect(updated.organization).toBeNull();
		});

		it("should change self-referencing belongsTo", async () => {
			const parent1 = await datrix.create("category", {
				name: "SR Parent 1",
				slug: "sr-parent-1",
			});
			const parent2 = await datrix.create("category", {
				name: "SR Parent 2",
				slug: "sr-parent-2",
			});
			const child = await datrix.create("category", {
				name: "SR Child",
				slug: "sr-child",
				parent: parent1.id,
			});

			// Move to different parent
			const updated = await datrix.update(
				"category",
				child.id,
				{ parent: parent2.id },
				{ populate: { parent: true } },
			);

			expect((updated.parent as { id: number }).id).toBe(parent2.id);
		});
	});

	// ==========================================================================
	// ManyToMany Connect
	// ==========================================================================

	describe("ManyToMany - Connect", () => {
		it("should connect additional records", async () => {
			const role1 = await datrix.create("role", {
				name: "M2M Conn Role 1",
				level: 10,
			});
			const role2 = await datrix.create("role", {
				name: "M2M Conn Role 2",
				level: 20,
			});
			const role3 = await datrix.create("role", {
				name: "M2M Conn Role 3",
				level: 30,
			});

			const user = await datrix.create("user", {
				email: "m2m-connect@test.com",
				name: "M2M Connect User",
				roles: { connect: [role1.id] },
			});

			// Connect additional roles
			const updated = await datrix.update(
				"user",
				user.id,
				{
					roles: { connect: [role2.id, role3.id] },
				},
				{ populate: { roles: true } },
			);

			expect((updated.roles as unknown[]).length).toBe(3);
			const roleIds = (updated.roles as { id: number }[]).map((r) => r.id);
			expect(roleIds).toContain(role1.id);
			expect(roleIds).toContain(role2.id);
			expect(roleIds).toContain(role3.id);
		});

		it("should not duplicate when connecting existing", async () => {
			const role = await datrix.create("role", {
				name: "M2M Dup Role",
				level: 40,
			});

			const user = await datrix.create("user", {
				email: "m2m-dup@test.com",
				name: "M2M Dup User",
				roles: { connect: [role.id] },
			});

			// Try to connect same role again
			const updated = await datrix.update(
				"user",
				user.id,
				{
					roles: { connect: [role.id] },
				},
				{ populate: { roles: true } },
			);

			// Should still be 1, not 2
			expect((updated.roles as unknown[]).length).toBe(1);
		});
	});

	// ==========================================================================
	// ManyToMany Disconnect
	// ==========================================================================

	describe("ManyToMany - Disconnect", () => {
		it("should disconnect specific records", async () => {
			const tags = await datrix.createMany("tag", [
				{ name: "Disc Tag 1", color: "#111111" },
				{ name: "Disc Tag 2", color: "#222222" },
				{ name: "Disc Tag 3", color: "#333333" },
			]);

			const category = await datrix.create("category", {
				name: "Disc Category",
				slug: "disc-category",
			});
			const user = await datrix.create("user", {
				email: "disc-author@test.com",
				name: "Disc Author",
			});

			const post = await datrix.create("post", {
				title: "Disconnect Post",
				content: "Testing disconnect",
				slug: "disconnect-post",
				author: user.id,
				category: category.id,
				tags: { connect: tags.map((t) => t.id) },
			});

			// Disconnect one tag
			const updated = await datrix.update(
				"post",
				post.id,
				{
					tags: { disconnect: [tags[1].id] },
				},
				{ populate: { tags: true } },
			);

			expect((updated.tags as unknown[]).length).toBe(2);
			const tagIds = (updated.tags as { id: number }[]).map((t) => t.id);
			expect(tagIds).toContain(tags[0].id);
			expect(tagIds).not.toContain(tags[1].id);
			expect(tagIds).toContain(tags[2].id);
		});

		it("should disconnect all with empty set", async () => {
			const roles = await datrix.createMany("role", [
				{ name: "Set Empty Role 1", level: 50 },
				{ name: "Set Empty Role 2", level: 60 },
			]);

			const user = await datrix.create("user", {
				email: "set-empty@test.com",
				name: "Set Empty User",
				roles: { connect: roles.map((r) => r.id) },
			});

			// Set to empty array (disconnect all)
			const updated = await datrix.update(
				"user",
				user.id,
				{
					roles: { set: [] },
				},
				{ populate: { roles: true } },
			);

			expect((updated.roles as unknown[]).length).toBe(0);
		});
	});

	// ==========================================================================
	// ManyToMany Set
	// ==========================================================================

	describe("ManyToMany - Set", () => {
		it("should replace all relations with set", async () => {
			const role1 = await datrix.create("role", {
				name: "Set Role 1",
				level: 70,
			});
			const role2 = await datrix.create("role", {
				name: "Set Role 2",
				level: 80,
			});
			const role3 = await datrix.create("role", {
				name: "Set Role 3",
				level: 90,
			});

			const user = await datrix.create("user", {
				email: "m2m-set@test.com",
				name: "M2M Set User",
				roles: { connect: [role1.id, role2.id] },
			});

			// Replace with different roles
			const updated = await datrix.update(
				"user",
				user.id,
				{
					roles: { set: [role3.id] },
				},
				{ populate: { roles: true } },
			);

			expect((updated.roles as unknown[]).length).toBe(1);
			expect((updated.roles as { id: number }[])[0].id).toBe(role3.id);
		});
	});

	// ==========================================================================
	// ManyToMany Create
	// ==========================================================================

	describe("ManyToMany - Create on Update", () => {
		it("should create new related records while updating", async () => {
			const user = await datrix.create("user", {
				email: "m2m-create-update@test.com",
				name: "M2M Create Update User",
			});

			// Add new roles via create
			const updated = await datrix.update(
				"user",
				user.id,
				{
					roles: {
						create: [
							{ name: "Created Role A", level: 15 },
							{ name: "Created Role B", level: 25 },
						],
					},
				},
				{ populate: { roles: true } },
			);

			expect((updated.roles as unknown[]).length).toBe(2);
			const roleNames = (updated.roles as { name: string }[]).map(
				(r) => r.name,
			);
			expect(roleNames).toContain("Created Role A");
			expect(roleNames).toContain("Created Role B");

			// Verify roles were actually created in DB
			const createdRoleA = await datrix.findOne("role", {
				name: "Created Role A",
			});
			expect(createdRoleA).not.toBeNull();
		});
	});

	// ==========================================================================
	// Mixed Operations
	// ==========================================================================

	describe("Mixed Operations", () => {
		it("should connect and create in same update", async () => {
			const existingRole = await datrix.create("role", {
				name: "Existing Mixed Role",
				level: 35,
			});

			const user = await datrix.create("user", {
				email: "mixed-update@test.com",
				name: "Mixed Update User",
			});

			const updated = await datrix.update(
				"user",
				user.id,
				{
					roles: {
						connect: [existingRole.id],
						create: [{ name: "New Mixed Update Role", level: 45 }],
					},
				},
				{ populate: { roles: true } },
			);

			expect((updated.roles as unknown[]).length).toBe(2);
			const roleNames = (updated.roles as { name: string }[]).map(
				(r) => r.name,
			);
			expect(roleNames).toContain("Existing Mixed Role");
			expect(roleNames).toContain("New Mixed Update Role");
		});

		it("should disconnect and connect in same update", async () => {
			const role1 = await datrix.create("role", {
				name: "DC Role 1",
				level: 55,
			});
			const role2 = await datrix.create("role", {
				name: "DC Role 2",
				level: 65,
			});
			const role3 = await datrix.create("role", {
				name: "DC Role 3",
				level: 75,
			});

			const user = await datrix.create("user", {
				email: "dc-update@test.com",
				name: "DC Update User",
				roles: { connect: [role1.id, role2.id] },
			});

			// Disconnect role1, connect role3
			const updated = await datrix.update(
				"user",
				user.id,
				{
					roles: {
						disconnect: [role1.id],
						connect: [role3.id],
					},
				},
				{ populate: { roles: true } },
			);

			const roleIds = (updated.roles as { id: number }[]).map((r) => r.id);
			expect(roleIds).not.toContain(role1.id);
			expect(roleIds).toContain(role2.id);
			expect(roleIds).toContain(role3.id);
		});
	});

	// ==========================================================================
	// Complex Scenario: Move Records
	// ==========================================================================

	describe("Complex: Move Records Between Categories", () => {
		it("should move all posts from multiple categories to new category", async () => {
			// Setup: Create categories
			const cat1 = await datrix.create("category", {
				name: "Source Cat 1",
				slug: "source-cat-1",
			});
			const cat2 = await datrix.create("category", {
				name: "Source Cat 2",
				slug: "source-cat-2",
			});

			// Create author
			const author = await datrix.create("user", {
				email: "move-author@test.com",
				name: "Move Author",
			});

			// Create posts in different categories
			await datrix.createMany("post", [
				{
					title: "Post in Cat 1",
					content: "Content 1",
					slug: "post-cat-1",
					author: author.id,
					category: cat1.id,
				},
				{
					title: "Post in Cat 2",
					content: "Content 2",
					slug: "post-cat-2",
					author: author.id,
					category: cat2.id,
				},
				{
					title: "Another in Cat 1",
					content: "Content 3",
					slug: "another-cat-1",
					author: author.id,
					category: cat1.id,
				},
			]);

			// Create new target category
			const newCat = await datrix.create("category", {
				name: "Target Category",
				slug: "target-category",
			});

			// Move all posts from cat1 and cat2 to newCat using updateMany
			const movedPosts = await datrix.updateMany(
				"post",
				{
					category: { id: { $in: [cat1.id, cat2.id] } },
				},
				{
					category: newCat.id,
				},
				{ populate: { category: true } },
			);

			expect(movedPosts).toHaveLength(3);
			for (const post of movedPosts) {
				expect((post.category as { id: number }).id).toBe(newCat.id);
			}

			// Verify old categories have no posts
			const cat1Posts = await datrix.findMany("post", {
				where: { category: { id: cat1.id } },
			});
			const cat2Posts = await datrix.findMany("post", {
				where: { category: { id: cat2.id } },
			});

			expect(cat1Posts).toHaveLength(0);
			expect(cat2Posts).toHaveLength(0);
		});
	});

	// ==========================================================================
	// Error Cases
	// ==========================================================================

	describe("Error Cases", () => {
		it("should fail when connecting to non-existent id", async () => {
			const user = await datrix.create("user", {
				email: "err-connect@test.com",
				name: "Err Connect User",
			});

			await expect(
				datrix.update("user", user.id, {
					roles: { connect: [99999] },
				}),
			).rejects.toThrow();
		});

		it("should fail when setting to non-existent belongsTo", async () => {
			const user = await datrix.create("user", {
				email: "err-belongsto@test.com",
				name: "Err BelongsTo User",
			});

			await expect(
				datrix.update("user", user.id, {
					organization: 99999,
				}),
			).rejects.toThrow();
		});
	});
});
