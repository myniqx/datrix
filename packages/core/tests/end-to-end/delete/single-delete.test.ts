/**
 * Single Delete Tests
 *
 * Tests for forja.delete() and forja.deleteMany()
 *
 * Covers:
 * - Delete by id
 * - Delete multiple by where
 * - Return deleted record
 * - Non-existent record handling
 * - ManyToMany junction table cleanup
 * - Cascade behavior
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Forja } from "@forja/core";
import fs from "node:fs/promises";
import { createTestConfig, getTmpDir, setupTables } from "../setup";
import { expectForjaErrorAsync } from "@forja/types/test/helpers";

describe("Delete Operations", () => {
	let forja: Forja;
	const tmpDir = getTmpDir("single_delete");

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
	// Single Delete (by id)
	// ==========================================================================

	describe("delete (by id)", () => {
		it("should delete record by id", async () => {
			const org = await forja.create("organization", {
				name: "Delete Test Org",
				country: "USA",
			});

			const result = await forja.delete("organization", org.id);

			expect(result.id).toBe(org.id);

			// Verify deleted
			const found = await forja.findById("organization", org.id);
			expect(found).toBeNull();
		});

		it("should return deleted record", async () => {
			const org = await forja.create("organization", {
				name: "Return Delete Org",
				country: "UK",
				isActive: true,
			});

			const result = await forja.delete("organization", org.id);

			expect(result).toHaveProperty("id");
			expect(result).toHaveProperty("name");
			expect(result.name).toBe("Return Delete Org");
			expect(result).toHaveProperty("country");
			expect(result).toHaveProperty("createdAt");
			expect(result).toHaveProperty("updatedAt");
		});

		it("should throw error for non-existent id", async () => {
			await expectForjaErrorAsync(async () => {
				await forja.delete("organization", 99999);
			}, "RECORD_NOT_FOUND");
		});
	});

	// ==========================================================================
	// deleteMany
	// ==========================================================================

	describe("deleteMany", () => {
		it("should delete multiple records by where clause", async () => {
			// Create test data
			await forja.createMany("category", [
				{ name: "Delete Cat 1", slug: "del-cat-1", isActive: false },
				{ name: "Delete Cat 2", slug: "del-cat-2", isActive: false },
				{ name: "Keep Cat", slug: "keep-cat", isActive: true },
			]);

			// Delete inactive categories
			const results = await forja.deleteMany("category", { isActive: false });

			expect(results.length).toBeGreaterThanOrEqual(2);

			// Verify deleted
			const remaining = await forja.findMany("category", {
				where: { slug: { $in: ["del-cat-1", "del-cat-2"] } },
			});
			expect(remaining).toHaveLength(0);

			// Verify kept
			const kept = await forja.findOne("category", { slug: "keep-cat" });
			expect(kept).not.toBeNull();
		});

		it("should return all deleted records", async () => {
			await forja.createMany("role", [
				{ name: "Del Role 1", level: 5 },
				{ name: "Del Role 2", level: 5 },
			]);

			const results = await forja.deleteMany("role", { level: 5 });

			expect(results.length).toBeGreaterThanOrEqual(2);
			for (const role of results) {
				expect(role).toHaveProperty("id");
				expect(role).toHaveProperty("name");
				expect(role.level).toBe(5);
			}
		});

		it("should return empty array when no matches", async () => {
			const results = await forja.deleteMany("organization", {
				name: "Non Existent For Delete",
			});

			expect(results).toHaveLength(0);
			expect(Array.isArray(results)).toBe(true);
		});

		it("should delete all matching records", async () => {
			// Create test orgs
			await forja.createMany("organization", [
				{ name: "Bulk Del Org 1", country: "TestCountry" },
				{ name: "Bulk Del Org 2", country: "TestCountry" },
				{ name: "Bulk Del Org 3", country: "TestCountry" },
			]);

			const beforeCount = await forja.count("organization", {
				country: "TestCountry",
			});
			expect(beforeCount).toBe(3);

			await forja.deleteMany("organization", { country: "TestCountry" });

			const afterCount = await forja.count("organization", {
				country: "TestCountry",
			});
			expect(afterCount).toBe(0);
		});
	});

	// ==========================================================================
	// ManyToMany Junction Table Cleanup
	// ==========================================================================

	describe("ManyToMany Junction Cleanup", () => {
		it("should clean junction table when record with manyToMany is deleted", async () => {
			// Create tags
			const tags = await forja.createMany("tag", [
				{ name: "JunctionTag1", color: "#FF0000" },
				{ name: "JunctionTag2", color: "#00FF00" },
			]);

			// Create user with roles (manyToMany)
			const user = await forja.create("user", {
				email: "junction-test@test.com",
				name: "Junction Test User",
				roles: {
					connect: [
						(await forja.create("role", { name: "JunctionRole1", level: 10 }))
							.id,
						(await forja.create("role", { name: "JunctionRole2", level: 20 }))
							.id,
					],
				},
			});

			// Create category and post with tags (manyToMany)
			const category = await forja.create("category", {
				name: "Junction Category",
				slug: "junction-category",
			});

			const post = await forja.create("post", {
				title: "Junction Test Post",
				content: "Testing junction cleanup",
				slug: "junction-test-post",
				author: user.id,
				category: category.id,
				tags: {
					connect: tags.map((t) => t.id),
				},
			});

			// Verify post has tags
			const postWithTags = await forja.findById("post", post.id, {
				populate: { tags: true },
			});
			expect((postWithTags!["tags"] as unknown[]).length).toBe(2);

			// Delete post
			await forja.delete("post", post.id);

			// Verify post is deleted
			const deletedPost = await forja.findById("post", post.id);
			expect(deletedPost).toBeNull();

			// Tags should still exist (not cascade deleted)
			const remainingTags = await forja.findMany("tag", {
				where: { name: { $in: ["JunctionTag1", "JunctionTag2"] } },
			});
			expect(remainingTags).toHaveLength(2);
		});

		it("should clean junction table when deleting from other side", async () => {
			// Create a tag
			const tag = await forja.create("tag", {
				name: "DeleteSideTag",
				color: "#0000FF",
			});

			// Create user for author
			const user = await forja.create("user", {
				email: "tag-delete@test.com",
				name: "Tag Delete User",
			});

			// Create category
			const category = await forja.create("category", {
				name: "Tag Delete Category",
				slug: "tag-delete-category",
			});

			// Create posts with this tag
			await forja.createMany("post", [
				{
					title: "Post with tag 1",
					content: "Content 1",
					slug: "post-with-tag-1",
					author: user.id,
					category: category.id,
					tags: { connect: [tag.id] },
				},
				{
					title: "Post with tag 2",
					content: "Content 2",
					slug: "post-with-tag-2",
					author: user.id,
					category: category.id,
					tags: { connect: [tag.id] },
				},
			]);

			// Delete the tag
			await forja.delete("tag", tag.id);

			// Verify tag is deleted
			const deletedTag = await forja.findById("tag", tag.id);
			expect(deletedTag).toBeNull();

			// Posts should still exist
			const remainingPosts = await forja.findMany("post", {
				where: { slug: { $in: ["post-with-tag-1", "post-with-tag-2"] } },
			});
			expect(remainingPosts).toHaveLength(2);

			// Posts should have no tags now (junction cleaned)
			for (const post of remainingPosts) {
				const postWithTags = await forja.findById("post", post.id, {
					populate: { tags: true },
				});
				expect((postWithTags!["tags"] as unknown[]).length).toBe(0);
			}
		});
	});

	// ==========================================================================
	// BelongsTo Relation Behavior
	// ==========================================================================

	describe("BelongsTo Relation Behavior", () => {
		it("should allow deleting parent when children exist (no cascade)", async () => {
			const org = await forja.create("organization", {
				name: "Parent Org",
				country: "USA",
			});

			await forja.create("department", {
				name: "Child Dept",
				code: "CHLD",
				organization: org.id,
			});

			// This behavior depends on your implementation
			// Some systems cascade, some set null, some restrict
			// Testing current behavior: should succeed (no FK constraint in JSON adapter)
			const result = await forja.delete("organization", org.id);
			expect(result.id).toBe(org.id);
		});
	});

	// ==========================================================================
	// Select Option
	// ==========================================================================

	describe("Select Option", () => {
		it("should return only selected fields from deleted record", async () => {
			const org = await forja.create("organization", {
				name: "Select Delete Org",
				country: "USA",
				isActive: true,
			});

			const result = await forja.delete("organization", org.id, {
				select: ["id", "name"],
			});

			expect(result).toHaveProperty("id");
			expect(result).toHaveProperty("name");
			expect(result).toHaveProperty("createdAt");
			expect(result).toHaveProperty("updatedAt");
			expect(result).not.toHaveProperty("country");
			expect(result).not.toHaveProperty("isActive");
		});
	});

	// ==========================================================================
	// Edge Cases
	// ==========================================================================

	describe("Edge Cases", () => {
		it("should handle deleting record with null relations", async () => {
			const user = await forja.create("user", {
				email: "null-rel-delete@test.com",
				name: "Null Relation User",
				// No organization or department
			});

			const result = await forja.delete("user", user.id);
			expect(result.id).toBe(user.id);
		});

		it("should handle deleting record with JSON field", async () => {
			const user = await forja.create("user", {
				email: "json-delete@test.com",
				name: "JSON Delete User",
				metadata: { complex: { nested: { data: true } } },
			});

			const result = await forja.delete("user", user.id);
			expect(result.metadata).toEqual({ complex: { nested: { data: true } } });
		});

		it("should handle deleteMany with complex where", async () => {
			await forja.createMany("user", [
				{
					email: "complex-del-1@test.com",
					name: "Complex Del 1",
					age: 25,
					isActive: true,
				},
				{
					email: "complex-del-2@test.com",
					name: "Complex Del 2",
					age: 30,
					isActive: true,
				},
				{
					email: "complex-del-3@test.com",
					name: "Complex Del 3",
					age: 35,
					isActive: false,
				},
			]);

			// Delete active users over 25
			const results = await forja.deleteMany("user", {
				$and: [{ isActive: true }, { age: { $gt: 25 } }],
			});

			// Should delete "Complex Del 2" (age 30, active)
			expect(results.length).toBeGreaterThanOrEqual(1);
			for (const user of results) {
				expect(user.isActive).toBe(true);
				expect(user.age as number).toBeGreaterThan(25);
			}
		});
	});
});
