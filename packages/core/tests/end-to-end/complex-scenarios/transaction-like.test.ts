/**
 * Transaction-Like Behavior Tests
 *
 * Tests for multi-step operations that should behave atomically
 *
 * Covers:
 * - Create with relations (should all succeed or all fail)
 * - Update with relations
 * - Bulk operations atomicity
 * - Error recovery
 * - Data consistency after failures
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Forja } from "forja-core";
import fs from "node:fs/promises";
import { createTestConfig, getTmpDir, setupTables } from "../setup";
import { ForjaEntry } from "forja-types";

describe("Transaction-Like Behavior", () => {
	let forja: Forja;
	const tmpDir = getTmpDir("transaction_like");

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
	// Create with Relations Atomicity
	// ==========================================================================

	describe("Create with Relations Atomicity", () => {
		it("should rollback create if relation fails", async () => {
			const beforeCount = await forja.count("user");

			// Try to create user with non-existent organization
			await expect(
				forja.create("user", {
					email: "tx-fail@test.com",
					name: "TX Fail User",
					organization: 99999, // Non-existent
				}),
			).rejects.toThrow();

			// User should not have been created
			const afterCount = await forja.count("user");
			expect(afterCount).toBe(beforeCount);
		});

		it("should rollback create if manyToMany relation fails", async () => {
			const beforeUserCount = await forja.count("user");

			// Try to create user with non-existent role
			await expect(
				forja.create("user", {
					email: "tx-m2m-fail@test.com",
					name: "TX M2M Fail",
					roles: { connect: [99999] },
				}),
			).rejects.toThrow();

			// User should not have been created
			const afterUserCount = await forja.count("user");
			expect(afterUserCount).toBe(beforeUserCount);
		});

		it("should succeed when all relations are valid", async () => {
			// Create valid organization and roles
			const org = await forja.create("organization", {
				name: "TX Success Org",
				country: "USA",
			});

			const roles = await forja.createMany("role", [
				{ name: "TX Role 1", level: 10 },
				{ name: "TX Role 2", level: 20 },
			]);

			// Create user with all valid relations
			const user = await forja.create("user", {
				email: "tx-success@test.com",
				name: "TX Success User",
				organization: org.id,
				roles: { connect: roles.map((r) => r.id) },
			});

			expect(user).toBeDefined();

			// Verify relations
			const fetched = await forja.findById("user", user.id, {
				populate: {
					organization: { select: "*" },
					roles: { select: "*" },
				},
			});

			expect(fetched!["organization"]).not.toBeNull();
			expect((fetched!["roles"] as []).length).toBe(2);
		});
	});

	// ==========================================================================
	// Bulk Operations Atomicity
	// ==========================================================================

	describe("Bulk Operations Atomicity", () => {
		it("should rollback all if one create fails validation", async () => {
			const beforeCount = await forja.count("user");

			// One invalid item in batch
			await expect(
				forja.createMany("user", [
					{ email: "bulk-tx-1@test.com", name: "Bulk TX 1" },
					{ email: "bulk-tx-2@test.com", name: "Bulk TX 2" },
					{ email: "bulk-tx-3@test.com" }, // Missing name - might pass depending on schema
				]),
			).rejects.toThrow();

			// None should have been created
			const afterCount = await forja.count("user");
			expect(afterCount).toBe(beforeCount);
		});

		it("should rollback all if unique constraint fails", async () => {
			// Create first user
			await forja.create("user", {
				email: "unique-tx@test.com",
				name: "Unique TX User",
			});

			const beforeCount = await forja.count("user");

			// Try batch with duplicate email
			await expect(
				forja.createMany("user", [
					{ email: "bulk-unique-1@test.com", name: "Bulk 1" },
					{ email: "unique-tx@test.com", name: "Duplicate" }, // Duplicate
					{ email: "bulk-unique-2@test.com", name: "Bulk 2" },
				]),
			).rejects.toThrow();

			// None of the new ones should have been created
			const afterCount = await forja.count("user");
			expect(afterCount).toBe(beforeCount);
		});
	});

	// ==========================================================================
	// Update with Relations Atomicity
	// ==========================================================================

	describe("Update with Relations Atomicity", () => {
		it("should rollback update if relation connect fails", async () => {
			const user = await forja.create("user", {
				email: "update-tx@test.com",
				name: "Update TX User",
			});

			const originalName = user["name"];

			// Try to update with invalid role
			await expect(
				forja.update("user", user.id, {
					name: "Updated Name",
					roles: { connect: [99999] },
				}),
			).rejects.toThrow();

			// Verify user name was not changed
			const fetched = await forja.findById("user", user.id);
			expect(fetched!["name"]).toBe(originalName);
		});

		it("should rollback update if validation fails", async () => {
			const user = await forja.create("user", {
				email: "update-val-tx@test.com",
				name: "Update Val TX",
				age: 30,
			});

			// Try to update with invalid age
			await expect(
				forja.update("user", user.id, {
					name: "New Name",
					age: -10, // Invalid
				}),
			).rejects.toThrow();

			// Verify nothing changed
			const fetched = await forja.findById<
				ForjaEntry & { age: number; name: string }
			>("user", user.id);
			expect(fetched!.name).toBe("Update Val TX");
			expect(fetched!.age).toBe(30);
		});
	});

	// ==========================================================================
	// Data Consistency
	// ==========================================================================

	describe("Data Consistency", () => {
		it("should maintain junction table consistency", async () => {
			// Create user and roles
			const roles = await forja.createMany("role", [
				{ name: "Consistency Role 1", level: 10 },
				{ name: "Consistency Role 2", level: 20 },
			]);

			const user = await forja.create("user", {
				email: "consistency@test.com",
				name: "Consistency User",
				roles: { connect: roles.map((r) => r.id) },
			});

			// Verify initial state
			let fetched = await forja.findById<ForjaEntry & { roles: ForjaEntry[] }>(
				"user",
				user.id,
				{
					populate: { roles: { select: "*" } },
				},
			);
			expect((fetched!.roles as unknown[]).length).toBe(2);

			// Disconnect one role
			await forja.update("user", user.id, {
				roles: { disconnect: [roles[0]!.id] },
			});

			// Verify state
			fetched = await forja.findById("user", user.id, {
				populate: { roles: { select: "*" } },
			});
			expect((fetched!.roles as unknown[]).length).toBe(1);

			// Set to empty
			await forja.update("user", user.id, {
				roles: { set: [] },
			});

			// Verify empty
			fetched = await forja.findById("user", user.id, {
				populate: { roles: { select: "*" } },
			});
			expect((fetched!.roles as unknown[]).length).toBe(0);

			// Roles should still exist
			for (const role of roles) {
				const exists = await forja.findById("role", role.id);
				expect(exists).not.toBeNull();
			}
		});

		it("should maintain FK consistency on delete", async () => {
			// Create org and users
			const org = await forja.create("organization", {
				name: "FK Consistency Org",
				country: "USA",
			});

			const users = await forja.createMany("user", [
				{
					email: "fk-user-1@test.com",
					name: "FK User 1",
					organization: org.id,
				},
				{
					email: "fk-user-2@test.com",
					name: "FK User 2",
					organization: org.id,
				},
			]);

			// Delete organization
			await forja.delete("organization", org.id);

			// Users should still exist (FK becomes null or behavior depends on schema)
			for (const user of users) {
				const exists = await forja.findById("user", user.id);
				expect(exists).not.toBeNull();
			}
		});
	});

	// ==========================================================================
	// Recovery After Failure
	// ==========================================================================

	describe("Recovery After Failure", () => {
		it("should allow retry after failed create", async () => {
			// First attempt fails
			await expect(
				forja.create("user", {
					email: "retry@test.com",
					name: "Retry User",
					organization: 99999,
				}),
			).rejects.toThrow();

			// Create valid organization
			const org = await forja.create("organization", {
				name: "Retry Org",
				country: "USA",
			});

			// Retry should succeed
			const user = await forja.create("user", {
				email: "retry@test.com",
				name: "Retry User",
				organization: org.id,
			});

			expect(user).toBeDefined();
		});

		it("should allow operations after bulk failure", async () => {
			// Failed bulk create
			await expect(
				forja.createMany("department", [
					{ name: "Recovery Dept 1", code: "RD1" }, // Invalid code
				]),
			).rejects.toThrow();

			// Should be able to create valid records after
			const org = await forja.create("organization", {
				name: "Recovery Org",
				country: "USA",
			});

			const dept = await forja.create("department", {
				name: "Recovery Dept",
				code: "RDPT",
				organization: org.id,
			});

			expect(dept).toBeDefined();
		});
	});

	// ==========================================================================
	// Complex Multi-Step Operations
	// ==========================================================================

	describe("Complex Multi-Step Operations", () => {
		it("should handle create user -> create posts -> create comments flow", async () => {
			// Step 1: Create user
			const user = await forja.create("user", {
				email: "flow@test.com",
				name: "Flow User",
			});

			// Step 2: Create category
			const category = await forja.create("category", {
				name: "Flow Category",
				slug: "flow-category",
			});

			// Step 3: Create post
			const post = await forja.create("post", {
				title: "Flow Post",
				content: "Flow content",
				slug: "flow-post",
				author: user.id,
				category: category.id,
			});

			// Step 4: Create comment
			const comment = await forja.create("comment", {
				content: "Flow comment",
				post: post.id,
				author: user.id,
			});

			// Verify entire chain
			const fetchedComment = await forja.findById<
				ForjaEntry & {
					author: ForjaEntry & { name: string };
					post: ForjaEntry & {
						title: string;
						author: ForjaEntry & { name: string };
						category: ForjaEntry & { name: string };
					};
				}
			>("comment", comment.id, {
				populate: {
					author: { select: "*" },
					post: {
						select: "*",
						populate: {
							author: { select: "*" },
							category: { select: "*" },
						},
					},
				},
			});

			expect(fetchedComment).not.toBeNull();
			expect((fetchedComment!.author as { name: string }).name).toBe(
				"Flow User",
			);

			const postData = fetchedComment!.post;
			expect(postData.title).toBe("Flow Post");
			expect(postData.author.name).toBe("Flow User");
			expect(postData.category.name).toBe("Flow Category");
		});
	});
});
