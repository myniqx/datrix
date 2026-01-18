/**
 * Forja API Helper
 *
 * Provides a single-line helper function for handling API requests in user code.
 */

import { ApiPlugin } from "../api";
import { Forja } from "forja-core";

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
 * import { getForja } from 'forja-core';
 * import { handleRequest } from 'forja-api/helper';
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
 * import { getForja } from 'forja-core';
 * import { handleRequest } from 'forja-api/helper';
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
    const api = forja.getPlugin("api") as unknown as ApiPlugin | undefined;

    if (!api) {
      return new Response(
        JSON.stringify({
          error: {
            message: "API is not configured in forja.config.ts",
            code: "API_NOT_CONFIGURED",
            hint: 'Add "api: new ForjaApi({ ... })" to your forja.config.ts',
          },
        }),
        {
          status: 503,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // 2. Check if API is enabled (api.enabled = false)
    if (!api.isEnabled()) {
      return new Response(
        JSON.stringify({
          error: {
            message: "API is disabled",
            code: "API_DISABLED",
            hint: 'Set "enabled: true" in ForjaApi configuration',
          },
        }),
        {
          status: 503,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // 3. Handle request (all logic inside ForjaApi)
    return await api.handleRequest(request, forja);
  } catch (error) {
    // 4. Catch unexpected errors (should rarely happen)
    console.error("[Forja API] Unexpected error:", error);

    return new Response(
      JSON.stringify({
        error: {
          message: error instanceof Error ? error.message : "Internal server error",
          code: "INTERNAL_ERROR",
          stack:
            process.env["NODE_ENV"] === "development" && error instanceof Error ?
              error.stack
              : undefined,
        },
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}
