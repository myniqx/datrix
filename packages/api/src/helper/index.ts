/**
 * Forja API Helper
 *
 * Provides a single-line helper function for handling API requests in user code.
 */

import { ApiPlugin } from "../api";
import { Forja } from "forja-core";
import { forjaErrorResponse } from "../handler/utils";
import { handlerError } from "../errors/api-error";
import { ForjaError } from "forja-types/errors";

/**
 * Handle Forja API Request
 *
 * This is the ONLY function users need to call in their route handlers.
 *
 * Handles:
 * - Config validation (is api configured?)
 * - API enabled check (is api.enabled = true?)
 * - Error handling (unexpected errors)
 * - Request routing (auth/crud)
 *
 * @param forja - Forja instance (must have getConfig() method)
 * @param request - Web API Request
 * @returns Web API Response
 *
 * @example
 * ```ts
 * // Next.js App Router
 * import { getForja } from '@forja/core';
 * import { handleRequest } from '@forja/api/helper';
 *
 * async function handler(request: Request): Promise<Response> {
 *   return handleRequest(await getForja(), request);
 * }
 *
 * export const GET = handler;
 * export const POST = handler;
 * export const PATCH = handler;
 * export const PUT = handler;
 * export const DELETE = handler;
 * ```
 *
 * @example
 * ```ts
 * // Express
 * import express from 'express';
 * import { getForja } from '@forja/core';
 * import { handleRequest } from '@forja/api/helper';
 *
 * const app = express();
 *
 * app.all('/api/*', async (req, res) => {
 *   const request = new Request(req.url, {
 *     method: req.method,
 *     headers: req.headers,
 *     body: req.body,
 *   });
 *
 *   const response = await handleRequest(await getForja(), request);
 *   res.status(response.status).json(await response.json());
 * });
 * ```
 */
export async function handleRequest(
	forja: Forja,
	request: Request,
): Promise<Response> {
	try {
		// 1. Check if API is configured
		const api = forja.getPlugin("api");

		if (!api || !(api instanceof ApiPlugin)) {
			const errRes = handlerError.internalError(
				'API is not configured in forja.config.ts. Add "api: new ForjaApi({ ... })" to your configuration.',
			);
			return forjaErrorResponse(errRes);
		}

		// 2. Check if API is enabled (api.enabled = false)
		if (!api.isEnabled()) {
			const errRes = handlerError.internalError(
				'API is disabled. Set "enabled: true" in ForjaApi configuration.',
			);
			return forjaErrorResponse(errRes);
		}

		// 3. Handle request (all logic inside ForjaApi)
		return await api.handleRequest(request, forja);
	} catch (error) {
		if (error instanceof ForjaError) {
			return forjaErrorResponse(error);
		}

		// 4. Catch unexpected errors (should rarely happen)
		console.error("[Forja API] Unexpected error:", error);
		const message =
			error instanceof Error ? error.message : "Internal server error";
		const errRes = handlerError.internalError(
			message,
			error instanceof Error ? error : undefined,
		);
		return forjaErrorResponse(errRes);
	}
}
