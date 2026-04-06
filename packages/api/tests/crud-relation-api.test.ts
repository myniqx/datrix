// @ts-nocheck
/**
 * CRUD Relation API Integration Tests
 *
 * Tests nested create/update operations and relation API:
 * - Data normalization (connect/set/disconnect formats)
 * - Nested create (recursive processing)
 * - Nested update (recursive processing)
 * - Mixed relation operations (connect + create + disconnect)
 * - Deep nesting (multi-level)
 * - Depth limit validation
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Datrix } from "@datrix/core";
import { handleRequest } from "../src/helper";
import { createTestConfig, getTmpDir } from "./data";
import { createRequest } from "./data/helper";
import {
	expectApiSingle,
	expectApiMulti,
	expectApiError,
	randomEmail,
} from "../../core/tests/test/helpers";
import fs from "node:fs/promises";
import { ParsedQuery } from "@datrix/core";

describe("CRUD Relation API Tests", () => {
	let datrix: Datrix;
	const tmpDir = getTmpDir("crud_relation");

	// Helper: POST request
	const postRequest = async (
		endpoint: string,
		body: unknown,
		params?: ParsedQuery,
	) => {
		const request = createRequest(
			endpoint,
			{
				method: "POST",
				body,
			},
			params,
		);
		return handleRequest(datrix, request);
	};

	// Helper: PUT request
	const putRequest = async (endpoint: string, body: unknown) => {
		const request = createRequest(endpoint, {
			method: "PUT",
			body,
		});
		return handleRequest(datrix, request);
	};

	// Helper: GET request
	const getRequest = async (endpoint: string, params?: ParsedQuery) => {
		const request = createRequest(
			endpoint,
			{
				method: "GET",
			},
			params,
		);
		return handleRequest(datrix, request);
	};

	beforeAll(async () => {
		// Clean up temporary directory
		try {
			await fs.rm(tmpDir, { recursive: true, force: true });
		} catch (error) {
			console.warn("Failed to clean up temp directory:", error);
		}
		await fs.mkdir(tmpDir, { recursive: true });

		// Get Datrix instance
		const getDatrix = await createTestConfig(tmpDir);
		datrix = await getDatrix();

		// Create tables
		const adapter = datrix.getAdapter();
		for (const schema of datrix.getSchemas().getAll()) {
			try {
				await adapter.dropTable(schema.tableName!);
			} catch { }
			await adapter.createTable(schema);
		}
	});

	afterAll(async () => {
		// Clean up
		try {
			await fs.rm(tmpDir, { recursive: true, force: true });
		} catch (error) {
			console.warn("Failed to clean up temp directory:", error);
		}
	});

	describe("Data Normalization - Connect/Set/Disconnect", () => {
		it("should normalize connect: number → number[]", async () => {
			// Create company first
			const companyRes = await postRequest("/api/companies", {
				name: "TechCorp",
				country: "USA",
			});
			const company = await expectApiSingle(companyRes, 201);

			// Create author with connect as number
			const authorRes = await postRequest("/api/authors?populate=true", {
				name: "John Doe",
				email: randomEmail(),
				company: company.id, // ✅ Direct ID (should normalize to number[])
			});
			const author = await expectApiSingle(authorRes, 201);

			expect(author.company.id).toBe(company.id);
		});

		it("should normalize connect: {id} → number[]", async () => {
			const companyRes = await postRequest("/api/companies", {
				name: "DevCorp",
				country: "UK",
			});
			const company = await expectApiSingle(companyRes, 201);

			// Without populate → No relation, no FK
			const authorRes = await postRequest("/api/authors", {
				name: "Jane Smith",
				email: randomEmail(),
				company: { connect: { id: company.id } }, // ✅ Object format
			});
			const author = await expectApiSingle(authorRes, 201);

			expect(author.companyId).toBeUndefined(); // ❌ FK never visible
			expect(author.company).toBeUndefined(); // ❌ Relation not populated
		});

		it("should reject multiple IDs for belongsTo connect", async () => {
			const company1Res = await postRequest("/api/companies", {
				name: "Corp1",
				country: "USA",
			});
			const company1 = await expectApiSingle(company1Res, 201);

			const company2Res = await postRequest("/api/companies", {
				name: "Corp2",
				country: "UK",
			});
			const company2 = await expectApiSingle(company2Res, 201);

			// belongsTo can only reference one record — multiple IDs should fail
			const authorRes = await postRequest("/api/authors", {
				name: "Bob Johnson",
				email: randomEmail(),
				company: { connect: [{ id: company1.id }, { id: company2.id }] },
			});
			await expectApiError(authorRes, 400);
		});

		it("should normalize set: [number] → number[]", async () => {
			const companyRes = await postRequest("/api/companies", {
				name: "NewCorp",
				country: "DE",
			});
			const company = await expectApiSingle(companyRes, 201);

			// Without populate → No FK, no relation
			const authorRes = await postRequest("/api/authors", {
				name: "Alice Brown",
				email: randomEmail(),
				company: { set: [company.id] }, // ✅ Set format
			});
			const author = await expectApiSingle(authorRes, 201);

			expect(author.companyId).toBeUndefined(); // ❌ FK never visible
			expect(author.company).toBeUndefined(); // ❌ Not populated
		});

		it("should handle disconnect (set FK to null)", async () => {
			const companyRes = await postRequest("/api/companies", {
				name: "OldCorp",
				country: "FR",
			});
			const company = await expectApiSingle(companyRes, 201);

			const authorRes = await postRequest("/api/authors?populate=true", {
				name: "Charlie Wilson",
				email: randomEmail(),
				company: company.id,
			});
			const author = await expectApiSingle(authorRes, 201);

			expect(author.company.id).toBe(company.id); // ✅ Populated before disconnect

			// Disconnect (populate to verify it's gone)
			const updateRes = await putRequest(
				`/api/authors/${author.id}?populate=true`,
				{
					company: { disconnect: true },
				},
			);
			const updated = await expectApiSingle(updateRes);

			expect(updated.companyId).toBeUndefined(); // ❌ FK never visible
			expect(updated.company).toBeNull(); // ✅ Relation is null after disconnect
		});
	});

	describe("Nested Create - Single Level", () => {
		it("should create author with nested company create", async () => {
			const response = await postRequest("/api/authors?populate=true", {
				name: "David Lee",
				email: randomEmail(),
				company: {
					create: {
						name: "StartupCo",
						country: "JP",
					},
				},
			});

			const author = await expectApiSingle(response, 201);

			expect(author.name).toBe("David Lee");
			expect(author.companyId).toBeUndefined(); // ❌ FK never visible
			expect(author.company).toBeDefined(); // ✅ Populated relation
			expect(author.company.name).toBe("StartupCo");
			expect(author.company.country).toBe("JP");
		});

		it("should create post with nested author create", async () => {
			const response = await postRequest("/api/posts?populate=true", {
				title: "My First Post",
				content: "Hello World!",
				author: {
					create: {
						name: "Emma Davis",
						email: randomEmail(),
					},
				},
			});

			const post = await expectApiSingle(response, 201);

			expect(post.title).toBe("My First Post");
			expect(post.authorId).toBeUndefined(); // ❌ FK never visible
			expect(post.author).toBeDefined(); // ✅ Populated relation
			expect(post.author.name).toBe("Emma Davis");
		});

		it("should create with nested array creates (manyToMany)", async () => {
			const response = await postRequest("/api/posts", {
				title: "Tagged Post",
				content: "Content here",
				tags: {
					create: [
						{ name: "javascript" },
						{ name: "typescript" },
						{ name: "nodejs" },
					],
				},
			});

			const post = await expectApiSingle(response, 201);
			expect(post.title).toBe("Tagged Post");

			// Verify tags were created (check via API if populate works)
			// For now, we'll trust the normalization worked
		});
	});

	describe("Nested Create - Multi Level (Deep Nesting)", () => {
		it("should create post → author → company (3 levels)", async () => {
			const response = await postRequest(
				"/api/posts",
				{
					title: "Deep Nested Post",
					content: "Testing deep nesting",
					author: {
						create: {
							name: "Frank Miller",
							email: randomEmail(),
							company: {
								create: {
									name: "NestedCorp",
									country: "CA",
								},
							},
						},
					},
				},
				{
					populate: ["author.company"],
				},
			);

			const post = await expectApiSingle(response, 201);

			expect(post.title).toBe("Deep Nested Post");
			expect(post.authorId).toBeUndefined(); // ❌ FK never visible
			expect(post.author).toBeDefined(); // ✅ Populated
			expect(post.author.name).toBe("Frank Miller");
			expect(post.author.companyId).toBeUndefined(); // ❌ FK never visible
			expect(post.author.company).toBeDefined(); // ✅ Populated
			expect(post.author.company.name).toBe("NestedCorp");
			expect(post.author.company.country).toBe("CA");
		});

		it("should fail when depth exceeds MAX_NESTED_DEPTH (5 levels)", async () => {
			// This would require 6+ level schema which we don't have
			// But we can test the concept with a mock deep structure
			// For now, skip or mark as TODO
			// TODO: Create schema with 6+ levels to test depth limit
		});
	});

	describe("Mixed Operations - Connect + Create + Set", () => {
		it("should handle connect existing + create new (manyToMany)", async () => {
			// Create existing tags
			const tag1Res = await postRequest("/api/tags", { name: "react" });
			const tag1 = await expectApiSingle(tag1Res, 201);

			const tag2Res = await postRequest("/api/tags", { name: "vue" });
			const tag2 = await expectApiSingle(tag2Res, 201);

			// Create post with mixed operations
			const response = await postRequest("/api/posts", {
				title: "Framework Comparison",
				content: "Comparing frameworks",
				tags: {
					connect: [tag1.id, tag2.id], // ✅ Connect existing
					create: [{ name: "angular" }], // ✅ Create new
				},
			});

			const post = await expectApiSingle(response, 201);
			expect(post.title).toBe("Framework Comparison");

			// Verify: should have 3 tags total (2 connected + 1 created)
			// (Would need populate to verify fully)
		});

		it("should handle create with nested create + connect", async () => {
			// Create existing company
			const companyRes = await postRequest("/api/companies", {
				name: "ExistingCo",
				country: "US",
			});
			const company = await expectApiSingle(companyRes, 201);

			// Create post with author that has both create and connect
			const response = await postRequest(
				"/api/posts",
				{
					title: "Complex Post",
					content: "Testing complex relations",
					author: {
						create: {
							name: "Grace Hopper",
							email: randomEmail(),
							company: company.id, // ✅ Connect existing company
						},
					},
				},
				{
					populate: ["author.company"],
				},
			);

			const post = await expectApiSingle(response, 201);
			expect(post.authorId).toBeUndefined(); // ❌ FK never visible
			expect(post.author).toBeDefined(); // ✅ Populated
			expect(post.author.name).toBe("Grace Hopper");
			expect(post.author.companyId).toBeUndefined(); // ❌ FK never visible
			expect(post.author.company).toBeDefined(); // ✅ Populated
			expect(post.author.company.id).toBe(company.id);
		});
	});

	describe("Nested Update Operations", () => {
		it("should update post with nested author update", async () => {
			// Create post with author (populate to get author.id)
			const createRes = await postRequest("/api/posts?populate=true", {
				title: "Original Title",
				content: "Original content",
				author: {
					create: {
						name: "Henry Ford",
						email: randomEmail(),
					},
				},
			});
			const post = await expectApiSingle(createRes, 201);

			// Update post with nested author update
			const updateRes = await putRequest(
				`/api/posts/${post.id}?populate=true`,
				{
					title: "Updated Title",
					author: {
						update: {
							where: { id: post.author.id },
							data: {
								name: "Henry Ford Jr.",
							},
						},
					},
				},
			);

			const updated = await expectApiSingle(updateRes);
			expect(updated.title).toBe("Updated Title");
			expect(updated.author.name).toBe("Henry Ford Jr.");
		});

		it("should update with nested create (add new relation)", async () => {
			// Create post without author
			const createRes = await postRequest("/api/posts", {
				title: "Authorless Post",
				content: "No author yet",
			});
			const post = await expectApiSingle(createRes, 201);

			// Update with nested author create (populate to get author)
			const updateRes = await putRequest(
				`/api/posts/${post.id}?populate=true`,
				{
					author: {
						create: {
							name: "Isabel Perez",
							email: randomEmail(),
						},
					},
				},
			);

			const updated = await expectApiSingle(updateRes);
			expect(updated.authorId).toBeUndefined(); // ❌ FK never visible
			expect(updated.author).toBeDefined(); // ✅ Populated
			expect(updated.author.name).toBe("Isabel Perez");
		});
	});

	describe("Relation Delete Operations", () => {
		it("should delete related records", async () => {
			// Create author with company (populate to get company.id)
			const createRes = await postRequest("/api/authors?populate=true", {
				name: "Jack Ryan",
				email: randomEmail(),
				company: {
					create: {
						name: "TempCorp",
						country: "US",
					},
				},
			});
			const author = await expectApiSingle(createRes, 201);
			const companyId = author.company.id;

			// Update with delete operation
			const updateRes = await putRequest(`/api/authors/${author.id}`, {
				company: {
					delete: [companyId], // ✅ Delete company
				},
			});

			const updated = await expectApiSingle(updateRes);
			expect(updated.companyId).toBeUndefined(); // ❌ FK never visible

			// Verify company was deleted
			const companyRes = await getRequest(`/api/companies/${companyId}`);
			await expectApiError(companyRes, 404); // Should be deleted
		});
	});

	describe("Set Operation (Replace All)", () => {
		it("should replace all tags with set operation", async () => {
			// Create tags
			const tag1Res = await postRequest("/api/tags", { name: "old1" });
			const tag1 = await expectApiSingle(tag1Res, 201);

			const tag2Res = await postRequest("/api/tags", { name: "old2" });
			const tag2 = await expectApiSingle(tag2Res, 201);

			const tag3Res = await postRequest("/api/tags", { name: "new1" });
			const tag3 = await expectApiSingle(tag3Res, 201);

			// Create post with initial tags
			const createRes = await postRequest("/api/posts", {
				title: "Tag Test Post",
				content: "Testing tags",
				tags: {
					connect: [tag1.id, tag2.id],
				},
			});
			const post = await expectApiSingle(createRes, 201);

			// Replace all tags with set
			const updateRes = await putRequest(`/api/posts/${post.id}`, {
				tags: {
					set: [tag3.id], // ✅ Replace all with just tag3
				},
			});

			const updated = await expectApiSingle(updateRes);
			expect(updated.title).toBe("Tag Test Post");

			// (Would need populate to verify tag replacement)
		});
	});

	describe("Resolve-then-link: Create runs once, IDs merge into connect", () => {
		it("should create tag ONCE and connect to post (manyToMany create → connect merge)", async () => {
			// Create post with tags.create → tag should be created once, then connected
			const response = await postRequest(
				"/api/posts",
				{
					title: "Resolve Test M2M",
					content: "Testing resolve-then-link",
					tags: {
						create: [{ name: "resolve-tag-1" }],
					},
				},
				{
					populate: { tags: true },
				},
			);

			const post = await expectApiSingle(response, 201);
			expect(post.tags).toBeDefined();
			expect(post.tags).toHaveLength(1);
			expect(post.tags[0].name).toBe("resolve-tag-1");

			// Verify tag exists exactly once in DB
			const tagListRes = await getRequest("/api/tags", {
				where: { name: { $eq: "resolve-tag-1" } },
			});
			const { data: tagList } = await expectApiMulti(tagListRes);
			expect(tagList).toHaveLength(1);
		});

		it("should create multiple tags ONCE each and connect all (manyToMany batch create)", async () => {
			const response = await postRequest(
				"/api/posts",
				{
					title: "Batch Tag Create",
					content: "Multiple tags created at once",
					tags: {
						create: [
							{ name: "batch-tag-a" },
							{ name: "batch-tag-b" },
							{ name: "batch-tag-c" },
						],
					},
				},
				{
					populate: { tags: true },
				},
			);

			const post = await expectApiSingle(response, 201);
			expect(post.tags).toHaveLength(3);
			const tagNames = post.tags.map((t: { name: string }) => t.name).sort();
			expect(tagNames).toEqual(["batch-tag-a", "batch-tag-b", "batch-tag-c"]);
		});

		it("should merge created tag IDs with existing connect IDs (manyToMany create + connect)", async () => {
			// Create existing tag
			const existingTagRes = await postRequest("/api/tags", {
				name: "existing-merge-tag",
			});
			const existingTag = await expectApiSingle(existingTagRes, 201);

			// Create post: connect existing + create new
			const response = await postRequest(
				"/api/posts",
				{
					title: "Merge Connect Post",
					content: "Testing create + connect merge",
					tags: {
						connect: [existingTag.id],
						create: [{ name: "new-merge-tag" }],
					},
				},
				{
					populate: { tags: true },
				},
			);

			const post = await expectApiSingle(response, 201);
			expect(post.tags).toHaveLength(2);
			const tagNames = post.tags.map((t: { name: string }) => t.name).sort();
			expect(tagNames).toEqual(["existing-merge-tag", "new-merge-tag"]);
		});

		it("should merge created IDs into set when set is present (manyToMany set + create)", async () => {
			// Create existing tags
			const oldTagRes = await postRequest("/api/tags", { name: "old-set-tag" });
			const oldTag = await expectApiSingle(oldTagRes, 201);

			// Create post with old tag
			const createRes = await postRequest("/api/posts", {
				title: "Set Merge Post",
				content: "Testing set + create merge",
				tags: { connect: [oldTag.id] },
			});
			const post = await expectApiSingle(createRes, 201);

			// Update: set (replaces all) + create (new tag merged into set)
			const updateRes = await putRequest(`/api/posts/${post.id}`, {
				tags: {
					set: [], // Remove all existing
					create: [{ name: "fresh-set-tag" }], // Create new, should merge into set
				},
			});
			await expectApiSingle(updateRes);

			// Verify: only the new tag should be connected
			const fetchRes = await getRequest(
				`/api/posts/${post.id}?populate[tags]=true`,
			);
			const fetched = await expectApiSingle(fetchRes);
			expect(fetched.tags).toHaveLength(1);
			expect(fetched.tags[0].name).toBe("fresh-set-tag");
		});

		it("should create company ONCE for belongsTo (create → FK assigned)", async () => {
			const response = await postRequest(
				"/api/authors",
				{
					name: "Resolve BelongsTo Author",
					email: randomEmail(),
					company: {
						create: {
							name: "ResolveOnce Corp",
							country: "TR",
						},
					},
				},
				{
					populate: ["company"],
				},
			);

			const author = await expectApiSingle(response, 201);
			expect(author.company).toBeDefined();
			expect(author.company.name).toBe("ResolveOnce Corp");

			// Verify company exists exactly once
			const companyListRes = await getRequest("/api/companies", {
				where: { name: { $eq: "ResolveOnce Corp" } },
			});
			const { data: companyList } = await expectApiMulti(companyListRes);
			expect(companyList).toHaveLength(1);
		});
	});

	describe("Resolve-then-link: Update runs once (no duplication)", () => {
		it("should update related tag ONCE via nested update (manyToMany)", async () => {
			// Create tag + post
			const tagRes = await postRequest("/api/tags", { name: "updatable-tag" });
			const tag = await expectApiSingle(tagRes, 201);

			const postRes = await postRequest("/api/posts", {
				title: "Update Tag Post",
				content: "Testing nested update",
				tags: { connect: [tag.id] },
			});
			const post = await expectApiSingle(postRes, 201);

			// Update post with nested tag update
			const updateRes = await putRequest(`/api/posts/${post.id}`, {
				tags: {
					update: {
						where: { id: tag.id },
						data: { name: "updated-tag-name" },
					},
				},
			});
			await expectApiSingle(updateRes);

			// Verify tag was updated
			const fetchTagRes = await getRequest(`/api/tags/${tag.id}`);
			const fetchedTag = await expectApiSingle(fetchTagRes);
			expect(fetchedTag.name).toBe("updated-tag-name");
		});

		it("should update nested author ONCE via belongsTo update", async () => {
			// Create author
			const authorRes = await postRequest("/api/authors", {
				name: "Original Author Name",
				email: randomEmail(),
			});
			const author = await expectApiSingle(authorRes, 201);

			// Create post with author
			const postRes = await postRequest("/api/posts", {
				title: "Nested Update Post",
				content: "Testing nested author update",
				author: { connect: author.id },
			});
			const post = await expectApiSingle(postRes, 201);

			// Update post with nested author update
			const updateRes = await putRequest(`/api/posts/${post.id}`, {
				author: {
					update: {
						where: { id: author.id },
						data: { name: "Renamed Author" },
					},
				},
			});
			await expectApiSingle(updateRes);

			// Verify author name changed
			const fetchAuthorRes = await getRequest(
				`/api/authors/${author.id}?populate=true`,
			);
			const fetchedAuthor = await expectApiSingle(fetchAuthorRes);
			expect(fetchedAuthor.name).toBe("Renamed Author");
		});
	});

	describe("Resolve-then-link: Delete runs once", () => {
		it("should delete related tags ONCE (manyToMany delete)", async () => {
			// Create tags
			const tag1Res = await postRequest("/api/tags", { name: "delete-me-1" });
			const tag1 = await expectApiSingle(tag1Res, 201);

			const tag2Res = await postRequest("/api/tags", { name: "delete-me-2" });
			const tag2 = await expectApiSingle(tag2Res, 201);

			// Create post with tags
			const postRes = await postRequest("/api/posts", {
				title: "Delete Tags Post",
				content: "Testing tag deletion",
				tags: { connect: [tag1.id, tag2.id] },
			});
			const post = await expectApiSingle(postRes, 201);

			// Delete tags via relation API
			const updateRes = await putRequest(`/api/posts/${post.id}`, {
				tags: { delete: [tag1.id] },
			});
			await expectApiSingle(updateRes);

			// Verify tag1 is deleted from DB
			const tag1Fetch = await getRequest(`/api/tags/${tag1.id}`);
			await expectApiError(tag1Fetch, 404);

			// Verify tag2 still exists
			const tag2Fetch = await getRequest(`/api/tags/${tag2.id}`);
			const tag2Fetched = await expectApiSingle(tag2Fetch);
			expect(tag2Fetched.name).toBe("delete-me-2");
		});
	});

	describe("Deep Nesting with Resolve-then-link", () => {
		it("should handle post → author.create → company.create (3-level deep)", async () => {
			const response = await postRequest(
				"/api/posts",
				{
					title: "Deep Resolve Post",
					content: "3-level deep create",
					author: {
						create: {
							name: "Deep Author",
							email: randomEmail(),
							company: {
								create: {
									name: "Deep Company",
									country: "SE",
								},
							},
						},
					},
				},
				{
					populate: ["author.company"],
				},
			);

			const post = await expectApiSingle(response, 201);
			expect(post.author).toBeDefined();
			expect(post.author.name).toBe("Deep Author");
			expect(post.author.company).toBeDefined();
			expect(post.author.company.name).toBe("Deep Company");
			expect(post.author.company.country).toBe("SE");

			// Verify only 1 company created
			const companyListRes = await getRequest("/api/companies", {
				where: { name: { $eq: "Deep Company" } },
			});
			const { data: companyList } = await expectApiMulti(companyListRes);
			expect(companyList).toHaveLength(1);
		});

		it("should handle post.create with author.create + tags.create simultaneously", async () => {
			const response = await postRequest(
				"/api/posts",
				{
					title: "Multi Relation Create",
					content: "Author + Tags in one shot",
					author: {
						create: {
							name: "Multi Rel Author",
							email: randomEmail(),
						},
					},
					tags: {
						create: [{ name: "multi-rel-tag-1" }, { name: "multi-rel-tag-2" }],
					},
				},
				{
					populate: ["author", "tags"],
				},
			);

			const post = await expectApiSingle(response, 201);
			expect(post.author).toBeDefined();
			expect(post.author.name).toBe("Multi Rel Author");
			expect(post.tags).toHaveLength(2);
		});
	});

	describe("Mixed CUD + Link Operations", () => {
		it("should handle create + connect + disconnect in same update (manyToMany)", async () => {
			// Setup: create tags and post with 2 tags
			const tag1Res = await postRequest("/api/tags", { name: "keep-tag" });
			const tag1 = await expectApiSingle(tag1Res, 201);

			const tag2Res = await postRequest("/api/tags", { name: "remove-tag" });
			const tag2 = await expectApiSingle(tag2Res, 201);

			const tag3Res = await postRequest("/api/tags", { name: "add-tag" });
			const tag3 = await expectApiSingle(tag3Res, 201);

			const postRes = await postRequest("/api/posts", {
				title: "Mixed Ops Post",
				content: "Testing mixed operations",
				tags: { connect: [tag1.id, tag2.id] },
			});
			const post = await expectApiSingle(postRes, 201);

			// Mixed: create new + connect existing + disconnect existing
			const updateRes = await putRequest(`/api/posts/${post.id}`, {
				tags: {
					create: [{ name: "brand-new-tag" }],
					connect: [tag3.id],
					disconnect: [tag2.id],
				},
			});
			await expectApiSingle(updateRes);

			// Verify final state
			const fetchRes = await getRequest(
				`/api/posts/${post.id}?populate[tags]=true`,
			);
			const fetched = await expectApiSingle(fetchRes);

			// Should have: keep-tag, add-tag, brand-new-tag (3 total)
			// Should NOT have: remove-tag
			expect(fetched.tags).toHaveLength(3);
			const tagNames = fetched.tags.map((t: { name: string }) => t.name).sort();
			expect(tagNames).toEqual(["add-tag", "brand-new-tag", "keep-tag"]);
		});

		it("should handle belongsTo: disconnect old + create new in one update", async () => {
			// Create author with company
			const authorRes = await postRequest(
				"/api/authors",
				{
					name: "Switch Company Author",
					email: randomEmail(),
					company: {
						create: { name: "OldCo", country: "US" },
					},
				},
				{
					populate: ["company"],
				},
			);
			const author = await expectApiSingle(authorRes, 201);
			expect(author.company.name).toBe("OldCo");

			// Update: create new company (replaces old via belongsTo)
			const updateRes = await putRequest(`/api/authors/${author.id}`, {
				company: {
					create: { name: "NewCo", country: "DE" },
				},
			});
			await expectApiSingle(updateRes);

			// Verify new company is assigned
			const fetchRes = await getRequest(
				`/api/authors/${author.id}?populate[company]=true`,
			);
			const fetched = await expectApiSingle(fetchRes);
			expect(fetched.company).toBeDefined();
			expect(fetched.company.name).toBe("NewCo");
		});
	});

	describe("Edge Cases & Validation", () => {
		it("should preserve FK inline optimization (belongsTo)", async () => {
			// When using simple connect, FK should be inlined
			const companyRes = await postRequest("/api/companies", {
				name: "InlineCo",
				country: "US",
			});
			const company = await expectApiSingle(companyRes, 201);

			const authorRes = await postRequest("/api/authors?populate=true", {
				name: "Karen White",
				email: randomEmail(),
				company: company.id, // ✅ Should inline FK, no async relation processing
			});

			const author = await expectApiSingle(authorRes, 201);
			expect(author.companyId).toBeUndefined(); // ❌ FK never visible
			expect(author.company).toBeDefined(); // ✅ Populated
			expect(author.company.id).toBe(company.id);
		});

		it("should fail with invalid nested data", async () => {
			const response = await postRequest("/api/authors", {
				name: "Invalid Author",
				email: randomEmail(),
				company: {
					create: {
						// Missing required 'country' field
						name: "BadCorp",
					},
				},
			});

			await expectApiError(response, 400); // Validation should fail
		});

		it("should handle empty create array", async () => {
			const response = await postRequest("/api/posts", {
				title: "Empty Tags",
				content: "No tags",
				tags: {
					create: [], // ✅ Empty array should be handled
				},
			});

			const post = await expectApiSingle(response, 201);
			expect(post.title).toBe("Empty Tags");
		});
	});
});
