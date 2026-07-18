// @ts-nocheck
/**
 * QUERY Method Tests
 *
 * Tests the QUERY HTTP method and its POST /:model/query alias:
 * JSON body queries validated by validateQueryBody, routed to the list
 * handler with the same response shape as GET.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Datrix } from "@datrix/core";
import { handleRequest } from "../src/helper";
import { createTestConfig, getTmpDir } from "./data";
import { createRequest } from "./data/helper";
import { expectApiMulti, expectApiError } from "../../core/tests/test/helpers";
import fs from "node:fs/promises";

describe("QUERY Method Tests", () => {
	let datrix: Datrix;
	const tmpDir = getTmpDir("query_method");

	beforeAll(async () => {
		try {
			await fs.rm(tmpDir, { recursive: true, force: true });
		} catch {}
		await fs.mkdir(tmpDir, { recursive: true });

		const getDatrix = await createTestConfig(tmpDir);
		datrix = await getDatrix();

		const adapter = datrix.getAdapter();
		for (const schema of datrix.getSchemas().getAll()) {
			try {
				await adapter.dropTable(schema.tableName!);
			} catch {}
			await adapter.createTable(schema);
		}

		const category = await datrix.create("category", {
			name: "Electronics",
			isActive: true,
		});
		const supplier = await datrix.create("supplier", {
			name: "TechCorp Inc.",
			email: "contact@techcorp.com",
			country: "USA",
		});

		await datrix.create("product", {
			name: "Cheap Widget",
			price: 10,
			stock: 5,
			sku: "QM-001",
			category: category.id,
			supplier: supplier.id,
		});
		await datrix.create("product", {
			name: "Pricey Widget",
			price: 500,
			stock: 2,
			sku: "QM-002",
			category: category.id,
			supplier: supplier.id,
		});
	});

	afterAll(async () => {
		try {
			await fs.rm(tmpDir, { recursive: true, force: true });
		} catch {}
	});

	it("QUERY /api/products filters via body where", async () => {
		const response = await handleRequest(
			datrix,
			createRequest("/api/products", {
				method: "QUERY",
				body: { where: { price: { $gt: 100 } } },
			}),
		);

		const { data: products } = await expectApiMulti(response, 200);
		expect(products).toHaveLength(1);
		expect(products[0].name).toBe("Pricey Widget");
	});

	it("POST /api/products/query alias behaves identically", async () => {
		const response = await handleRequest(
			datrix,
			createRequest("/api/products/query", {
				method: "POST",
				body: { where: { price: { $gt: 100 } } },
			}),
		);

		const { data: products } = await expectApiMulti(response, 200);
		expect(products).toHaveLength(1);
		expect(products[0].name).toBe("Pricey Widget");
	});

	it("returns pagination meta like GET list responses", async () => {
		const response = await handleRequest(
			datrix,
			createRequest("/api/products", {
				method: "QUERY",
				body: { pageSize: 1, orderBy: [{ field: "price", direction: "asc" }] },
			}),
		);

		expect(response.status).toBe(200);
		const json = await response.json();
		expect(json.data).toHaveLength(1);
		expect(json.data[0].name).toBe("Cheap Widget");
		expect(json.meta).toMatchObject({ total: 2, page: 1, pageSize: 1 });
	});

	it("rejects a request with both query string and body query (400)", async () => {
		const response = await handleRequest(
			datrix,
			createRequest(
				"/api/products",
				{ method: "QUERY", body: { where: { price: { $gt: 100 } } } },
				{ pageSize: 5 },
			),
		);

		await expectApiError(response, 400);
	});

	it("rejects unknown body keys (400)", async () => {
		const response = await handleRequest(
			datrix,
			createRequest("/api/products", {
				method: "QUERY",
				body: { filters: { price: 10 } },
			}),
		);

		const error = await expectApiError(response, 400);
		expect(error.code).toBe("UNKNOWN_PARAMETER");
	});

	it("rejects invalid field names in populate-level where (400)", async () => {
		const response = await handleRequest(
			datrix,
			createRequest("/api/products", {
				method: "QUERY",
				body: {
					populate: {
						category: { where: { 'name"; DROP TABLE x;--': "x" } },
					},
				},
			}),
		);

		await expectApiError(response, 400);
	});

	it("rejects empty $in arrays (400)", async () => {
		const response = await handleRequest(
			datrix,
			createRequest("/api/products", {
				method: "QUERY",
				body: { where: { price: { $in: [] } } },
			}),
		);

		await expectApiError(response, 400);
	});

	it("rejects pageSize above maxPageSize (400)", async () => {
		const response = await handleRequest(
			datrix,
			createRequest("/api/products", {
				method: "QUERY",
				body: { pageSize: 100000 },
			}),
		);

		await expectApiError(response, 400);
	});

	it("QUERY body never reaches the insert path", async () => {
		const before = await datrix.count("product");

		await handleRequest(
			datrix,
			createRequest("/api/products", {
				method: "QUERY",
				body: { where: { price: { $gt: 0 } } },
			}),
		);

		const after = await datrix.count("product");
		expect(after).toBe(before);
	});

	it("returns 404 for non-numeric ids on regular routes", async () => {
		const response = await handleRequest(
			datrix,
			createRequest("/api/products/abc"),
		);

		await expectApiError(response, 404);
	});

	it("returns 404 for partially numeric ids", async () => {
		const response = await handleRequest(
			datrix,
			createRequest("/api/products/12abc"),
		);

		await expectApiError(response, 404);
	});
});
