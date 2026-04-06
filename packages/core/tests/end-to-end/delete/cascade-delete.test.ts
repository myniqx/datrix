/**
 * Cascade Delete Tests
 *
 * Tests for delete behavior with relations
 *
 * Covers:
 * - ManyToMany junction cleanup
 * - BelongsTo orphan handling
 * - Delete with nested where
 * - Bulk delete with relations
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Datrix } from "@datrix/core";
import fs from "node:fs/promises";
import { createTestConfig, getTmpDir, setupTables } from "../setup";

describe("Cascade Delete", () => {
	let datrix: Datrix;
	const tmpDir = getTmpDir("cascade_delete");

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
	// ManyToMany Junction Cleanup
	// ==========================================================================

	describe("ManyToMany Junction Cleanup", () => {
		it("should clean junction when deleting record with manyToMany", async () => {
			// Create roles
			const roles = await datrix.createMany("role", [
				{ name: "Junction Clean Role 1", level: 10 },
				{ name: "Junction Clean Role 2", level: 20 },
			]);

			// Create user with roles
			const user = await datrix.create("user", {
				email: "junction-clean@test.com",
				name: "Junction Clean User",
				roles: { connect: roles.map((r) => r.id) },
			});

			// Verify junction entries exist
			const userWithRoles = await datrix.findById("user", user.id, {
				populate: { roles: true },
			});
			expect((userWithRoles!.roles as unknown[]).length).toBe(2);

			// Delete user
			await datrix.delete("user", user.id);

			// Roles should still exist
			for (const role of roles) {
				const existingRole = await datrix.findById("role", role.id);
				expect(existingRole).not.toBeNull();
			}
		});

		it("should clean junction from other side", async () => {
			// Create tags
			const tag = await datrix.create("tag", {
				name: "Junction Other Side",
				color: "#ABCDEF",
			});

			// Create posts with this tag
			const category = await datrix.create("category", {
				name: "Junction Post Cat",
				slug: "junction-post-cat",
			});
			const author = await datrix.create("user", {
				email: "junction-other@test.com",
				name: "Junction Other Author",
			});

			const posts = await datrix.createMany("post", [
				{
					title: "Junction Post 1",
					content: "Content 1",
					slug: "junction-post-1",
					author: author.id,
					category: category.id,
					tags: { connect: [tag.id] },
				},
				{
					title: "Junction Post 2",
					content: "Content 2",
					slug: "junction-post-2",
					author: author.id,
					category: category.id,
					tags: { connect: [tag.id] },
				},
			]);

			// Delete tag
			await datrix.delete("tag", tag.id);

			// Posts should still exist but without the tag
			for (const post of posts) {
				const existingPost = await datrix.findById("post", post.id, {
					populate: { tags: true },
				});
				expect(existingPost).not.toBeNull();
				expect((existingPost!.tags as unknown[]).length).toBe(0);
			}
		});

		it("should handle deleting record with multiple manyToMany relations", async () => {
			// Create tags
			const tags = await datrix.createMany("tag", [
				{ name: "Multi M2M Tag 1", color: "#111111" },
				{ name: "Multi M2M Tag 2", color: "#222222" },
			]);

			// Create category, author
			const category = await datrix.create("category", {
				name: "Multi M2M Cat",
				slug: "multi-m2m-cat",
			});
			const author = await datrix.create("user", {
				email: "multi-m2m@test.com",
				name: "Multi M2M Author",
			});

			// Create post with tags
			const post = await datrix.create("post", {
				title: "Multi M2M Post",
				content: "Content",
				slug: "multi-m2m-post",
				author: author.id,
				category: category.id,
				tags: { connect: tags.map((t) => t.id) },
			});

			// Delete post
			await datrix.delete("post", post.id);

			// Tags should still exist
			for (const tag of tags) {
				const existingTag = await datrix.findById("tag", tag.id);
				expect(existingTag).not.toBeNull();
			}

			// Category should still exist
			const existingCat = await datrix.findById("category", category.id);
			expect(existingCat).not.toBeNull();
		});
	});

	// ==========================================================================
	// BelongsTo Orphan Behavior
	// ==========================================================================

	describe("BelongsTo Orphan Handling", () => {
		it("should allow deleting parent (orphan children)", async () => {
			// Note: This depends on your cascade settings
			// Default behavior with JSON adapter: no FK constraints
			const org = await datrix.create("organization", {
				name: "Orphan Org",
				country: "USA",
			});

			await datrix.create("department", {
				name: "Orphan Dept",
				code: "ORPH",
				organization: org.id,
			});

			// Delete org - should succeed (no cascade enforcement in JSON)
			const deleted = await datrix.delete("organization", org.id);
			expect(deleted.id).toBe(org.id);

			// Dept still exists but with orphan reference
			// (In SQL DBs with FK, this would fail or cascade)
		});

		it("should delete child without affecting parent", async () => {
			const org = await datrix.create("organization", {
				name: "Parent Stays Org",
				country: "UK",
			});

			const dept = await datrix.create("department", {
				name: "Child Goes Dept",
				code: "CHGO",
				organization: org.id,
			});

			// Delete child
			await datrix.delete("department", dept.id);

			// Parent should still exist
			const existingOrg = await datrix.findById("organization", org.id);
			expect(existingOrg).not.toBeNull();
		});
	});

	// ==========================================================================
	// Delete with Nested Where
	// ==========================================================================

	describe("Delete with Nested Where", () => {
		it("should delete records by nested relation filter", async () => {
			// Create orgs
			const activeOrg = await datrix.create("organization", {
				name: "Active Delete Org",
				country: "USA",
				isActive: true,
			});
			const inactiveOrg = await datrix.create("organization", {
				name: "Inactive Delete Org",
				country: "UK",
				isActive: false,
			});

			// Create users in each org
			await datrix.createMany("user", [
				{
					email: "active-org-user1@test.com",
					name: "Active 1",
					organization: activeOrg.id,
				},
				{
					email: "active-org-user2@test.com",
					name: "Active 2",
					organization: activeOrg.id,
				},
				{
					email: "inactive-org-user@test.com",
					name: "Inactive",
					organization: inactiveOrg.id,
				},
			]);

			// Delete users in inactive org
			const deleted = await datrix.deleteMany("user", {
				organization: { isActive: false },
			});

			expect(deleted).toHaveLength(1);
			expect(deleted[0].name).toBe("Inactive");

			// Users in active org should remain
			const remaining = await datrix.findMany("user", {
				where: { organization: { id: activeOrg.id } },
			});
			expect(remaining).toHaveLength(2);
		});

		it("should delete by deep nested where", async () => {
			// Setup hierarchy
			const country = await datrix.create("organization", {
				name: "Deep Delete Org",
				country: "Germany",
			});

			const dept = await datrix.create("department", {
				name: "Deep Delete Dept",
				code: "DEEP",
				organization: country.id,
			});

			await datrix.createMany("user", [
				{ email: "deep1@test.com", name: "Deep User 1", department: dept.id },
				{ email: "deep2@test.com", name: "Deep User 2", department: dept.id },
			]);

			// Delete users where department's org is in Germany
			const deleted = await datrix.deleteMany("user", {
				department: {
					organization: { country: "Germany" },
				},
			});

			expect(deleted).toHaveLength(2);
		});
	});

	// ==========================================================================
	// Bulk Delete Scenarios
	// ==========================================================================

	describe("Bulk Delete Scenarios", () => {
		it("should delete multiple records with manyToMany", async () => {
			// Create roles
			const sharedRole = await datrix.create("role", {
				name: "Shared Bulk Role",
				level: 30,
			});

			// Create users sharing the role
			const users = await datrix.createMany("user", [
				{
					email: "bulk-m2m-1@test.com",
					name: "Bulk M2M 1",
					roles: { connect: [sharedRole.id] },
				},
				{
					email: "bulk-m2m-2@test.com",
					name: "Bulk M2M 2",
					roles: { connect: [sharedRole.id] },
				},
				{
					email: "bulk-m2m-3@test.com",
					name: "Bulk M2M 3",
					roles: { connect: [sharedRole.id] },
				},
			]);

			// Delete all users with this role
			const deleted = await datrix.deleteMany("user", {
				email: { $like: "bulk-m2m-%@test.com" },
			});

			expect(deleted).toHaveLength(3);

			// Role should still exist
			const existingRole = await datrix.findById("role", sharedRole.id);
			expect(existingRole).not.toBeNull();
		});

		it("should delete posts and clean all tag junctions", async () => {
			// Create shared resources
			const category = await datrix.create("category", {
				name: "Bulk Post Cat",
				slug: "bulk-post-cat",
			});
			const author = await datrix.create("user", {
				email: "bulk-post-author@test.com",
				name: "Bulk Post Author",
			});
			const tags = await datrix.createMany("tag", [
				{ name: "Bulk Tag A", color: "#AAAAAA" },
				{ name: "Bulk Tag B", color: "#BBBBBB" },
			]);

			// Create multiple posts with tags
			await datrix.createMany("post", [
				{
					title: "Bulk Delete Post 1",
					content: "Content",
					slug: "bulk-del-1",
					isPublished: false,
					author: author.id,
					category: category.id,
					tags: { connect: tags.map((t) => t.id) },
				},
				{
					title: "Bulk Delete Post 2",
					content: "Content",
					slug: "bulk-del-2",
					isPublished: false,
					author: author.id,
					category: category.id,
					tags: { connect: [tags[0].id] },
				},
			]);

			// Delete all unpublished posts
			const deleted = await datrix.deleteMany("post", { isPublished: false });

			expect(deleted.length).toBeGreaterThanOrEqual(2);

			// Tags should still exist
			for (const tag of tags) {
				const existingTag = await datrix.findById("tag", tag.id);
				expect(existingTag).not.toBeNull();
			}
		});
	});

	// ==========================================================================
	// Self-Referencing Delete
	// ==========================================================================

	describe("Self-Referencing Delete", () => {
		it("should delete parent category (children become orphan)", async () => {
			const parent = await datrix.create("category", {
				name: "SR Delete Parent",
				slug: "sr-delete-parent",
			});

			const child = await datrix.create("category", {
				name: "SR Delete Child",
				slug: "sr-delete-child",
				parent: parent.id,
			});

			// Delete parent
			await datrix.delete("category", parent.id);

			// Child should still exist
			const existingChild = await datrix.findById("category", child.id);
			expect(existingChild).not.toBeNull();

			// Child's parent reference is now orphan (points to non-existent)
		});

		it("should delete child without affecting parent", async () => {
			const parent = await datrix.create("category", {
				name: "SR Keep Parent",
				slug: "sr-keep-parent",
			});

			const child = await datrix.create("category", {
				name: "SR Delete Child 2",
				slug: "sr-delete-child-2",
				parent: parent.id,
			});

			// Delete child
			await datrix.delete("category", child.id);

			// Parent should still exist
			const existingParent = await datrix.findById("category", parent.id);
			expect(existingParent).not.toBeNull();
		});

		it("should delete by parent filter", async () => {
			const parent = await datrix.create("category", {
				name: "Filter Parent",
				slug: "filter-parent",
			});

			await datrix.createMany("category", [
				{ name: "Filter Child 1", slug: "filter-child-1", parent: parent.id },
				{ name: "Filter Child 2", slug: "filter-child-2", parent: parent.id },
			]);

			// Delete all children of this parent
			const deleted = await datrix.deleteMany("category", {
				parent: { id: parent.id },
			});

			expect(deleted).toHaveLength(2);

			// Parent should still exist
			const existingParent = await datrix.findById("category", parent.id);
			expect(existingParent).not.toBeNull();
		});
	});

	// ==========================================================================
	// Edge Cases
	// ==========================================================================

	describe("Edge Cases", () => {
		it("should handle delete of record with no relations", async () => {
			const role = await datrix.create("role", {
				name: "Isolated Role",
				level: 99,
			});

			const deleted = await datrix.delete("role", role.id);
			expect(deleted.name).toBe("Isolated Role");
		});

		it("should handle deleteMany returning empty when no match", async () => {
			const deleted = await datrix.deleteMany("organization", {
				name: "Absolutely Non Existent Organization Name 12345",
			});

			expect(deleted).toHaveLength(0);
		});

		it("should handle delete with complex $and/$or in where", async () => {
			await datrix.createMany("user", [
				{
					email: "complex-del-a@test.com",
					name: "Complex A",
					age: 20,
					isActive: true,
				},
				{
					email: "complex-del-b@test.com",
					name: "Complex B",
					age: 40,
					isActive: true,
				},
				{
					email: "complex-del-c@test.com",
					name: "Complex C",
					age: 30,
					isActive: false,
				},
			]);

			// Delete: (young AND active) OR (old AND active)
			const deleted = await datrix.deleteMany("user", {
				$or: [
					{ $and: [{ age: { $lt: 25 } }, { isActive: true }] },
					{ $and: [{ age: { $gt: 35 } }, { isActive: true }] },
				],
			});

			expect(deleted).toHaveLength(2);
			const names = deleted.map((u) => u.name);
			expect(names).toContain("Complex A");
			expect(names).toContain("Complex B");
		});
	});
});
