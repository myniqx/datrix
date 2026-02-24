/**
 * Single Create Tests
 *
 * Tests for forja.create() - single record creation
 *
 * Covers:
 * - Basic record creation
 * - Default values
 * - Auto-generated fields (id, createdAt, updatedAt)
 * - Validation (required, minLength, maxLength, min, max, pattern)
 * - Unique constraints
 * - Relation creation (belongsTo with existing ID)
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Forja } from "forja-core";
import fs from "node:fs/promises";
import {
	createTestConfig,
	getTmpDir,
	setupTables,
	expectAutoFields,
	expectValidTimestamps,
} from "../setup";
import { expectForjaErrorAsync } from "forja-types/test/helpers";

describe("Single Create", () => {
	let forja: Forja;
	const tmpDir = getTmpDir("single_create");

	beforeAll(async () => {
		// Clean and create temp directory
		await fs.rm(tmpDir, { recursive: true, force: true });
		await fs.mkdir(tmpDir, { recursive: true });

		// Initialize Forja
		const getForja = await createTestConfig(tmpDir);
		forja = await getForja();

		// Setup tables
		await setupTables(forja);
	});

	afterAll(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	// ==========================================================================
	// Basic Creation
	// ==========================================================================

	describe("Basic Creation", () => {
		it("should create a simple record with required fields only", async () => {
			const result = await forja.create("organization", {
				name: "Test Org",
				country: "USA",
			});

			expect(result).toHaveProperty("id");
			expect(result.name).toBe("Test Org");
			expect(result.country).toBe("USA");
		});

		it("should create a record with all fields", async () => {
			const result = await forja.create("organization", {
				name: "Full Org",
				country: "UK",
				isActive: false,
			});

			expect(result.name).toBe("Full Org");
			expect(result.country).toBe("UK");
			expect(result.isActive).toBe(false);
		});

		it("should auto-generate id, createdAt, updatedAt", async () => {
			const result = await forja.create("organization", {
				name: "Auto Fields Org",
				country: "Germany",
			});

			expectAutoFields(result);
			expectValidTimestamps(result);
		});

		it("should set default values when not provided", async () => {
			const result = await forja.create("organization", {
				name: "Default Org",
				country: "France",
			});

			// isActive has default: true
			expect(result.isActive).toBe(true);
		});

		it("should override default values when provided", async () => {
			const result = await forja.create("organization", {
				name: "Override Org",
				country: "Spain",
				isActive: false,
			});

			expect(result.isActive).toBe(false);
		});
	});

	// ==========================================================================
	// Validation Errors
	// ==========================================================================

	describe("Validation Errors", () => {
		it("should throw error when required field is missing", async () => {
			await expectForjaErrorAsync(async () => {
				await forja.create("organization", {
					country: "USA",
					// name is required but missing
				} as Parameters<typeof forja.create>[1]);
			}, "VALIDATION_FAILED");
		});

		it("should throw error when string is too short (minLength)", async () => {
			await expectForjaErrorAsync(async () => {
				await forja.create("organization", {
					name: "A", // minLength is 2
					country: "USA",
				});
			}, "VALIDATION_FAILED");
		});

		it("should throw error when string is too long (maxLength)", async () => {
			const longName = "A".repeat(201); // maxLength is 200

			await expectForjaErrorAsync(async () => {
				await forja.create("organization", {
					name: longName,
					country: "USA",
				});
			}, "VALIDATION_FAILED");
		});

		it("should throw error when number is below min", async () => {
			// First create an organization for the department
			const org = await forja.create("organization", {
				name: "Budget Test Org",
				country: "USA",
			});

			await expectForjaErrorAsync(async () => {
				await forja.create("department", {
					name: "Test Dept",
					code: "TEST",
					budget: -100, // min is 0
					organization: org.id,
				});
			}, "VALIDATION_FAILED");
		});

		it("should throw error when number is above max", async () => {
			await expectForjaErrorAsync(async () => {
				await forja.create("role", {
					name: "High Level Role",
					level: 150, // max is 100
				});
			}, "VALIDATION_FAILED");
		});

		it("should throw error when pattern does not match", async () => {
			const org = await forja.create("organization", {
				name: "Pattern Test Org",
				country: "USA",
			});

			await expectForjaErrorAsync(async () => {
				await forja.create("department", {
					name: "Test Dept",
					code: "lowercase", // pattern requires ^[A-Z]{2,10}$
					organization: org.id,
				});
			}, "VALIDATION_FAILED");
		});

		it("should throw error when email pattern is invalid", async () => {
			await expectForjaErrorAsync(async () => {
				await forja.create("user", {
					email: "invalid-email", // must match email pattern
					name: "Test User",
				});
			}, "VALIDATION_FAILED");
		});
	});

	// ==========================================================================
	// Unique Constraints
	// ==========================================================================

	describe("Unique Constraints", () => {
		it("should throw error when unique field value already exists", async () => {
			// First create
			await forja.create("organization", {
				name: "Unique Org",
				country: "USA",
			});

			// Try to create duplicate - adapter throws ADAPTER_UNIQUE_CONSTRAINT
			await expectForjaErrorAsync(async () => {
				await forja.create("organization", {
					name: "Unique Org", // name is unique
					country: "UK",
				});
			}, "ADAPTER_UNIQUE_CONSTRAINT");
		});

		it("should throw error when unique email already exists", async () => {
			await forja.create("user", {
				email: "unique@test.com",
				name: "First User",
			});

			await expectForjaErrorAsync(async () => {
				await forja.create("user", {
					email: "unique@test.com", // email is unique
					name: "Second User",
				});
			}, "ADAPTER_UNIQUE_CONSTRAINT");
		});
	});

	// ==========================================================================
	// Relations (BelongsTo)
	// ==========================================================================

	describe("BelongsTo Relations", () => {
		it("should create record with belongsTo relation using existing ID", async () => {
			const org = await forja.create("organization", {
				name: "Relation Test Org",
				country: "USA",
			});

			const dept = await forja.create(
				"department",
				{
					name: "Engineering",
					code: "ENGR",
					organization: org.id,
				},
				{ populate: { organization: true } },
			);

			expect(dept).toHaveProperty("id");
			expect(dept.name).toBe("Engineering");
			// Check relation via populated object
			expect(dept.organization).toBeDefined();
			expect((dept.organization as { id: number }).id).toBe(org.id);
		});

		it("should create record with multiple belongsTo relations", async () => {
			const org = await forja.create("organization", {
				name: "Multi Relation Org",
				country: "USA",
			});

			const dept = await forja.create("department", {
				name: "Multi Dept",
				code: "MULTI",
				organization: org.id,
			});

			const user = await forja.create(
				"user",
				{
					email: "multi@test.com",
					name: "Multi User",
					organization: org.id,
					department: dept.id,
				},
				{ populate: { organization: true, department: true } },
			);

			// Check relations via populated objects
			expect(user.organization).toBeDefined();
			expect((user.organization as { id: number }).id).toBe(org.id);
			expect(user.department).toBeDefined();
			expect((user.department as { id: number }).id).toBe(dept.id);
		});

		it("should create record with self-referencing relation", async () => {
			// Parent category
			const parent = await forja.create("category", {
				name: "Parent Category",
				slug: "parent-cat",
			});

			// Child category
			const child = await forja.create(
				"category",
				{
					name: "Child Category",
					slug: "child-cat",
					parent: parent.id,
				},
				{ populate: { parent: true } },
			);

			// Check self-reference via populated object
			expect(child.parent).toBeDefined();
			expect((child.parent as { id: number }).id).toBe(parent.id);
		});

		it("should allow null for optional belongsTo relation", async () => {
			const user = await forja.create(
				"user",
				{
					email: "no-org@test.com",
					name: "No Org User",
					// organization and department are optional
				},
				{ populate: { organization: true, department: true } },
			);

			// Optional relations should be null when not provided
			expect(user.organization).toBeNull();
			expect(user.department).toBeNull();
		});
	});

	// ==========================================================================
	// Select Option
	// ==========================================================================

	describe("Select Option", () => {
		it("should return only selected fields", async () => {
			const result = await forja.create(
				"organization",
				{
					name: "Select Test Org",
					country: "USA",
					isActive: true,
				},
				{
					select: ["id", "name"],
				},
			);

			expect(result).toHaveProperty("id");
			expect(result).toHaveProperty("name");
			// createdAt, updatedAt are always included (reserved fields)
			expect(result).toHaveProperty("createdAt");
			expect(result).toHaveProperty("updatedAt");
			// Other fields should not be present
			expect(result).not.toHaveProperty("country");
			expect(result).not.toHaveProperty("isActive");
		});
	});

	// ==========================================================================
	// Edge Cases
	// ==========================================================================

	describe("Edge Cases", () => {
		it("should handle empty string for optional field", async () => {
			const result = await forja.create("category", {
				name: "Empty Desc",
				slug: "empty-desc",
				description: "",
			});

			expect(result.description).toBe("");
		});

		it("should handle null for optional field", async () => {
			const result = await forja.create("category", {
				name: "Null Desc",
				slug: "null-desc",
				description: null,
			});

			expect(result.description).toBeNull();
		});

		it("should handle zero for numeric field", async () => {
			const org = await forja.create("organization", {
				name: "Zero Budget Org",
				country: "USA",
			});

			const dept = await forja.create("department", {
				name: "Zero Budget Dept",
				code: "ZERO",
				budget: 0,
				organization: org.id,
			});

			expect(dept.budget).toBe(0);
		});

		it("should handle boolean false correctly", async () => {
			const result = await forja.create("organization", {
				name: "False Active Org",
				country: "USA",
				isActive: false,
			});

			expect(result.isActive).toBe(false);
		});

		it("should handle JSON field", async () => {
			const metadata = { key: "value", nested: { a: 1 } };

			const result = await forja.create("user", {
				email: "json@test.com",
				name: "JSON User",
				metadata,
			});

			expect(result.metadata).toEqual(metadata);
		});
	});
});
