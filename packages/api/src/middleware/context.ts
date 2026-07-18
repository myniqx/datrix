/**
 * Context Builder Middleware
 *
 * Builds unified request context from raw request
 * This is the SINGLE PLACE where all request preprocessing happens
 */

import type {
	RequestContext,
	RequestLimits,
	HttpMethod,
	ContextBuilderOptions,
} from "./types";
import type { Datrix } from "@datrix/core";
import { methodToAction } from "./permission";
import { parseQuery, validateQueryBody } from "../parser";
import { handlerError } from "../errors/api-error";
import { FallbackInput } from "@datrix/core";
import { ParsedQuery, DatrixEntry } from "@datrix/core";
import { AuthUser, IApiPlugin } from "@datrix/core";

/**
 * Sub-resource segment reserved for the POST /:model/query alias
 */
const QUERY_SEGMENT = "query";

/**
 * Extract table name from URL path
 * /api/users -> 'users'
 * /api/users/123 -> 'users'
 */
function extractTableNameFromPath(
	pathname: string,
	prefix: string,
): string | null {
	const segments = pathSegmentsAfterPrefix(pathname, prefix);

	if (segments.length === 0) {
		return null;
	}

	return segments[0] ?? null;
}

function pathSegmentsAfterPrefix(pathname: string, prefix: string): string[] {
	const segments = pathname.split("/").filter(Boolean);
	const prefixSegments = prefix.split("/").filter(Boolean);
	return segments.slice(prefixSegments.length);
}

/**
 * Extract record ID from URL path
 * /api/user/123 -> 123
 * /api/user -> null
 * /api/user/query -> null (reserved sub-resource, QUERY alias)
 * /api/user/abc -> 404
 *
 * @throws {DatrixApiError} 404 for non-numeric ids or extra path segments
 */
function extractIdFromPath(
	segments: string[],
	isUploadRoute: boolean,
): number | null {
	if (segments.length < 2) {
		return null;
	}

	const idSegment = segments[1]!;

	// The upload route manages its own sub-paths — extract a numeric id when
	// present, but never 404 on extra or non-numeric segments.
	if (isUploadRoute) {
		return /^\d+$/.test(idSegment) && segments.length === 2
			? parseInt(idSegment, 10)
			: null;
	}

	if (idSegment === QUERY_SEGMENT) {
		if (segments.length > 2) {
			throw handlerError.recordNotFound(segments[0] ?? "", segments.join("/"));
		}
		return null;
	}

	if (!/^\d+$/.test(idSegment)) {
		throw handlerError.recordNotFound(segments[0] ?? "", idSegment);
	}

	if (segments.length > 2) {
		throw handlerError.recordNotFound(segments[0] ?? "", segments.join("/"));
	}

	return parseInt(idSegment, 10);
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
 * @throws {ParserError | DatrixApiError} When parsing/validation fails
 */
export async function buildRequestContext<TRole extends string = string>(
	request: Request,
	datrix: Datrix,
	api: IApiPlugin<TRole>,
	options: ContextBuilderOptions = {},
): Promise<RequestContext<TRole>> {
	const apiPrefix = options.apiPrefix ?? "/api";
	const url = new URL(request.url);
	const method = request.method.toUpperCase() as HttpMethod;
	const authEnabled = api.isAuthEnabled();

	// Effective limits: plugin config wins over parser defaults
	const limits: RequestLimits = {
		defaultPageSize: options.defaultPageSize ?? 25,
		maxPageSize: options.maxPageSize ?? 100,
		maxPopulateDepth: options.maxPopulateDepth ?? 5,
	};

	// 1. RESOLVE SCHEMA from URL
	const segments = pathSegmentsAfterPrefix(url.pathname, apiPrefix);
	const tableName = extractTableNameFromPath(url.pathname, apiPrefix);
	const isUploadRoute = tableName === "upload" && api.upload !== undefined;
	const modelName = isUploadRoute
		? api.upload!.getModelName()
		: datrix.getSchemas().findModelByTableName(tableName);
	const schema = modelName ? (datrix.getSchema(modelName) ?? null) : null;

	// 2. EXTRACT ID from URL (404 on malformed ids / extra segments)
	const id = extractIdFromPath(segments, isUploadRoute);

	// 3. DETECT QUERY REQUEST (QUERY method or POST /:model/query alias)
	const isQueryAlias = segments[1] === QUERY_SEGMENT;
	const isQueryRequest =
		method === "QUERY" || (method === "POST" && isQueryAlias);

	if (isQueryAlias && method !== "POST" && method !== "QUERY") {
		throw handlerError.methodNotAllowed(method);
	}

	// 4. DERIVE ACTION from HTTP method (the POST alias is a read)
	const action = isQueryRequest ? "read" : methodToAction(method);

	// 5. AUTHENTICATE (only if auth is enabled) — resolves email/role and the
	// populated user record from the DB (decision D1)
	let user: AuthUser | null = null;
	if (authEnabled) {
		user = await api.resolveAuthUser(request);
	}

	// 6. PARSE QUERY (from query string - works for all HTTP methods)
	let query: ParsedQuery<DatrixEntry> | null = null;
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
		query = parseQuery(queryParams, limits);
	}

	// 7. PARSE BODY (POST/PATCH/PUT insert/update data, or the QUERY body)
	let body: FallbackInput | null = null;
	if (["POST", "PATCH", "PUT", "QUERY"].includes(method)) {
		const contentType = request.headers.get("content-type");
		if (contentType?.includes("application/json")) {
			try {
				body = (await request.json()) as FallbackInput;
			} catch {
				throw handlerError.invalidBody("Malformed JSON");
			}
		}
	}

	if (isQueryRequest) {
		// The body IS the query — never insert data. Reject the ambiguous case
		// of both a query string and a body query instead of merging.
		if (body !== null) {
			if (query !== null) {
				throw handlerError.invalidBody(
					"Provide the query either in the query string or in the body, not both",
				);
			}
			query = validateQueryBody(body, limits);
		}
		body = null;
	}

	// 8. EXTRACT HEADERS
	const headers: Record<string, string> = {};
	request.headers.forEach((value, key) => {
		headers[key] = value;
	});

	// 9. BUILD UNIFIED CONTEXT
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
		datrix,
		api,
		authEnabled,
		isQueryRequest,
		limits,
	};
}
