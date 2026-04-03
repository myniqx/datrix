/**
 * Forja API Helper
 *
 * Provides helper functions for handling API requests in user code.
 * Works with any framework that uses the Web Request/Response API natively
 * (Next.js App Router, Hono, Remix, Cloudflare Workers, Bun, Deno).
 * For Node.js frameworks (Express, Fastify, Koa) use toWebRequest / sendWebResponse.
 */

import { ApiPlugin } from "../api";
import { Forja } from "@forja/core";
import { forjaErrorResponse } from "../handler/utils";
import { handlerError } from "../errors/api-error";
import { ForjaError } from "@forja/types/errors";

// ─── Node.js bridge types ─────────────────────────────────────────────────────
// Duck-typed — no express/fastify dependency required.

interface NodeIncomingRequest {
	method: string;
	url?: string;
	headers: Record<string, string | string[] | undefined>;
	body?: unknown;
	socket?: { encrypted?: boolean };
}

interface NodeOutgoingResponse {
	statusCode: number;
	setHeader(key: string, value: string): unknown;
	end(body: string): void;
}

// ─── Node.js bridge ───────────────────────────────────────────────────────────

/**
 * Convert a Node.js-style incoming request (Express, Fastify, Koa, raw http.IncomingMessage)
 * to a Web API Request.
 *
 * Call this before passing the request to handleRequest.
 *
 * @example
 * ```ts
 * app.all("*", async (req, res) => {
 *   const request  = toWebRequest(req)
 *   const response = await handleRequest(await forja(), request)
 *   await sendWebResponse(res, response)
 * })
 * ```
 */
export function toWebRequest(req: NodeIncomingRequest): Request {
	const protocol = req.socket?.encrypted ? "https" : "http";
	const host = (req.headers["host"] as string | undefined) ?? "localhost";
	const url = `${protocol}://${host}${req.url ?? "/"}`;

	const headers = new Headers();
	for (const [key, value] of Object.entries(req.headers)) {
		if (value === undefined) continue;
		if (Array.isArray(value)) {
			for (const v of value) headers.append(key, v);
		} else {
			headers.set(key, value);
		}
	}

	const hasBody = req.body !== undefined && req.body !== null;
	const methodAllowsBody = !["GET", "HEAD"].includes(req.method.toUpperCase());

	let body: RequestInit["body"] = undefined!;
	if (hasBody && methodAllowsBody) {
		if (req.body instanceof Uint8Array || Buffer.isBuffer(req.body)) {
			body = req.body as Uint8Array;
		} else if (typeof req.body === "string") {
			body = req.body;
		} else {
			body = JSON.stringify(req.body);
		}
	}

	return new Request(url, {
		method: req.method,
		headers,
		body,
	});
}

/**
 * Write a Web API Response back into a Node.js-style outgoing response
 * (Express, Fastify, Koa, raw http.ServerResponse).
 *
 * @example
 * ```ts
 * app.all("*", async (req, res) => {
 *   const request  = toWebRequest(req)
 *   const response = await handleRequest(await forja(), request)
 *   await sendWebResponse(res, response)
 * })
 * ```
 */
export async function sendWebResponse(
	res: NodeOutgoingResponse,
	response: Response,
): Promise<void> {
	res.statusCode = response.status;
	response.headers.forEach((value, key) => {
		res.setHeader(key, value);
	});
	const body = await response.text();
	res.end(body);
}

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
 * // Next.js App Router — Web Request/Response native, no bridge needed
 * import forja from "@/forja.config"
 * import { handleRequest } from "@forja/api"
 *
 * async function handler(request: Request): Promise<Response> {
 *   return handleRequest(await forja(), request)
 * }
 *
 * export const GET = handler
 * export const POST = handler
 * export const PATCH = handler
 * export const PUT = handler
 * export const DELETE = handler
 * ```
 *
 * @example
 * ```ts
 * // Express — use toWebRequest / sendWebResponse bridge
 * import express from "express"
 * import forja from "./forja.config"
 * import { handleRequest, toWebRequest, sendWebResponse } from "@forja/api"
 *
 * const app = express()
 * app.use(express.raw({ type: "*\/*" }))
 *
 * app.all("*", async (req, res) => {
 *   const request  = toWebRequest(req)
 *   const response = await handleRequest(await forja(), request)
 *   await sendWebResponse(res, response)
 * })
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

		// 2. Check if API is disabled
		if (!api.isEnabled()) {
			const errRes = handlerError.internalError(
				'API is disabled. Remove "disabled: true" from ApiPlugin configuration.',
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
