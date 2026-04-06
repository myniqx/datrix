/**
 * Datrix API Helper
 *
 * Provides helper functions for handling API requests in user code.
 * Works with any framework that uses the Web Request/Response API natively
 * (Next.js App Router, Hono, Remix, Cloudflare Workers, Bun, Deno).
 * For Node.js frameworks (Express, Fastify, Koa) use toWebRequest / sendWebResponse.
 */

import { ApiPlugin } from "../api";
import { Datrix } from "@datrix/core";
import { datrixErrorResponse } from "../handler/utils";
import { handlerError } from "../errors/api-error";
import { DatrixError } from "@datrix/core";

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
 *   const response = await handleRequest(await datrix(), request)
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
 *   const response = await handleRequest(await datrix(), request)
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
 * Handle Datrix API Request
 *
 * This is the ONLY function users need to call in their route handlers.
 *
 * Handles:
 * - Config validation (is api configured?)
 * - API enabled check (is api.enabled = true?)
 * - Error handling (unexpected errors)
 * - Request routing (auth/crud)
 *
 * @param datrix - Datrix instance (must have getConfig() method)
 * @param request - Web API Request
 * @returns Web API Response
 *
 * @example
 * ```ts
 * // Next.js App Router — Web Request/Response native, no bridge needed
 * import datrix from "@/datrix.config"
 * import { handleRequest } from "@datrix/api"
 *
 * async function handler(request: Request): Promise<Response> {
 *   return handleRequest(await datrix(), request)
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
 * import datrix from "./datrix.config"
 * import { handleRequest, toWebRequest, sendWebResponse } from "@datrix/api"
 *
 * const app = express()
 * app.use(express.raw({ type: "*\/*" }))
 *
 * app.all("*", async (req, res) => {
 *   const request  = toWebRequest(req)
 *   const response = await handleRequest(await datrix(), request)
 *   await sendWebResponse(res, response)
 * })
 * ```
 */
export async function handleRequest(
	datrix: Datrix,
	request: Request,
): Promise<Response> {
	try {
		// 1. Check if API is configured
		const api = datrix.getPlugin("api");

		if (!api || !(api instanceof ApiPlugin)) {
			const errRes = handlerError.internalError(
				'API is not configured in datrix.config.ts. Add "api: new DatrixApi({ ... })" to your configuration.',
			);
			return datrixErrorResponse(errRes);
		}

		// 2. Check if API is disabled
		if (!api.isEnabled()) {
			const errRes = handlerError.internalError(
				'API is disabled. Remove "disabled: true" from ApiPlugin configuration.',
			);
			return datrixErrorResponse(errRes);
		}

		// 3. Handle request (all logic inside DatrixApi)
		return await api.handleRequest(request, datrix);
	} catch (error) {
		if (error instanceof DatrixError) {
			return datrixErrorResponse(error);
		}

		// 4. Catch unexpected errors (should rarely happen)
		console.error("[Datrix API] Unexpected error:", error);
		const message =
			error instanceof Error ? error.message : "Internal server error";
		const errRes = handlerError.internalError(
			message,
			error instanceof Error ? error : undefined,
		);
		return datrixErrorResponse(errRes);
	}
}
