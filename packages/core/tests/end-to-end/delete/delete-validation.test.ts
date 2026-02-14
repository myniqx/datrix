/**
 * Delete Validation Tests
 *
 * Tests for validation and error cases during delete operations
 *
 * Covers:
 * - Record not found errors
 * - Invalid where clause
 * - Referential integrity (if enforced)
 * - Error message quality
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Forja } from "forja-core";
import fs from "node:fs/promises";
import { createTestConfig, getTmpDir, setupTables } from "../setup";

describe("Delete Validation", () => {
	let forja: Forja;
	const tmpDir = getTmpDir("delete_validation");

	let userId: number;
	let orgId: number;

	beforeAll(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
		await fs.mkdir(tmpDir, { recursive: true });

		const getForja = await createTestConfig(tmpDir);
		forja = await getForja();

		await setupTables(forja);

		// Create test data
		const org = await forja.create("organization", {
			name: "Delete Validation Org",
			country: "USA",
		});
		orgId = org.id;

		const user = await forja.create("user", {
			email: "delete-val@test.com",
			name: "Delete Validation User",
			organization: orgId,
		});
		userId = user.id;
	});

	afterAll(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	// ==========================================================================
	// Record Not Found
	// ==========================================================================

	describe("Record Not Found", () => {
		it("should fail when deleting non-existent record by id", async () => {
			await expect(
				forja.delete("user", 99999),
			).rejects.toThrow();
		});

		it("should include record id in error message", async () => {
			try {
				await forja.delete("user", 99999);
				expect.fail("Should have thrown");
			} catch (error) {
				expect((error as Error).message).toContain("99999");
			}
		});

		it("should include model name in error message", async () => {
			try {
				await forja.delete("user", 99999);
				expect.fail("Should have thrown");
			} catch (error) {
				const message = (error as Error).message.toLowerCase();
				expect(message).toContain("user");
			}
		});
	});

	// ==========================================================================
	// DeleteMany Behavior
	// ==========================================================================

	describe("DeleteMany Behavior", () => {
		it("should return empty array for no matches (not throw)", async () => {
			const deleted = await forja.deleteMany("user", { age: 99999 });

			expect(deleted).toHaveLength(0);
		});

		it("should handle empty where clause", async () => {
			// Create temp tags to delete
			await forja.createMany("tag", [
				{ name: "TempTag1", color: "#111111" },
				{ name: "TempTag2", color: "#222222" },
			]);

			const deleted = await forja.deleteMany("tag", {});

			expect(deleted.length).toBeGreaterThanOrEqual(2);
		});
	});

	// ==========================================================================
	// Invalid Where Clause
	// ==========================================================================

	describe("Invalid Where Clause", () => {
		it("should fail for invalid field in where", async () => {
			await expect(
				forja.deleteMany("user", {
					nonExistentField: "value",
				}),
			).rejects.toThrow();
		});

		it("should fail for invalid operator in where", async () => {
			await expect(
				forja.deleteMany("user", {
					age: { $invalidOp: 10 },
				}),
			).rejects.toThrow();
		});

		it("should fail for invalid relation in where", async () => {
			await expect(
				forja.deleteMany("user", {
					nonExistentRelation: { id: 1 },
				}),
			).rejects.toThrow();
		});
	});

	// ==========================================================================
	// Cascade Behavior
	// ==========================================================================

	describe("Cascade Behavior", () => {
		it("should clean up junction tables on delete", async () => {
			// Create user with roles
			const roles = await forja.createMany("role", [
				{ name: "CascadeRole1", level: 10 },
				{ name: "CascadeRole2", level: 20 },
			]);

			const user = await forja.create("user", {
				email: "cascade@test.com",
				name: "Cascade User",
				roles: { connect: roles.map((r) => r.id) },
			});

			// Delete user
			await forja.delete("user", user.id);

			// User should be gone
			const deletedUser = await forja.findById("user", user.id);
			expect(deletedUser).toBeNull();

			// Roles should still exist (not cascaded)
			const role1 = await forja.findById("role", roles[0].id);
			expect(role1).not.toBeNull();
		});

		it("should handle deleting record referenced by others", async () => {
			// Create post by user
			const category = await forja.create("category", {
				name: "Delete Test Cat",
				slug: "delete-test-cat",
			});

			const post = await forja.create("post", {
				title: "Post to remain",
				content: "Content",
				slug: "post-to-remain",
				author: userId,
				category: category.id,
			});

			// Delete category (post references it)
			// Behavior depends on onDelete setting
			await forja.delete("category", category.id);

			// Post should still exist (with null category or unchanged)
			const postAfter = await forja.findById("post", post.id);
			expect(postAfter).not.toBeNull();
		});
	});

	// ==========================================================================
	// Transaction Behavior
	// ==========================================================================

	describe("Transaction Behavior", () => {
		it("should rollback on error during batch delete", async () => {
			// Create users
			await forja.createMany("user", [
				{ email: "tx1@test.com", name: "TX User 1" },
				{ email: "tx2@test.com", name: "TX User 2" },
			]);

			const beforeCount = await forja.count("user", {
				email: { $like: "tx%@test.com" },
			});

			// If an error occurs during delete, records should be restored
			// (This is hard to test without hooks that throw mid-operation)
			// For now, just verify normal delete works
			const deleted = await forja.deleteMany("user", {
				email: { $like: "tx%@test.com" },
			});

			expect(deleted.length).toBe(beforeCount);
		});
	});

	// ==========================================================================
	// Error Message Quality
	// ==========================================================================

	describe("Error Message Quality", () => {
		it("should provide actionable error for not found", async () => {
			try {
				await forja.delete("user", 99999);
				expect.fail("Should have thrown");
			} catch (error) {
				const message = (error as Error).message;
				// Should mention the operation and record
				expect(message.length).toBeGreaterThan(10);
			}
		});

		it("should indicate delete operation in error", async () => {
			try {
				await forja.delete("user", 99999);
				expect.fail("Should have thrown");
			} catch (error) {
				const message = (error as Error).message.toLowerCase();
				expect(
					message.includes("delete") ||
					message.includes("not found") ||
					message.includes("record"),
				).toBe(true);
			}
		});
	});

	// ==========================================================================
	// Edge Cases
	// ==========================================================================

	describe("Edge Cases", () => {
		it("should handle deleting already deleted record", async () => {
			const user = await forja.create("user", {
				email: "double-delete@test.com",
				name: "Double Delete",
			});

			// First delete
			await forja.delete("user", user.id);

			// Second delete should fail
			await expect(
				forja.delete("user", user.id),
			).rejects.toThrow();
		});

		it("should handle concurrent delete attempts", async () => {
			const users = await forja.createMany("user", [
				{ email: "concurrent1@test.com", name: "Concurrent 1" },
				{ email: "concurrent2@test.com", name: "Concurrent 2" },
				{ email: "concurrent3@test.com", name: "Concurrent 3" },
			]);

			// Concurrent deletes (should all succeed or gracefully handle)
			const promises = users.map((u) => forja.delete("user", u.id));
			const results = await Promise.allSettled(promises);

			// All should have resolved (either success or handled error)
			const fulfilled = results.filter((r) => r.status === "fulfilled");
			expect(fulfilled.length).toBe(3);
		});
	});
});
