/**
 * Unified Request Handler
 *
 * SINGLE ENTRY POINT for all API requests
 * Handles authentication, permission checking, and routing
 */

import type { Forja } from "@forja/core";
import type {
	RequestContext,
	ContextBuilderOptions,
} from "../middleware/types";
import { buildRequestContext } from "../middleware/context";
import {
	checkSchemaPermission,
	checkFieldsForWrite,
	filterFieldsForRead,
	filterRecordsForRead,
} from "../middleware/permission";
import { jsonResponse, forjaErrorResponse } from "./utils";
import { handlerError } from "../errors/api-error";
import { ForjaError, ForjaValidationError } from "@forja/core";
import type { ForjaEntry } from "@forja/core";
import { ResponseData } from "@forja/core";
import { IApiPlugin } from "@forja/core";

/**
 * Handle GET request
 */
async function handleGet(ctx: RequestContext): Promise<Response> {
	const { forja, schema, authEnabled } = ctx;

	if (!schema) {
		throw handlerError.schemaNotFound(ctx.url.pathname);
	}

	const { upload } = ctx.api;

	if (ctx.id) {
		const result = await forja.findById(schema.name, ctx.id, {
			select: ctx.query?.select,
			populate: ctx.query?.populate,
		});

		if (!result) {
			throw handlerError.recordNotFound(schema.name, ctx.id);
		}

		if (authEnabled) {
			const { data: filteredResult } = await filterFieldsForRead(
				schema,
				result,
				ctx,
			);
			const data = upload
				? await upload.injectUrls(filteredResult)
				: filteredResult;
			return jsonResponse({ data });
		}

		const data = upload ? await upload.injectUrls(result) : result;
		return jsonResponse({ data });
	} else {
		const page = ctx.query?.page ?? 1;
		const pageSize = ctx.query?.pageSize ?? 25;
		const limit = pageSize;
		const offset = (page - 1) * pageSize;

		const result = await forja.findMany(schema.name, {
			where: ctx.query?.where,
			select: ctx.query?.select,
			populate: ctx.query?.populate,
			orderBy: ctx.query?.orderBy,
			limit,
			offset,
		});

		const total = await forja.count(schema.name, ctx.query?.where);
		const totalPages = Math.ceil(total / pageSize);

		if (authEnabled) {
			const filteredResults = await filterRecordsForRead(schema, result, ctx);
			const data = upload
				? await upload.injectUrls(filteredResults)
				: filteredResults;

			const response: ResponseData = {
				data,
				meta: { total, page, pageSize, totalPages },
			};

			return jsonResponse(response);
		}

		const data = upload ? await upload.injectUrls(result) : result;
		const response: ResponseData = {
			data,
			meta: { total, page, pageSize, totalPages },
		};

		return jsonResponse(response);
	}
}

/**
 * Handle POST request
 */
async function handlePost(ctx: RequestContext): Promise<Response> {
	const { forja, schema, authEnabled, body, query } = ctx;

	if (!schema) {
		throw handlerError.schemaNotFound(ctx.url.pathname);
	}

	if (!body || typeof body !== "object" || Array.isArray(body)) {
		throw handlerError.invalidBody();
	}

	if (authEnabled) {
		const fieldCheck = await checkFieldsForWrite(schema, ctx);

		if (!fieldCheck.allowed) {
			throw handlerError.permissionDenied(
				`Permission denied for fields: ${fieldCheck.deniedFields?.join(", ")}`,
				{ deniedFields: fieldCheck.deniedFields },
			);
		}
	}

	const { upload } = ctx.api;

	const result = await forja.create(schema.name, body, {
		select: query?.select,
		populate: query?.populate,
	});

	if (authEnabled) {
		const { data: filteredResult } = await filterFieldsForRead(
			schema,
			result as unknown as ForjaEntry,
			ctx,
		);
		const data = upload
			? await upload.injectUrls(filteredResult)
			: filteredResult;
		return jsonResponse({ data }, 201);
	}

	const data = upload ? await upload.injectUrls(result) : result;
	return jsonResponse({ data }, 201);
}

/**
 * Handle PATCH/PUT request (update)
 */
