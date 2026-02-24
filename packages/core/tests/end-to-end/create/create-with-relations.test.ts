/**
 * Create with Relations Tests
 *
 * Tests for creating records with relation API
 *
 * Covers:
 * - BelongsTo with existing ID
 * - BelongsTo with nested create (inline)
 * - ManyToMany connect
 * - ManyToMany create
 * - Mixed connect and create
 * - Deep nested relations
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Forja } from "forja-core";
import fs from "node:fs/promises";
import { createTestConfig, getTmpDir, setupTables } from "../setup";

describe("Create with Relations", () => {
	let forja: Forja;
	const tmpDir = getTmpDir("create_with_relations");

	beforeAll(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
		await fs.mkdir(tmpDir, { recursive: true });

		const getForja = await createTestConfig(tmpDir);
		forja = await getForja();

		await setupTables(forja);
	});

	afterAll(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	// ==========================================================================
	// BelongsTo Relations
	// ==========================================================================

	describe("BelongsTo - Connect by ID", () => {
		it("should create with single belongsTo relation", async () => {
			const org = await forja.create("organization", {
				name: "BelongsTo Org",
				country: "USA",
			});

			const user = await forja.create(
				"user",
				{
					email: "belongsto@test.com",
					name: "BelongsTo User",
					organization: org.id,
				},
				{ populate: { organization: true } },
			);

			expect(user.organization).toBeDefined();
			expect((user.organization as { id: number }).id).toBe(org.id);
			expect((user.organization as { name: string }).name).toBe(
				"BelongsTo Org",
			);
		});

		it("should create with multiple belongsTo relations", async () => {
			const org = await forja.create("organization", {
				name: "Multi BelongsTo Org",
				country: "UK",
			});

			const dept = await forja.create("department", {
				name: "Multi BelongsTo Dept",
				code: "MBD",
				organization: org.id,
			});

			const user = await forja.create(
				"user",
				{
					email: "multi-belongsto@test.com",
					name: "Multi BelongsTo User",
					organization: org.id,
					department: dept.id,
				},
				{ populate: { organization: true, department: true } },
			);

			expect((user.organization as { id: number }).id).toBe(org.id);
			expect((user.department as { id: number }).id).toBe(dept.id);
		});

		it("should create with self-referencing belongsTo", async () => {
			const parent = await forja.create("category", {
				name: "Parent Cat",
				slug: "parent-cat",
			});

			const child = await forja.create(
				"category",
				{
					name: "Child Cat",
					slug: "child-cat",
					parent: parent.id,
				},
				{ populate: { parent: true } },
			);

			expect((child.parent as { id: number }).id).toBe(parent.id);
			expect((child.parent as { name: string }).name).toBe("Parent Cat");
		});

		it("should create with deep self-referencing chain", async () => {
			const level1 = await forja.create("category", {
				name: "Level 1",
				slug: "level-1",
			});

			const level2 = await forja.create("category", {
				name: "Level 2",
				slug: "level-2",
				parent: level1.id,
			});

			const level3 = await forja.create(
				"category",
				{
					name: "Level 3",
					slug: "level-3",
					parent: level2.id,
				},
				{ populate: { parent: { populate: { parent: true } } } },
			);

			expect((level3.parent as { id: number }).id).toBe(level2.id);
			const parentOfParent = (level3.parent as { parent: { id: number } })
				.parent;
			expect(parentOfParent.id).toBe(level1.id);
		});
	});

	// ==========================================================================
	// BelongsTo - Nested Create
	// ==========================================================================

	describe("BelongsTo - Nested Create", () => {
		it("should create with inline nested belongsTo", async () => {
			const dept = await forja.create(
				"department",
				{
					name: "Nested Create Dept",
					code: "NCD",
					organization: {
						create: {
							name: "Inline Created Org",
							country: "Germany",
						},
					},
				},
				{ populate: { organization: true } },
			);

			expect(dept.organization).toBeDefined();
			expect((dept.organization as { name: string }).name).toBe(
				"Inline Created Org",
			);
			expect((dept.organization as { country: string }).country).toBe(
				"Germany",
			);

			// Verify org was actually created
			const org = await forja.findOne("organization", {
				name: "Inline Created Org",
			});
			expect(org).not.toBeNull();
		});

		it("should create with deep nested belongsTo chain", async () => {
			const user = await forja.create(
				"user",
				{
					email: "deep-nested@test.com",
					name: "Deep Nested User",
					department: {
						create: {
							name: "Deep Nested Dept",
							code: "DND",
							organization: {
								create: {
									name: "Deep Nested Org",
									country: "France",
								},
							},
						},
					},
				},
				{
					populate: {
						department: {
							select: ["name"],
							populate: { organization: true },
						},
					},
				},
			);

			expect(user.department).toBeDefined();
			const dept = user.department as {
				name: string;
				organization: { name: string };
			};
			expect(dept.name).toBe("Deep Nested Dept");
			expect(dept.organization.name).toBe("Deep Nested Org");
		});
	});

	// ==========================================================================
	// ManyToMany - Connect
	// ==========================================================================

	describe("ManyToMany - Connect", () => {
		it("should create with manyToMany connect single", async () => {
			const role = await forja.create("role", {
				name: "M2M Connect Role",
				level: 50,
			});

			const user = await forja.create(
				"user",
				{
					email: "m2m-connect@test.com",
					name: "M2M Connect User",
					roles: {
						connect: [role.id],
					},
				},
				{ populate: { roles: true } },
			);

			expect(user.roles).toBeDefined();
			expect(Array.isArray(user.roles)).toBe(true);
			expect((user.roles as { id: number }[]).length).toBe(1);
			expect((user.roles as { id: number }[])[0].id).toBe(role.id);
		});

		it("should create with manyToMany connect multiple", async () => {
			const tags = await forja.createMany("tag", [
				{ name: "M2M Tag 1", color: "#FF0000" },
				{ name: "M2M Tag 2", color: "#00FF00" },
				{ name: "M2M Tag 3", color: "#0000FF" },
			]);

			const category = await forja.create("category", {
				name: "M2M Post Category",
				slug: "m2m-post-category",
			});

			const user = await forja.create("user", {
				email: "m2m-post-author@test.com",
				name: "M2M Post Author",
			});

			const post = await forja.create(
				"post",
				{
					title: "M2M Connect Post",
					content: "Testing manyToMany connect",
					slug: "m2m-connect-post",
					author: user.id,
					category: category.id,
					tags: {
						connect: tags.map((t) => t.id),
					},
				},
				{ populate: { tags: true } },
			);

			expect((post.tags as unknown[]).length).toBe(3);
			const tagIds = (post.tags as { id: number }[]).map((t) => t.id);
			for (const tag of tags) {
				expect(tagIds).toContain(tag.id);
			}
		});

		it("should create with empty manyToMany connect", async () => {
			const user = await forja.create(
				"user",
				{
					email: "empty-m2m@test.com",
					name: "Empty M2M User",
					roles: {
						connect: [],
					},
				},
				{ populate: { roles: true } },
			);

			expect(user.roles).toBeDefined();
			expect((user.roles as unknown[]).length).toBe(0);
		});
	});

	// ==========================================================================
	// ManyToMany - Create
	// ==========================================================================

	describe("ManyToMany - Create", () => {
		it("should create with manyToMany inline create single", async () => {
			const user = await forja.create(
				"user",
				{
					email: "m2m-create@test.com",
					name: "M2M Create User",
					roles: {
						create: [{ name: "Inline Role", level: 25 }],
					},
				},
				{ populate: { roles: true } },
			);

			expect((user.roles as unknown[]).length).toBe(1);
			expect((user.roles as { name: string }[])[0].name).toBe("Inline Role");

			// Verify role was actually created
			const role = await forja.findOne("role", { name: "Inline Role" });
			expect(role).not.toBeNull();
		});

		it("should create with manyToMany inline create multiple", async () => {
			const category = await forja.create("category", {
				name: "Inline Tags Category",
				slug: "inline-tags-category",
			});

			const user = await forja.create("user", {
				email: "inline-tags-author@test.com",
				name: "Inline Tags Author",
			});

			const post = await forja.create(
				"post",
				{
					title: "Inline Tags Post",
					content: "Testing inline tag creation",
					slug: "inline-tags-post",
					author: user.id,
					category: category.id,
					tags: {
						create: [
							{ name: "InlineTag1", color: "#111111" },
							{ name: "InlineTag2", color: "#222222" },
						],
					},
				},
				{ populate: { tags: true } },
			);

			expect((post.tags as unknown[]).length).toBe(2);
			const tagNames = (post.tags as { name: string }[]).map((t) => t.name);
			expect(tagNames).toContain("InlineTag1");
			expect(tagNames).toContain("InlineTag2");
		});
	});

	// ==========================================================================
	// ManyToMany - Mixed Connect and Create
	// ==========================================================================

	describe("ManyToMany - Mixed", () => {
		it("should create with both connect and create", async () => {
			const existingRole = await forja.create("role", {
				name: "Existing Mixed Role",
				level: 30,
			});

			const user = await forja.create(
				"user",
				{
					email: "mixed-m2m@test.com",
					name: "Mixed M2M User",
					roles: {
						connect: [existingRole.id],
						create: [{ name: "New Mixed Role", level: 40 }],
					},
				},
				{ populate: { roles: true } },
			);

			expect((user.roles as unknown[]).length).toBe(2);
			const roleNames = (user.roles as { name: string }[]).map((r) => r.name);
			expect(roleNames).toContain("Existing Mixed Role");
			expect(roleNames).toContain("New Mixed Role");
		});
	});

	// ==========================================================================
	// Complex Scenarios
	// ==========================================================================

	describe("Complex Scenarios", () => {
		it("should create post with all relation types", async () => {
			// Setup
			const org = await forja.create("organization", {
				name: "Complex Org",
				country: "Japan",
			});

			const existingTag = await forja.create("tag", {
				name: "ExistingComplexTag",
				color: "#AABBCC",
			});

			// Create post with:
			// - belongsTo author (nested create user with nested create dept/org)
			// - belongsTo category (nested create)
			// - manyToMany tags (mixed connect + create)
			const post = await forja.create(
				"post",
				{
					title: "Complex Relations Post",
					content: "Testing all relation types",
					slug: "complex-relations-post",
					author: {
						create: {
							email: "complex-author@test.com",
							name: "Complex Author",
							organization: org.id,
						},
					},
					category: {
						create: {
							name: "Complex Category",
							slug: "complex-category",
						},
					},
					tags: {
						connect: [existingTag.id],
						create: [{ name: "NewComplexTag", color: "#DDEEFF" }],
					},
				},
				{
					populate: {
						author: {
							select: ["email"],
							populate: { organization: true },
						},
						category: true,
						tags: true,
					},
				},
			);

			// Verify author
			expect(post.author).toBeDefined();
			expect((post.author as { email: string }).email).toBe(
				"complex-author@test.com",
			);
			expect(
				(post.author as { organization: { name: string } }).organization.name,
			).toBe("Complex Org");

			// Verify category
			expect(post.category).toBeDefined();
			expect((post.category as { name: string }).name).toBe("Complex Category");

			// Verify tags
			expect((post.tags as unknown[]).length).toBe(2);
			const tagNames = (post.tags as { name: string }[]).map((t) => t.name);
			expect(tagNames).toContain("ExistingComplexTag");
			expect(tagNames).toContain("NewComplexTag");
		});
	});

	// ==========================================================================
	// Error Cases
	// ==========================================================================

	describe("Error Cases", () => {
		it("should fail when connecting to non-existent id", async () => {
			await expect(
				forja.create("user", {
					email: "bad-connect@test.com",
					name: "Bad Connect User",
					organization: 99999, // doesn't exist
				}),
			).rejects.toThrow();
		});

		it("should fail when manyToMany connect has non-existent id", async () => {
			await expect(
				forja.create("user", {
					email: "bad-m2m@test.com",
					name: "Bad M2M User",
					roles: {
						connect: [99999], // doesn't exist
					},
				}),
			).rejects.toThrow();
		});

		it("should fail when nested create has invalid data", async () => {
			await expect(
				forja.create("department", {
					name: "Bad Nested Dept",
					code: "BND",
					organization: {
						create: {
							name: "A", // minLength is 2
							country: "USA",
						},
					},
				}),
			).rejects.toThrow();
		});
	});

	// ==========================================================================
	// HasOne Relations
	// ==========================================================================

	describe("HasOne - Connect by ID", () => {
		it("should create user with hasOne relation (favoriteCategory)", async () => {
			const category = await forja.create("category", {
				name: "HasOne Category",
				slug: "hasone-category",
			});

			const user = await forja.create(
				"user",
				{
					email: "hasone-create@test.com",
					name: "HasOne Create User",
					favoriteCategory: category.id,
				},
				{ populate: { favoriteCategory: true } },
			);

			expect(user.favoriteCategory).toBeDefined();
			expect((user.favoriteCategory as { id: number }).id).toBe(category.id);
			expect((user.favoriteCategory as { name: string }).name).toBe(
				"HasOne Category",
			);
		});

		it("should create user without hasOne relation (null)", async () => {
			const user = await forja.create(
				"user",
				{
					email: "hasone-null@test.com",
					name: "HasOne Null User",
				},
				{ populate: { favoriteCategory: true } },
			);

			expect(user.favoriteCategory).toBeNull();
		});

		it("should update hasOne relation", async () => {
			const cat1 = await forja.create("category", {
				name: "HasOne Cat1",
				slug: "hasone-cat1",
			});

			const cat2 = await forja.create("category", {
				name: "HasOne Cat2",
				slug: "hasone-cat2",
			});

			// Create with cat1
			const user = await forja.create("user", {
				email: "hasone-update@test.com",
				name: "HasOne Update User",
				favoriteCategory: cat1.id,
			});

			// Update to cat2
			const updated = await forja.update(
				"user",
				user.id,
				{ favoriteCategory: cat2.id },
				{ populate: { favoriteCategory: true } },
			);

			expect((updated.favoriteCategory as { id: number }).id).toBe(cat2.id);
			expect((updated.favoriteCategory as { name: string }).name).toBe(
				"HasOne Cat2",
			);
		});

		it("should clear hasOne relation by setting to null", async () => {
			const cat = await forja.create("category", {
				name: "HasOne Clear Cat",
				slug: "hasone-clear-cat",
			});

			const user = await forja.create("user", {
				email: "hasone-clear@test.com",
				name: "HasOne Clear User",
				favoriteCategory: cat.id,
			});

			// Clear the relation
			const updated = await forja.update(
				"user",
				user.id,
				{ favoriteCategory: null },
				{ populate: { favoriteCategory: true } },
			);

			expect(updated.favoriteCategory).toBeNull();
		});
	});

	describe("HasOne - Nested Create", () => {
		it("should create user with nested hasOne create", async () => {
			const user = await forja.create(
				"user",
				{
					email: "hasone-nested@test.com",
					name: "HasOne Nested User",
					favoriteCategory: {
						create: {
							name: "Nested Favorite",
							slug: "nested-favorite",
						},
					},
				},
				{ populate: { favoriteCategory: true } },
			);

			expect(user.favoriteCategory).toBeDefined();
			expect((user.favoriteCategory as { name: string }).name).toBe(
				"Nested Favorite",
			);
			expect((user.favoriteCategory as { slug: string }).slug).toBe(
				"nested-favorite",
			);
		});
	});
});
