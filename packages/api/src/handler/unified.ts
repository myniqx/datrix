/**
 * Unified Request Handler
 *
 * SINGLE ENTRY POINT for all API requests
 * Handles authentication, permission checking, and routing
 */

import type { Forja } from "forja-core";
import type {
  RequestContext,
  ContextBuilderOptions,
} from "../middleware/types";
import type { IApiPlugin } from "../interface";
import { buildRequestContext, ContextBuildError } from "../middleware/context";
import {
  checkSchemaPermission,
  checkFieldsForWrite,
  filterFieldsForRead,
  filterRecordsForRead,
} from "../middleware/permission";
import { jsonResponse, errorResponse, parserErrorResponse } from "./utils";

/**
 * Handle GET request
 */
async function handleGet(ctx: RequestContext): Promise<Response> {
  const { forja, schema, authEnabled } = ctx;

  if (!schema) {
    return errorResponse("Schema not found", "SCHEMA_NOT_FOUND", 404);
  }

  try {
    if (ctx.id) {
      // findOne by ID
      const result = await forja.findById(schema.name, ctx.id, {
        select: ctx.query?.select,
        populate: ctx.query?.populate,
      });

      if (!result) {
        return errorResponse("Not found", "NOT_FOUND", 404);
      }

      // Filter fields based on permission (only if auth enabled)
      if (authEnabled) {
        const { data: filteredResult } = await filterFieldsForRead(
          schema,
          result as Record<string, unknown>,
          ctx,
        );
        return jsonResponse({ data: filteredResult });
      }

      return jsonResponse({ data: result });
    } else {
      // findMany
      const result = await forja.findMany(schema.name, {
        where: ctx.query?.where,
        select: ctx.query?.select,
        populate: ctx.query?.populate,
        orderBy: ctx.query?.orderBy,
        limit: ctx.query?.limit,
        offset: ctx.query?.offset,
      });

      // Get total count
      const total = await forja.count(schema.name, ctx.query?.where);

      // Filter fields for each record (only if auth enabled)
      if (authEnabled) {
        const filteredResults = await filterRecordsForRead(
          schema,
          result as Record<string, unknown>[],
          ctx,
        );

        return jsonResponse({
          data: filteredResults,
          meta: {
            total,
            count: filteredResults.length,
            limit: ctx.query?.limit,
            offset: ctx.query?.offset,
          },
        });
      }

      return jsonResponse({
        data: result,
        meta: {
          total,
          count: (result as unknown[]).length,
          limit: ctx.query?.limit,
          offset: ctx.query?.offset,
        },
      });
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return errorResponse(message, "INTERNAL_ERROR", 500);
  }
}

/**
 * Handle POST request
 */
async function handlePost(ctx: RequestContext): Promise<Response> {
  const { forja, schema, authEnabled, body, query } = ctx;

  if (!schema) {
    return errorResponse("Schema not found", "SCHEMA_NOT_FOUND", 404);
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return errorResponse("Invalid request body", "INVALID_BODY", 400);
  }

  try {
    // Check field-level write permissions (only if auth enabled)
    if (authEnabled) {
      const fieldCheck = await checkFieldsForWrite(schema, ctx);

      if (!fieldCheck.allowed) {
        return errorResponse(
          `Permission denied for fields: ${fieldCheck.deniedFields?.join(", ")}`,
          "FIELD_PERMISSION_DENIED",
          403,
        );
      }
    }

    const result = await forja.create(schema.name, body, {
      select: query?.select,
      populate: query?.populate,
    });

    // Filter response fields (only if auth enabled)
    if (authEnabled) {
      const { data: filteredResult } = await filterFieldsForRead(
        schema,
        result,
        ctx,
      );
      return jsonResponse({ data: filteredResult }, 201);
    }

    return jsonResponse({ data: result }, 201);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    const code = // TODO: error codeları için merkezi bir dosya hazırla. tüm projede unified bir errorbase sınıfından tüm errorlar extends edilsin.
      ((error as Record<string, unknown>)?.["code"] as string) || "INTERNAL_ERROR";

    // Validation and constraint errors should return 400
    if (
      code === "VALIDATION_FAILED" ||
      message.toLowerCase().includes("duplicate") ||
      message.toLowerCase().includes("unique")
    ) {
      return errorResponse(message, code, 400);
    }

    return errorResponse(message, code, 500);
  }
}

/**
 * Handle PATCH/PUT request (update)
 */
async function handleUpdate(ctx: RequestContext): Promise<Response> {
  const { forja, schema, authEnabled, body, id } = ctx;

  if (!schema) {
    return errorResponse("Schema not found", "SCHEMA_NOT_FOUND", 404);
  }

  if (!id) {
    return errorResponse("ID is required for update", "MISSING_ID", 400);
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return errorResponse("Invalid request body", "INVALID_BODY", 400);
  }

  try {
    // Get existing record for permission context
    const existingRecord = await forja.findById(schema.name, id);

    if (!existingRecord) {
      return errorResponse("Not found", "NOT_FOUND", 404);
    }

    // Check field-level write permissions (only if auth enabled)
    if (authEnabled) {
      const fieldCheck = await checkFieldsForWrite(schema, ctx);

      if (!fieldCheck.allowed) {
        return errorResponse(
          `Permission denied for fields: ${fieldCheck.deniedFields?.join(", ")}`,
          "FIELD_PERMISSION_DENIED",
          403,
        );
      }
    }

    const result = await forja.update(schema.name, id, body, {
      select: ctx.query?.select,
      populate: ctx.query?.populate,
    });

    if (!result) {
      return errorResponse("Not found", "NOT_FOUND", 404);
    }

    // Filter response fields (only if auth enabled)
    if (authEnabled) {
      const { data: filteredResult } = await filterFieldsForRead(
        schema,
        result as Record<string, unknown>,
        ctx,
      );
      return jsonResponse({ data: filteredResult });
    }

    return jsonResponse({ data: result });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    const code =
      ((error as Record<string, unknown>)?.["code"] as string) || "INTERNAL_ERROR";

    // Validation and constraint errors should return 400
    if (
      code === "VALIDATION_FAILED" ||
      message.toLowerCase().includes("duplicate") ||
      message.toLowerCase().includes("unique")
    ) {
      return errorResponse(message, code, 400);
    }

    return errorResponse(message, code, 500);
  }
}

/**
 * Handle DELETE request
 */
async function handleDelete(ctx: RequestContext): Promise<Response> {
  const { forja, schema, id } = ctx;

  if (!schema) {
    return errorResponse("Schema not found", "SCHEMA_NOT_FOUND", 404);
  }

  if (!id) {
    return errorResponse("ID is required for delete", "MISSING_ID", 400);
  }

  try {
    const deleted = await forja.delete(schema.name, id);

    if (!deleted) {
      return errorResponse("Not found", "NOT_FOUND", 404);
    }

    return jsonResponse({ data: { id, deleted: true } });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return errorResponse(message, "INTERNAL_ERROR", 500);
  }
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
export async function handleRequest<TRole extends string = string>(
  request: Request,
  forja: Forja,
  api: IApiPlugin<TRole>,
  options?: ContextBuilderOptions,
): Promise<Response> {
  try {
    // 1️⃣ BUILD REQUEST CONTEXT (Single place - auth, parse, extract, resolve schema)
    const ctx = await buildRequestContext(request, forja, api, options);

    if (!ctx.schema) {
      return errorResponse("Model not specified", "MODEL_NOT_SPECIFIED", 400);
    }

    // 2️⃣ PERMISSION CHECK (Schema-level) - Only if auth is enabled
    if (ctx.authEnabled) {
      const permissionResult = await checkSchemaPermission(
        ctx.schema,
        ctx,
        api.authDefaultPermission,
      );

      if (!permissionResult.allowed) {
        return errorResponse(
          ctx.user ? "Forbidden" : "Unauthorized",
          ctx.user ? "FORBIDDEN" : "UNAUTHORIZED",
          ctx.user ? 403 : 401,
        );
      }
    }

    // Set user on API plugin for query context hooks
    api.setUser(ctx.user);

    // 3️⃣ ROUTE TO METHOD HANDLER
    switch (ctx.method) {
      case "GET":
        return handleGet(ctx);
      case "POST":
        return handlePost(ctx);
      case "PATCH":
      case "PUT":
        return handleUpdate(ctx);
      case "DELETE":
        return handleDelete(ctx);
      default:
        return errorResponse(
          `Method ${ctx.method} not allowed`,
          "METHOD_NOT_ALLOWED",
          405,
        );
    }
  } catch (error) {
    // Handle parser errors with rich context
    if (error instanceof ContextBuildError) {
      return parserErrorResponse(error.parserError);
    }

    // Generic error handling
    console.error("Unified Handler Error:", error);
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return errorResponse(message, "INTERNAL_ERROR", 500);
  }
}
