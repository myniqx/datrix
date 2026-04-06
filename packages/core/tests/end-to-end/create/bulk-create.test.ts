/**
 * Bulk Create Tests
 *
 * Tests for forja.createMany() - multiple record creation
 *
 * Covers:
 * - Basic bulk insert
 * - Return all created records
 * - Individual record validation
 * - Transaction behavior (all fail if one fails)
 * - Large batch inserts (performance)
 * - Relations in bulk create
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Forja } from "@forja/core";
import fs from "node:fs/promises";
import {
	createTestConfig,
	getTmpDir,
	setupTables,
	generateUsers,
	generateCategories,
	generateTags,
	expectAutoFields,
	measureTime,
} from "../setup";
import { expectForjaErrorAsync } from "@forja/core/types/test/helpers";

describe("Bulk Create", () => {
	let forja: Forja;
	const tmpDir = getTmpDir("bulk_create");

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
	// Basic Bulk Create
	// ==========================================================================

	describe("Basic Bulk Create", () => {
		it("should create multiple records at once", async () => {
			const data = [
				{ name: "Org 1", country: "USA" },
				{ name: "Org 2", country: "UK" },
				{ name: "Org 3", country: "Germany" },
			];

			const results = await forja.createMany("organization", data);

			expect(results).toHaveLength(3);
			expect(results[0].name).toBe("Org 1");
			expect(results[1].name).toBe("Org 2");
			expect(results[2].name).toBe("Org 3");
		});

		it("should return all created records with auto-generated fields", async () => {
			const data = [
				{ name: "Auto Org 1", country: "France" },
				{ name: "Auto Org 2", country: "Spain" },
			];

			const results = await forja.createMany("organization", data);

			for (const record of results) {
				expectAutoFields(record);
			}

			// IDs should be sequential or unique
			expect(results[0].id).not.toBe(results[1].id);
		});

		it("should apply default values to each record", async () => {
			const data = [
				{ name: "Default Org 1", country: "Italy" },
				{ name: "Default Org 2", country: "Portugal", isActive: false },
			];

			const results = await forja.createMany("organization", data);

			expect(results[0].isActive).toBe(true); // default
			expect(results[1].isActive).toBe(false); // overridden
		});

		it("should throw error for empty array", async () => {
			await expectForjaErrorAsync(
				async () => forja.createMany("organization", []),
				"MISSING_DATA",
			);
		});

		it("should handle single item array", async () => {
			const results = await forja.createMany("organization", [
				{ name: "Single Org", country: "Netherlands" },
			]);

			expect(results).toHaveLength(1);
			expect(results[0].name).toBe("Single Org");
		});
	});

	// ==========================================================================
	// Validation in Bulk Create
	// ==========================================================================

	describe("Validation Errors", () => {
		it("should fail entire batch if one record is invalid (missing required)", async () => {
			const data = [
				{ name: "Valid Org 1", country: "USA" },
				{ country: "UK" }, // missing name (required)
				{ name: "Valid Org 3", country: "Germany" },
			];

			await expectForjaErrorAsync(async () => {
				await forja.createMany(
					"organization",
					data as Parameters<typeof forja.createMany>[1],
				);
			}, "VALIDATION_FAILED");
		});

		it("should fail entire batch if one record violates constraint", async () => {
			const data = [
				{ name: "Valid Role 1", level: 50 },
				{ name: "Invalid Role", level: 200 }, // max is 100
				{ name: "Valid Role 2", level: 30 },
			];

			await expectForjaErrorAsync(async () => {
				await forja.createMany("role", data);
			}, "VALIDATION_FAILED");
		});

		it("should fail entire batch if pattern does not match", async () => {
			// Create org first
			const org = await forja.create("organization", {
				name: "Bulk Dept Org",
				country: "USA",
			});

			const data = [
				{ name: "Dept 1", code: "DEPT", organization: org.id },
				{ name: "Dept 2", code: "invalid", organization: org.id }, // pattern requires uppercase
				{ name: "Dept 3", code: "TEST", organization: org.id },
			];

			await expectForjaErrorAsync(async () => {
				await forja.createMany("department", data);
			}, "VALIDATION_FAILED");
		});
	});

	// ==========================================================================
	// Unique Constraints in Bulk
	// ==========================================================================

	describe("Unique Constraints", () => {
		it("should fail if duplicate values within same batch", async () => {
			const data = [
				{ name: "Dup Org", country: "USA" },
				{ name: "Dup Org", country: "UK" }, // duplicate name in same batch
			];

			await expectForjaErrorAsync(async () => {
				await forja.createMany("organization", data);
			}, "ADAPTER_UNIQUE_CONSTRAINT");
		});

		it("should fail if value already exists in database", async () => {
			// Create first
			await forja.create("organization", {
				name: "Existing Org",
				country: "USA",
			});

			// Try to create batch with same name
			const data = [
				{ name: "New Org 1", country: "UK" },
				{ name: "Existing Org", country: "Germany" }, // already exists
			];

			await expectForjaErrorAsync(async () => {
				await forja.createMany("organization", data);
			}, "ADAPTER_UNIQUE_CONSTRAINT");
		});
	});

	// ==========================================================================
	// Relations in Bulk Create
	// ==========================================================================

	describe("BelongsTo Relations", () => {
		it("should create multiple records with belongsTo relation", async () => {
			const org = await forja.create("organization", {
				name: "Bulk Relation Org",
				country: "USA",
			});

			const data = [
				{ name: "Bulk Dept 1", code: "BLKA", organization: org.id },
				{ name: "Bulk Dept 2", code: "BLKB", organization: org.id },
				{ name: "Bulk Dept 3", code: "BLKC", organization: org.id },
			];

			const results = await forja.createMany("department", data, {
				populate: { organization: true },
			});

			expect(results).toHaveLength(3);
			for (const dept of results) {
				expect(dept.organization).toBeDefined();
				expect((dept.organization as { id: number }).id).toBe(org.id);
			}
		});

		it("should create records with different relation targets", async () => {
			const org1 = await forja.create("organization", {
				name: "Multi Org 1",
				country: "USA",
			});
			const org2 = await forja.create("organization", {
				name: "Multi Org 2",
				country: "UK",
			});

			const data = [
				{ name: "Dept for Org1", code: "DOA", organization: org1.id },
				{ name: "Dept for Org2", code: "DOB", organization: org2.id },
			];

			const results = await forja.createMany("department", data, {
				populate: { organization: true },
			});

			expect((results[0].organization as { id: number }).id).toBe(org1.id);
			expect((results[1].organization as { id: number }).id).toBe(org2.id);
		});

		it("should allow mixed null and non-null relations", async () => {
			const org = await forja.create("organization", {
				name: "Mixed Relation Org",
				country: "USA",
			});

			const data = [
				{ email: "with-org@test.com", name: "With Org", organization: org.id },
				{ email: "no-org@test.com", name: "No Org" }, // no organization
			];

			const results = await forja.createMany("user", data, {
				populate: { organization: true },
			});

			expect(results[0].organization).toBeDefined();
			expect((results[0].organization as { id: number }).id).toBe(org.id);
			expect(results[1].organization).toBeNull();
		});
	});

	// ==========================================================================
	// Large Batch Performance
	// ==========================================================================

	describe("Performance", () => {
		it("should insert 100 records efficiently", async () => {
			const users = generateUsers(100);

			const { result, ms } = await measureTime(async () => {
				return forja.createMany("user", users);
			});

			expect(result).toHaveLength(100);
			// Should complete in reasonable time (adjust threshold as needed)
			console.log(`100 records inserted in ${ms.toFixed(2)}ms`);
			expect(ms).toBeLessThan(10000); // 10 seconds max
		});

		it("should insert 500 categories efficiently", async () => {
			const categories = generateCategories(500);

			const { result, ms } = await measureTime(async () => {
				return forja.createMany("category", categories);
			});

			expect(result).toHaveLength(500);
			console.log(`500 records inserted in ${ms.toFixed(2)}ms`);
			expect(ms).toBeLessThan(30000); // 30 seconds max
		});

		it("should insert 200 tags efficiently", async () => {
			const tags = generateTags(200);

			const { result, ms } = await measureTime(async () => {
				return forja.createMany("tag", tags);
			});

			expect(result).toHaveLength(200);
			console.log(`200 records inserted in ${ms.toFixed(2)}ms`);
			expect(ms).toBeLessThan(15000); // 15 seconds max
		});
	});

	// ==========================================================================
	// Select Option
	// ==========================================================================

	describe("Select Option", () => {
		it("should return only selected fields for all records", async () => {
			const data = [
				{ name: "Select Org 1", country: "USA", isActive: true },
				{ name: "Select Org 2", country: "UK", isActive: false },
			];

			const results = await forja.createMany("organization", data, {
				select: ["id", "name"],
			});

			for (const record of results) {
				expect(record).toHaveProperty("id");
				expect(record).toHaveProperty("name");
				expect(record).toHaveProperty("createdAt");
				expect(record).toHaveProperty("updatedAt");
				expect(record).not.toHaveProperty("country");
				expect(record).not.toHaveProperty("isActive");
			}
		});
	});

	// ==========================================================================
	// Edge Cases
	// ==========================================================================

	describe("Edge Cases", () => {
		it("should handle records with different optional fields", async () => {
			const data = [
				{ name: "Cat 1", slug: "cat-1" },
				{ name: "Cat 2", slug: "cat-2", description: "Has description" },
				{ name: "Cat 3", slug: "cat-3", isActive: false },
			];

			const results = await forja.createMany("category", data);

			expect(results).toHaveLength(3);
			expect(results[0].description).toBeNull();
			expect(results[1].description).toBe("Has description");
			expect(results[2].isActive).toBe(false);
		});

		it("should handle JSON fields in bulk create", async () => {
			const data = [
				{ email: "json1@test.com", name: "JSON 1", metadata: { a: 1 } },
				{ email: "json2@test.com", name: "JSON 2", metadata: { b: 2 } },
				{ email: "json3@test.com", name: "JSON 3" }, // no metadata
			];

			const results = await forja.createMany("user", data);

			expect(results[0].metadata).toEqual({ a: 1 });
			expect(results[1].metadata).toEqual({ b: 2 });
			expect(results[2].metadata).toBeNull();
		});
	});
});
