/**
 * Context Builder Middleware
 *
 * Builds unified request context from raw request
 * This is the SINGLE PLACE where all request preprocessing happens
 */

import type {
	RequestContext,
	HttpMethod,
	ContextBuilderOptions,
} from "./types";
import type { Forja } from "@forja/core";
import { ParserError } from "@forja/core/types/api/parser";
import { methodToAction } from "./permission";
import { parseQuery } from "../parser";
import { FallbackInput } from "@forja/core/types/forja";
import { AuthUser, IApiPlugin } from "@forja/core/types/api";

/**
 * Extract table name from URL path
 * /api/users -> 'users'
 * /api/users/123 -> 'users'
 */
function extractTableNameFromPath(
	pathname: string,
	prefix: string,
): string | null {
	const segments = pathname.split("/").filter(Boolean);
	const prefixSegments = prefix.split("/").filter(Boolean);
	const pathSegments = segments.slice(prefixSegments.length);

	if (pathSegments.length === 0) {
		return null;
	}

	return pathSegments[0] ?? null;
}

/**
 * Extract record ID from URL path
 * /api/user/123 -> '123'
 * /api/user -> null
 */
function extractIdFromPath(pathname: string, prefix: string): number | null {
	const segments = pathname.split("/").filter(Boolean);
	const prefixSegments = prefix.split("/").filter(Boolean);
	const pathSegments = segments.slice(prefixSegments.length);

	if (pathSegments.length < 2) {
		return null;
	}
	const val = parseInt(pathSegments[1]!, 10);
	return isNaN(val) ? null : val;
}

/**
 * Parser error wrapper for context building
 */
export class ContextBuildError extends Error {
	readonly parserError: ParserError;

	constructor(parserError: ParserError) {
		super(parserError.message);
		this.name = "ContextBuildError";
		this.parserError = parserError;
	}
}

/**
 * Build Request Context
 *
 * This is the CENTRALIZED place where:
 * 1. Schema resolution happens
 * 2. Authentication happens (only if enabled)
 * 3. URL parsing happens
 * 4. Query parsing happens
 * 5. Body parsing happens
 *
 * ALL requests go through this function ONCE
 *
 * @throws {ContextBuildError} When query parsing fails
 */
export async function buildRequestContext<TRole extends string = string>(
	request: Request,
	forja: Forja,
	api: IApiPlugin<TRole>,
	options: ContextBuilderOptions = {},
): Promise<RequestContext<TRole>> {
	const apiPrefix = options.apiPrefix ?? "/api";
	const url = new URL(request.url);
	const method = request.method as HttpMethod;
	const authEnabled = api.isAuthEnabled();

	// 1. RESOLVE SCHEMA from URL
	const tableName = extractTableNameFromPath(url.pathname, apiPrefix);
	const modelName =
		tableName === "upload" && api.upload
			? api.upload.getModelName()
			: forja.getSchemas().findModelByTableName(tableName);
	const schema = modelName ? (forja.getSchema(modelName) ?? null) : null;

	// 2. DERIVE ACTION from HTTP method
	const action = methodToAction(method);

	// 3. EXTRACT ID from URL
	const id = extractIdFromPath(url.pathname, apiPrefix);

	// 4. AUTHENTICATE (only if auth is enabled)
	let user: AuthUser | null = null;
	if (authEnabled && api.authManager) {
		const authResult = await api.authManager.authenticate(request);
		user = authResult?.user ?? null;
	}

	// 5. PARSE QUERY (from query string - works for all HTTP methods)
	let query = null;
	const queryParams: Record<string, string | string[]> = {};
	url.searchParams.forEach((value, key) => {
		const existing = queryParams[key];
		if (existing !== undefined) {
			if (Array.isArray(existing)) {
				existing.push(value);
			} else {
				queryParams[key] = [existing, value];
			}
		} else {
			queryParams[key] = value;
		}
	});

	if (Object.keys(queryParams).length > 0) {
		query = parseQuery(queryParams);
	}

	// 6. PARSE BODY (for POST/PATCH/PUT requests)
	let body = null;
	if (["POST", "PATCH", "PUT"].includes(method)) {
		try {
			const contentType = request.headers.get("content-type");
			if (contentType?.includes("application/json")) {
				body = (await request.json()) as FallbackInput;
			}
		} catch {
			// Invalid JSON, body stays null
		}
	}

	// 7. EXTRACT HEADERS
	const headers: Record<string, string> = {};
	request.headers.forEach((value, key) => {
		headers[key] = value;
	});

	// 8. BUILD UNIFIED CONTEXT
	return {
		schema,
		action,
		id,
		method,
		query,
		body,
		headers,
		url,
		request,
		user,
		forja,
		api,
		authEnabled,
	};
}
