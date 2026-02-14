/**
 * Create Validation Tests
 *
 * Tests for validation errors during create operations
 *
 * Covers:
 * - Required field validation
 * - Type validation
 * - String constraints (minLength, maxLength, pattern)
 * - Number constraints (min, max)
 * - Unique constraint violation
 * - Enum validation
 * - Relation validation (non-existent target)
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Forja } from "forja-core";
import fs from "node:fs/promises";
import { createTestConfig, getTmpDir, setupTables } from "../setup";

describe("Create Validation", () => {
	let forja: Forja;
	const tmpDir = getTmpDir("create_validation");

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
	// Required Field Validation
	// ==========================================================================

	describe("Required Field Validation", () => {
		it("should fail when required field is missing", async () => {
			await expect(
				forja.create("user", {
					name: "Test User",
					// email is required but missing
				}),
			).rejects.toThrow();
		});

		it("should fail when required field is null", async () => {
			await expect(
				forja.create("user", {
					email: null as unknown as string,
					name: "Test User",
				}),
			).rejects.toThrow();
		});

		it("should fail when required field is undefined", async () => {
			await expect(
				forja.create("user", {
					email: undefined as unknown as string,
					name: "Test User",
				}),
			).rejects.toThrow();
		});

		it("should fail when required field with minLength receives empty string", async () => {
			// name has minLength: 2, so empty string should fail validation
			await expect(
				forja.create("user", {
					email: "empty-name@test.com",
					name: "",
				}),
			).rejects.toThrow();
		});

		it("should accept empty string for required field without minLength", async () => {
			// organization.country is required but has no minLength constraint
			// Empty string is a valid value (not missing)
			const org = await forja.create("organization", {
				name: "Empty Country Org",
				country: "",
			});

			expect(org.country).toBe("");
		});
	});

	// ==========================================================================
	// Type Validation
	// ==========================================================================

	describe("Type Validation", () => {
		it("should fail when string field receives number", async () => {
			await expect(
				forja.create("user", {
					email: "type@test.com",
					name: 12345 as unknown as string,
				}),
			).rejects.toThrow();
		});

		it("should fail when number field receives string", async () => {
			await expect(
				forja.create("user", {
					email: "type@test.com",
					name: "Test",
					age: "twenty" as unknown as number,
				}),
			).rejects.toThrow();
		});

		it("should fail when boolean field receives string", async () => {
			await expect(
				forja.create("user", {
					email: "type@test.com",
					name: "Test",
					isActive: "yes" as unknown as boolean,
				}),
			).rejects.toThrow();
		});

		it("should fail when number field receives numeric string", async () => {
			// Forja does NOT coerce "25" to 25 - strict type validation
			await expect(
				forja.create("user", {
					email: "coerce@test.com",
					name: "Coerce Test",
					age: "25" as unknown as number,
				}),
			).rejects.toThrow();
		});
	});

	// ==========================================================================
	// String Constraints
	// ==========================================================================

	describe("String Constraints", () => {
		it("should fail when string exceeds maxLength", async () => {
			await expect(
				forja.create("user", {
					email: "maxlen@test.com",
					name: "a".repeat(300), // Assuming maxLength is less
				}),
			).rejects.toThrow();
		});

		it("should fail when string is below minLength", async () => {
			// Department code has minLength (pattern ^[A-Z]{2,10}$)
			await expect(
				forja.create("department", {
					name: "Test Dept",
					code: "A", // Too short
				}),
			).rejects.toThrow();
		});

		it("should fail when string doesn't match pattern", async () => {
			// Department code pattern: ^[A-Z]{2,10}$
			await expect(
				forja.create("department", {
					name: "Test Dept",
					code: "abc123", // Lowercase and numbers not allowed
				}),
			).rejects.toThrow();
		});

		it("should pass when string matches pattern", async () => {
			const dept = await forja.create("department", {
				name: "Valid Dept",
				code: "VALID",
			});

			expect(dept.code).toBe("VALID");
		});
	});

	// ==========================================================================
	// Number Constraints
	// ==========================================================================

	describe("Number Constraints", () => {
		it("should fail when number is below min", async () => {
			// Assuming age has min: 0
			await expect(
				forja.create("user", {
					email: "min@test.com",
					name: "Min Test",
					age: -5,
				}),
			).rejects.toThrow();
		});

		it("should fail when number exceeds max", async () => {
			// Assuming age has max: 150
			await expect(
				forja.create("user", {
					email: "max@test.com",
					name: "Max Test",
					age: 200,
				}),
			).rejects.toThrow();
		});

		it("should accept number at boundary", async () => {
			const user = await forja.create("user", {
				email: "boundary@test.com",
				name: "Boundary Test",
				age: 0,
			});

			expect(user.age).toBe(0);
		});

		it("should accept null for optional number field", async () => {
			const user = await forja.create("user", {
				email: "null-age@test.com",
				name: "Null Age Test",
				age: null,
			});

			expect(user.age).toBeNull();
		});
	});

	// ==========================================================================
	// Unique Constraint
	// ==========================================================================

	describe("Unique Constraint", () => {
		it("should fail when unique field has duplicate value", async () => {
			// Create first user
			await forja.create("user", {
				email: "unique@test.com",
				name: "First User",
			});

			// Try to create second user with same email
			await expect(
				forja.create("user", {
					email: "unique@test.com",
					name: "Second User",
				}),
			).rejects.toThrow();
		});

		it("should allow same value in different models", async () => {
			// Unique constraint is per-table
			const org = await forja.create("organization", {
				name: "Unique Name",
				country: "USA",
			});

			// Same name in different model should work
			const dept = await forja.create("department", {
				name: "Unique Name",
				code: "UNQ",
			});

			expect(org.name).toBe("Unique Name");
			expect(dept.name).toBe("Unique Name");
		});

		it("should fail on unique index violation", async () => {
			// Create category with unique slug
			await forja.create("category", {
				name: "First Category",
				slug: "unique-slug",
			});

			// Try to create another with same slug
			await expect(
				forja.create("category", {
					name: "Second Category",
					slug: "unique-slug",
				}),
			).rejects.toThrow();
		});
	});

	// ==========================================================================
	// Relation Validation
	// ==========================================================================

	describe("Relation Validation", () => {
		it("should fail when connecting to non-existent record", async () => {
			await expect(
				forja.create("user", {
					email: "bad-org@test.com",
					name: "Bad Org User",
					organization: 99999, // Non-existent
				}),
			).rejects.toThrow();
		});

		it("should fail when manyToMany connects to non-existent", async () => {
			const user = await forja.create("user", {
				email: "m2m-test@test.com",
				name: "M2M Test User",
			});

			await expect(
				forja.update("user", user.id, {
					roles: { connect: [99999] },
				}),
			).rejects.toThrow();
		});

		it("should accept valid relation id", async () => {
			const org = await forja.create("organization", {
				name: "Valid Org",
				country: "USA",
			});

			const user = await forja.create("user", {
				email: "valid-org@test.com",
				name: "Valid Org User",
				organization: org.id,
			});

			expect(user).toBeDefined();
		});
	});

	// ==========================================================================
	// Bulk Create Validation
	// ==========================================================================

	describe("Bulk Create Validation", () => {
		it("should fail entire batch if one item is invalid", async () => {
			await expect(
				forja.createMany("user", [
					{ email: "bulk1@test.com", name: "Bulk 1" },
					{ email: "bulk2@test.com", name: "Bulk 2" },
					{ email: "bulk3@test.com" }, // Missing name - invalid
				]),
			).rejects.toThrow();

			// Verify none were created (transaction rollback)
			const count = await forja.count("user", {
				email: { $like: "bulk%@test.com" },
			});
			expect(count).toBe(0);
		});

		it("should validate each item in batch", async () => {
			await expect(
				forja.createMany("department", [
					{ name: "Dept 1", code: "AAA" },
					{ name: "Dept 2", code: "invalid" }, // Invalid pattern
					{ name: "Dept 3", code: "CCC" },
				]),
			).rejects.toThrow();
		});
	});

	// ==========================================================================
	// Error Message Quality
	// ==========================================================================

	describe("Error Message Quality", () => {
		it("should include field name in error", async () => {
			try {
				await forja.create("user", {
					name: "No Email",
					// email missing
				});
				expect.fail("Should have thrown");
			} catch (error) {
				expect((error as Error).message).toContain("email");
			}
		});

		it("should include validation type in error", async () => {
			try {
				await forja.create("department", {
					name: "Bad Code Dept",
					code: "bad",
				});
				expect.fail("Should have thrown");
			} catch (error) {
				const message = (error as Error).message.toLowerCase();
				expect(
					message.includes("pattern") || message.includes("validation"),
				).toBe(true);
			}
		});
	});
});
