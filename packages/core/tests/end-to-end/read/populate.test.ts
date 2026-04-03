/**
 * Populate Tests
 *
 * Tests for relation population (eager loading)
 *
 * Covers:
 * - Simple populate (single relation)
 * - Multiple relations
 * - Nested populate (deep relations)
 * - Populate with select
 * - Populate with where filter
 * - ManyToMany populate
 * - Self-referencing populate
 * - Populate depth limits
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Forja } from "@forja/core";
import fs from "node:fs/promises";
import { createTestConfig, getTmpDir, setupTables } from "../setup";

describe("Populate", () => {
	let forja: Forja;
	const tmpDir = getTmpDir("populate");

	// Store IDs
	let orgId: number;
	let deptId: number;
	let userId: number;
	let postId: number;
	let tagIds: number[];

	beforeAll(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
		await fs.mkdir(tmpDir, { recursive: true });

		const getForja = await createTestConfig(tmpDir);
		forja = await getForja();

		await setupTables(forja);

		// Create test data
		const org = await forja.create("organization", {
			name: "Populate Test Org",
			country: "USA",
		});
		orgId = org.id;

		const dept = await forja.create("department", {
			name: "Populate Test Dept",
			code: "POP",
			budget: 50000,
			organization: org.id,
		});
		deptId = dept.id;

		const role1 = await forja.create("role", { name: "Role A", level: 50 });
		const role2 = await forja.create("role", { name: "Role B", level: 75 });

		const user = await forja.create("user", {
			email: "populate@test.com",
			name: "Populate User",
			age: 30,
			organization: org.id,
			department: dept.id,
			roles: { connect: [role1.id, role2.id] },
		});
		userId = user.id;

		const category = await forja.create("category", {
			name: "Populate Category",
			slug: "populate-category",
		});

		const tags = await forja.createMany("tag", [
			{ name: "PopTag1", color: "#111111" },
			{ name: "PopTag2", color: "#222222" },
			{ name: "PopTag3", color: "#333333" },
		]);
		tagIds = tags.map((t) => t.id);

		const post = await forja.create("post", {
			title: "Populate Test Post",
			content: "Testing populate functionality",
			slug: "populate-test-post",
			isPublished: true,
			author: user.id,
			category: category.id,
			tags: { connect: tagIds },
		});
		postId = post.id;
	});

	afterAll(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	// ==========================================================================
	// Simple Populate
	// ==========================================================================

	describe("Simple Populate", () => {
		it("should populate single belongsTo relation", async () => {
			const user = await forja.findById("user", userId, {
				populate: { organization: true },
			});

			expect(user).not.toBeNull();
			expect(user!.organization).toBeDefined();
			expect(typeof user!.organization).toBe("object");
			expect((user!.organization as { id: number }).id).toBe(orgId);
			expect((user!.organization as { name: string }).name).toBe(
				"Populate Test Org",
			);
		});

		it("should not populate when not requested", async () => {
			const user = await forja.findById("user", userId);

			// Relation should be undefined
			expect(user!.organization).toBeUndefined();
		});

		it("should populate with true shorthand", async () => {
			const dept = await forja.findById("department", deptId, {
				populate: { organization: true },
			});

			expect(dept!.organization).toBeDefined();
			expect((dept!.organization as { name: string }).name).toBe(
				"Populate Test Org",
			);
		});
	});

	// ==========================================================================
	// Multiple Relations
	// ==========================================================================

	describe("Multiple Relations", () => {
		it("should populate multiple belongsTo relations", async () => {
			const user = await forja.findById("user", userId, {
				populate: {
					organization: true,
					department: true,
				},
			});

			expect(user!.organization).toBeDefined();
			expect(user!.department).toBeDefined();
			expect((user!.organization as { name: string }).name).toBe(
				"Populate Test Org",
			);
			expect((user!.department as { name: string }).name).toBe(
				"Populate Test Dept",
			);
		});

		it("should populate belongsTo and manyToMany together", async () => {
			const post = await forja.findById("post", postId, {
				populate: {
					author: true,
					category: true,
					tags: true,
				},
			});

			expect(post!.author).toBeDefined();
			expect(post!.category).toBeDefined();
			expect(post!.tags).toBeDefined();
			expect(Array.isArray(post!.tags)).toBe(true);
			expect((post!.tags as unknown[]).length).toBe(3);
		});
	});

	// ==========================================================================
	// Nested Populate
	// ==========================================================================

	describe("Nested Populate", () => {
		it("should populate 2-level deep", async () => {
			const user = await forja.findById("user", userId, {
				populate: {
					department: {
						populate: { organization: true },
					},
				},
			});

			expect(user!.department).toBeDefined();
			const dept = user!.department as { organization: { name: string } };
			expect(dept.organization).toBeDefined();
			expect(dept.organization.name).toBe("Populate Test Org");
		});

		it("should populate 3-level deep", async () => {
			const post = await forja.findById("post", postId, {
				populate: {
					author: {
						populate: {
							department: {
								populate: { organization: true },
							},
						},
					},
				},
			});

			const author = post!.author as {
				department: {
					organization: { name: string };
				};
			};

			expect(author.department).toBeDefined();
			expect(author.department.organization).toBeDefined();
			expect(author.department.organization.name).toBe("Populate Test Org");
		});
	});

	// ==========================================================================
	// ManyToMany Populate
	// ==========================================================================

	describe("ManyToMany Populate", () => {
		it("should populate manyToMany relation", async () => {
			const user = await forja.findById("user", userId, {
				populate: { roles: true },
			});

			expect(user!.roles).toBeDefined();
			expect(Array.isArray(user!.roles)).toBe(true);
			expect((user!.roles as unknown[]).length).toBe(2);

			const roleNames = (user!.roles as { name: string }[]).map((r) => r.name);
			expect(roleNames).toContain("Role A");
			expect(roleNames).toContain("Role B");
		});

		it("should populate manyToMany with full objects", async () => {
			const post = await forja.findById("post", postId, {
				populate: { tags: true },
			});

			const tags = post!.tags as { id: number; name: string; color: string }[];
			expect(tags.length).toBe(3);

			for (const tag of tags) {
				expect(tag).toHaveProperty("id");
				expect(tag).toHaveProperty("name");
				expect(tag).toHaveProperty("color");
			}
		});

		it("should return empty array for manyToMany with no relations", async () => {
			const user = await forja.create("user", {
				email: "no-roles@test.com",
				name: "No Roles User",
			});

			const result = await forja.findById("user", user.id, {
				populate: { roles: true },
			});

			expect(result!.roles).toBeDefined();
			expect(Array.isArray(result!.roles)).toBe(true);
			expect((result!.roles as unknown[]).length).toBe(0);
		});
	});

	// ==========================================================================
	// Populate with Select
	// ==========================================================================

	describe("Populate with Select", () => {
		it("should populate relation with selected fields only", async () => {
			const user = await forja.findById("user", userId, {
				populate: {
					organization: {
						select: ["id", "name"],
					},
				},
			});

			const org = user!.organization as Record<string, unknown>;
			expect(org).toHaveProperty("id");
			expect(org).toHaveProperty("name");
			expect(org).toHaveProperty("createdAt"); // Reserved
			expect(org).toHaveProperty("updatedAt"); // Reserved
			expect(org).not.toHaveProperty("country");
			expect(org).not.toHaveProperty("isActive");
		});
	});

	// ==========================================================================
	// Self-Referencing Populate
	// ==========================================================================

	describe("Self-Referencing Populate", () => {
		let parentId: number;
		let childId: number;
		let grandchildId: number;

		beforeAll(async () => {
			const parent = await forja.create("category", {
				name: "Self Ref Parent",
				slug: "self-ref-parent",
			});
			parentId = parent.id;

			const child = await forja.create("category", {
				name: "Self Ref Child",
				slug: "self-ref-child",
				parent: parent.id,
			});
			childId = child.id;

			const grandchild = await forja.create("category", {
				name: "Self Ref Grandchild",
				slug: "self-ref-grandchild",
				parent: child.id,
			});
			grandchildId = grandchild.id;
		});

		it("should populate self-referencing relation", async () => {
			const child = await forja.findById("category", childId, {
				populate: { parent: true },
			});

			expect(child!.parent).toBeDefined();
			expect((child!.parent as { name: string }).name).toBe("Self Ref Parent");
		});

		it("should populate nested self-reference", async () => {
			const grandchild = await forja.findById("category", grandchildId, {
				populate: {
					parent: {
						populate: { parent: true },
					},
				},
			});

			const parent = grandchild!.parent as { parent: { name: string } };
			expect(parent.parent).toBeDefined();
			expect(parent.parent.name).toBe("Self Ref Parent");
		});
	});

	// ==========================================================================
	// Populate in findMany
	// ==========================================================================

	describe("Populate in findMany", () => {
		it("should populate relations for all results", async () => {
			// Create additional users
			await forja.create("user", {
				email: "findmany-pop1@test.com",
				name: "FindMany Pop 1",
				organization: orgId,
			});
			await forja.create("user", {
				email: "findmany-pop2@test.com",
				name: "FindMany Pop 2",
				organization: orgId,
			});

			const users = await forja.findMany("user", {
				where: { organization: { id: orgId } },
				populate: { organization: true },
			});

			expect(users.length).toBeGreaterThanOrEqual(3);
			for (const user of users) {
				expect(user.organization).toBeDefined();
				expect((user.organization as { id: number }).id).toBe(orgId);
			}
		});
	});

	// ==========================================================================
	// Populate with null relations
	// ==========================================================================

	describe("Populate with Null Relations", () => {
		it("should return null for unpopulated optional relation", async () => {
			const user = await forja.create("user", {
				email: "null-org@test.com",
				name: "Null Org User",
				// No organization
			});

			const result = await forja.findById("user", user.id, {
				populate: { organization: true },
			});

			expect(result!.organization).toBeNull();
		});

		it("should handle mixed null and non-null in findMany", async () => {
			await forja.create("user", {
				email: "mixed-null@test.com",
				name: "Mixed Null User",
				// No organization
			});

			const users = await forja.findMany("user", {
				populate: { organization: true },
			});

			const withOrg = users.filter((u) => u.organization !== null);
			const withoutOrg = users.filter((u) => u.organization === null);

			expect(withOrg.length).toBeGreaterThan(0);
			expect(withoutOrg.length).toBeGreaterThan(0);
		});
	});

	// ==========================================================================
	// Error Cases
	// ==========================================================================

	describe("Error Cases", () => {
		it("should throw for invalid relation name", async () => {
			await expect(
				forja.findById("user", userId, {
					populate: { nonExistentRelation: true },
				}),
			).rejects.toThrow();
		});

		it("should throw for non-relation field in populate", async () => {
			await expect(
				forja.findById("user", userId, {
					populate: { name: true } as Record<string, unknown>,
				}),
			).rejects.toThrow();
		});
	});

	// ==========================================================================
	// HasOne Populate
	// ==========================================================================

	describe("HasOne Populate", () => {
		let userWithFavCatId: number;
		let favCategoryId: number;

		beforeAll(async () => {
			// Create a category for hasOne relation
			const favCategory = await forja.create("category", {
				name: "Favorite Category",
				slug: "favorite-category",
			});
			favCategoryId = favCategory.id;

			// Create user with favoriteCategory (hasOne relation)
			const userWithFavCat = await forja.create("user", {
				email: "hasone-test@test.com",
				name: "HasOne Test User",
				favoriteCategory: favCategoryId,
			});
			userWithFavCatId = userWithFavCat.id;
		});

		it("should populate hasOne relation", async () => {
			const user = await forja.findById("user", userWithFavCatId, {
				populate: { favoriteCategory: true },
			});

			expect(user).toBeDefined();
			expect(user!.favoriteCategory).toBeDefined();
			expect(user!.favoriteCategory).not.toBeNull();

			const favCat = user!.favoriteCategory as {
				id: number;
				name: string;
				slug: string;
			};
			expect(favCat.id).toBe(favCategoryId);
			expect(favCat.name).toBe("Favorite Category");
			expect(favCat.slug).toBe("favorite-category");
		});

		it("should populate hasOne with select", async () => {
			const user = await forja.findById("user", userWithFavCatId, {
				populate: {
					favoriteCategory: {
						select: ["id", "name"],
					},
				},
			});

			const favCat = user!.favoriteCategory as Record<string, unknown>;
			expect(favCat).toHaveProperty("id");
			expect(favCat).toHaveProperty("name");
			expect(favCat).not.toHaveProperty("slug");
			expect(favCat).not.toHaveProperty("description");
		});

		it("should return null for hasOne when not set", async () => {
			// Create user without favoriteCategory
			const userWithoutFav = await forja.create("user", {
				email: "no-fav-cat@test.com",
				name: "No Favorite User",
			});

			const user = await forja.findById("user", userWithoutFav.id, {
				populate: { favoriteCategory: true },
			});

			expect(user!.favoriteCategory).toBeNull();
		});

		it("should populate hasOne in findMany", async () => {
			const users = await forja.findMany("user", {
				where: {
					email: { $in: ["hasone-test@test.com", "no-fav-cat@test.com"] },
				},
				populate: { favoriteCategory: true },
			});

			expect(users.length).toBe(2);

			const withFav = users.find((u) => u.email === "hasone-test@test.com");
			const withoutFav = users.find((u) => u.email === "no-fav-cat@test.com");

			expect(withFav!.favoriteCategory).not.toBeNull();
			expect(withoutFav!.favoriteCategory).toBeNull();
		});

		it("should populate hasOne with nested relation", async () => {
			// Category has parent (self-referencing belongsTo)
			const parentCat = await forja.create("category", {
				name: "Parent of Favorite",
				slug: "parent-of-favorite",
			});

			// Update favorite category to have parent
			await forja.update("category", favCategoryId, {
				parent: parentCat.id,
			});

			const user = await forja.findById("user", userWithFavCatId, {
				populate: {
					favoriteCategory: {
						populate: {
							parent: true,
						},
					},
				},
			});

			const favCat = user!.favoriteCategory as { parent: { name: string } };
			expect(favCat.parent).toBeDefined();
			expect(favCat.parent.name).toBe("Parent of Favorite");
		});
	});
});
