/**
 * Nested Where Tests
 *
 * Tests for filtering by related record fields (nested WHERE)
 *
 * Covers:
 * - Filter by belongsTo relation fields
 * - Filter by manyToMany relation fields
 * - Deep nested relation filtering
 * - Combine nested and local where
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Forja } from "forja-core";
import fs from "node:fs/promises";
import { createTestConfig, getTmpDir, setupTables } from "../setup";

describe("Nested Where", () => {
	let forja: Forja;
	const tmpDir = getTmpDir("nested_where");

	// Store IDs for reference
	let orgs: { acme: number; tech: number };
	let depts: { eng: number; sales: number; hr: number };
	let users: { alice: number; bob: number; charlie: number };

	beforeAll(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
		await fs.mkdir(tmpDir, { recursive: true });

		const getForja = await createTestConfig(tmpDir);
		forja = await getForja();

		await setupTables(forja);

		// Create organizations
		const acme = await forja.create("organization", {
			name: "Acme Corp",
			country: "USA",
			isActive: true,
		});
		const tech = await forja.create("organization", {
			name: "Tech Ltd",
			country: "UK",
			isActive: false,
		});
		orgs = { acme: acme.id, tech: tech.id };

		// Create departments
		const eng = await forja.create("department", {
			name: "Engineering",
			code: "ENG",
			budget: 100000,
			organization: acme.id,
		});
		const sales = await forja.create("department", {
			name: "Sales",
			code: "SLS",
			budget: 50000,
			organization: acme.id,
		});
		const hr = await forja.create("department", {
			name: "HR",
			code: "HR",
			budget: 30000,
			organization: tech.id,
		});
		depts = { eng: eng.id, sales: sales.id, hr: hr.id };

		// Create roles
		const adminRole = await forja.create("role", {
			name: "Admin",
			level: 100,
		});
		const devRole = await forja.create("role", {
			name: "Developer",
			level: 50,
		});

		// Create users
		const alice = await forja.create("user", {
			email: "alice@acme.com",
			name: "Alice",
			age: 30,
			isActive: true,
			organization: acme.id,
			department: eng.id,
			roles: { connect: [adminRole.id, devRole.id] },
		});
		const bob = await forja.create("user", {
			email: "bob@acme.com",
			name: "Bob",
			age: 25,
			isActive: true,
			organization: acme.id,
			department: sales.id,
			roles: { connect: [devRole.id] },
		});
		const charlie = await forja.create("user", {
			email: "charlie@tech.com",
			name: "Charlie",
			age: 35,
			isActive: false,
			organization: tech.id,
			department: hr.id,
		});
		users = { alice: alice.id, bob: bob.id, charlie: charlie.id };

		// Create categories and posts
		const techCat = await forja.create("category", {
			name: "Technology",
			slug: "technology",
			isActive: true,
		});
		const sciCat = await forja.create("category", {
			name: "Science",
			slug: "science",
			isActive: false,
		});

		const tag1 = await forja.create("tag", {
			name: "JavaScript",
			color: "#F7DF1E",
		});
		const tag2 = await forja.create("tag", {
			name: "Python",
			color: "#3776AB",
		});

		await forja.create("post", {
			title: "JavaScript Tips",
			content: "JS content",
			slug: "js-tips",
			isPublished: true,
			author: alice.id,
			category: techCat.id,
			tags: { connect: [tag1.id] },
		});

		await forja.create("post", {
			title: "Python Basics",
			content: "Python content",
			slug: "python-basics",
			isPublished: false,
			author: bob.id,
			category: sciCat.id,
			tags: { connect: [tag2.id] },
		});
	});

	afterAll(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	// ==========================================================================
	// BelongsTo Nested Where
	// ==========================================================================

	describe("BelongsTo Relation Where", () => {
		it("should filter by direct belongsTo field", async () => {
			const results = await forja.findMany("user", {
				where: {
					organization: { name: "Acme Corp" },
				},
			});

			expect(results).toHaveLength(2); // Alice and Bob
			for (const user of results) {
				expect(["Alice", "Bob"]).toContain(user.name);
			}
		});

		it("should filter by belongsTo with operator", async () => {
			const results = await forja.findMany("department", {
				where: {
					organization: { isActive: true },
				},
			});

			expect(results).toHaveLength(2); // Engineering and Sales (from Acme)
			for (const dept of results) {
				expect(["Engineering", "Sales"]).toContain(dept.name);
			}
		});

		it("should filter by belongsTo country", async () => {
			const results = await forja.findMany("user", {
				where: {
					organization: { country: "UK" },
				},
			});

			expect(results).toHaveLength(1);
			expect(results[0].name).toBe("Charlie");
		});

		it("should filter by department budget", async () => {
			const results = await forja.findMany("user", {
				where: {
					department: { budget: { $gte: 50000 } },
				},
			});

			expect(results).toHaveLength(2); // Alice (eng 100k) and Bob (sales 50k)
		});
	});

	// ==========================================================================
	// Deep Nested Where
	// ==========================================================================

	describe("Deep Nested Where", () => {
		it("should filter by 2-level deep relation", async () => {
			// Users where department's organization is in USA
			const results = await forja.findMany("user", {
				where: {
					department: {
						organization: { country: "USA" },
					},
				},
			});

			expect(results).toHaveLength(2); // Alice and Bob
		});

		it("should filter posts by author's organization", async () => {
			const results = await forja.findMany("post", {
				where: {
					author: {
						organization: { name: "Acme Corp" },
					},
				},
			});

			expect(results).toHaveLength(2); // Both posts by Acme users
		});

		it("should filter posts by category status", async () => {
			const results = await forja.findMany("post", {
				where: {
					category: { isActive: true },
				},
			});

			expect(results).toHaveLength(1);
			expect(results[0].title).toBe("JavaScript Tips");
		});
	});

	// ==========================================================================
	// Combined Local and Nested Where
	// ==========================================================================

	describe("Combined Local and Nested Where", () => {
		it("should combine local field with nested relation", async () => {
			const results = await forja.findMany("user", {
				where: {
					isActive: true,
					organization: { country: "USA" },
				},
			});

			expect(results).toHaveLength(2); // Alice and Bob (active + USA)
			for (const user of results) {
				expect(user.isActive).toBe(true);
			}
		});

		it("should combine multiple nested relations", async () => {
			const results = await forja.findMany("user", {
				where: {
					organization: { isActive: true },
					department: { budget: { $gt: 75000 } },
				},
			});

			expect(results).toHaveLength(1);
			expect(results[0].name).toBe("Alice"); // Only eng dept has budget > 75k
		});

		it("should combine age filter with org filter", async () => {
			const results = await forja.findMany("user", {
				where: {
					age: { $gte: 30 },
					organization: { name: "Acme Corp" },
				},
			});

			expect(results).toHaveLength(1);
			expect(results[0].name).toBe("Alice");
		});
	});

	// ==========================================================================
	// Nested Where with Logical Operators
	// ==========================================================================

	describe("Nested Where with Logical Operators", () => {
		it("should use $or with nested where", async () => {
			const results = await forja.findMany("user", {
				where: {
					$or: [
						{ organization: { country: "UK" } },
						{ department: { code: "ENG" } },
					],
				},
			});

			// Charlie (UK) + Alice (ENG)
			expect(results).toHaveLength(2);
			const names = results.map((u) => u.name);
			expect(names).toContain("Alice");
			expect(names).toContain("Charlie");
		});

		it("should use $and with nested where", async () => {
			const results = await forja.findMany("user", {
				where: {
					$and: [{ organization: { isActive: true } }, { isActive: true }],
				},
			});

			// Alice and Bob (both active user + active org)
			expect(results).toHaveLength(2);
		});
	});

	// ==========================================================================
	// Self-Referencing Nested Where
	// ==========================================================================

	describe("Self-Referencing Nested Where", () => {
		beforeAll(async () => {
			// Create hierarchical categories
			const parent = await forja.create("category", {
				name: "Parent Category",
				slug: "parent-category",
				isActive: true,
			});

			await forja.create("category", {
				name: "Child Category",
				slug: "child-category",
				isActive: true,
				parent: parent.id,
			});

			await forja.create("category", {
				name: "Another Child",
				slug: "another-child",
				isActive: false,
				parent: parent.id,
			});
		});

		it("should filter by parent category", async () => {
			const results = await forja.findMany("category", {
				where: {
					parent: { name: "Parent Category" },
				},
			});

			expect(results).toHaveLength(2);
			for (const cat of results) {
				expect(["Child Category", "Another Child"]).toContain(cat.name);
			}
		});

		it("should combine self-reference with local field", async () => {
			const results = await forja.findMany("category", {
				where: {
					isActive: true,
					parent: { name: "Parent Category" },
				},
			});

			expect(results).toHaveLength(1);
			expect(results[0].name).toBe("Child Category");
		});
	});

	// ==========================================================================
	// Error Cases
	// ==========================================================================

	describe("Error Cases", () => {
		it("should throw for invalid nested field", async () => {
			await expect(
				forja.findMany("user", {
					where: {
						organization: { nonExistentField: "value" },
					},
				}),
			).rejects.toThrow();
		});

		it("should throw for non-relation field used as nested", async () => {
			await expect(
				forja.findMany("user", {
					where: {
						name: { someField: "value" },
					} as Record<string, unknown>,
				}),
			).rejects.toThrow();
		});
	});
});