async function handleUpdate(ctx: RequestContext): Promise<Response> {
	const { forja, schema, authEnabled, body, id } = ctx;

	if (!schema) {
		throw handlerError.schemaNotFound(ctx.url.pathname);
	}

	if (!id) {
		throw handlerError.missingId("update");
	}

	if (!body || typeof body !== "object" || Array.isArray(body)) {
		throw handlerError.invalidBody();
	}

	const existingRecord = await forja.findById(schema.name, id);

	if (!existingRecord) {
		throw handlerError.recordNotFound(schema.name, id);
	}

	if (authEnabled) {
		const fieldCheck = await checkFieldsForWrite(schema, ctx);

		if (!fieldCheck.allowed) {
			throw handlerError.permissionDenied(
				`Permission denied for fields: ${fieldCheck.deniedFields?.join(", ")}`,
				{ deniedFields: fieldCheck.deniedFields },
			);
		}
	}

	const result = await forja.update(schema.name, id, body, {
		select: ctx.query?.select,
		populate: ctx.query?.populate,
	});

	if (!result) {
		throw handlerError.recordNotFound(schema.name, id);
	}

	const { upload } = ctx.api;

	if (authEnabled) {
		const { data: filteredResult } = await filterFieldsForRead(
			schema,
			result as unknown as ForjaEntry,
			ctx,
		);
		const data = upload
			? await upload.injectUrls(filteredResult)
			: filteredResult;
		return jsonResponse({ data });
	}

	const data = upload ? await upload.injectUrls(result) : result;
	return jsonResponse({ data });
}

/**
 * Handle DELETE request
 */
async function handleDelete(ctx: RequestContext): Promise<Response> {
	const { forja, schema, id } = ctx;

	if (!schema) {
		throw handlerError.schemaNotFound(ctx.url.pathname);
	}

	if (!id) {
		throw handlerError.missingId("delete");
	}

	const deleted = await forja.delete(schema.name, id);

	if (!deleted) {
		throw handlerError.recordNotFound(schema.name, id);
	}

	return jsonResponse({ data: { id, deleted: true } });
}

/**
 * Unified Request Handler
 *
 * Main entry point - handles all HTTP methods
 *
 * Flow:
 * 1. Build context (auth, parse URL, parse query/body, resolve schema) - ONCE
 * 2. Check schema-level permission (only if auth enabled) - ONCE
 * 3. Route to method handler (which handles field-level permissions if auth enabled)
 */
export async function handleCrudRequest<TRole extends string = string>(
	request: Request,
	forja: Forja,
	api: IApiPlugin<TRole>,
	options?: ContextBuilderOptions,
): Promise<Response> {
	try {
		const ctx = await buildRequestContext(request, forja, api, options);

		if (!ctx.schema) {
			throw handlerError.modelNotSpecified();
		}

		if (api.excludeSchemas.includes(ctx.schema.name)) {
			throw handlerError.schemaNotFound(ctx.url.pathname);
		}

		if (ctx.authEnabled) {
			const permissionResult = await checkSchemaPermission(
				ctx.schema,
				ctx,
				api.authDefaultPermission,
			);

			if (!permissionResult.allowed) {
				throw ctx.user
					? handlerError.permissionDenied("Schema scope permission denied")
					: handlerError.unauthorized();
			}
		}

		api.setUser(ctx.user);

		switch (ctx.method) {
			case "GET":
				return await handleGet(ctx);
			case "POST":
				return await handlePost(ctx);
			case "PATCH":
			case "PUT":
				return await handleUpdate(ctx);
			case "DELETE":
				return await handleDelete(ctx);
			default: {
				throw handlerError.methodNotAllowed(ctx.method);
			}
		}
	} catch (error) {
		if (error instanceof ForjaValidationError || error instanceof ForjaError) {
			return forjaErrorResponse(error);
		}

		console.error("Unified Handler Error:", error);
		const message =
			error instanceof Error ? error.message : "Internal server error";
		return forjaErrorResponse(
			handlerError.internalError(
				message,
				error instanceof Error ? error : undefined,
			),
		);
	}
}
