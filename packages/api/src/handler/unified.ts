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
import type { PaginatedResponse } from "../types";
import { buildRequestContext } from "../middleware/context";
import {
  checkSchemaPermission,
  checkFieldsForWrite,
  filterFieldsForRead,
  filterRecordsForRead,
} from "../middleware/permission";
import { jsonResponse, forjaErrorResponse } from "./utils";
import { handlerError } from "../errors/api-error";
import { ForjaError, ForjaValidationError } from "forja-types/errors";
import type { ForjaEntry } from "forja-types/core/schema";

/**
 * Handle GET request
 */
async function handleGet(ctx: RequestContext): Promise<Response> {
  const { forja, schema, authEnabled } = ctx;

  if (!schema) {
    const result = handlerError.schemaNotFound(ctx.url.pathname);
    return forjaErrorResponse(result);
  }

  try {
    if (ctx.id) {
      // findOne by ID
      const result = await forja.findById(schema.name, ctx.id, {
        select: ctx.query?.select,
        populate: ctx.query?.populate,
      });

      if (!result) {
        const errResult = handlerError.recordNotFound(schema.name, ctx.id);
        return forjaErrorResponse(errResult);
      }

      // Filter fields based on permission (only if auth enabled)
      if (authEnabled) {
        const { data: filteredResult } = await filterFieldsForRead(
          schema,
          result,
          ctx,
        );
        return jsonResponse({ data: filteredResult });
      }

      return jsonResponse({ data: result });
    } else {
      // findMany - convert page/pageSize to limit/offset for database query
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

      // Get total count
      const total = await forja.count(schema.name, ctx.query?.where);
      const totalPages = Math.ceil(total / pageSize);

      // Filter fields for each record (only if auth enabled)
      if (authEnabled) {
        const filteredResults = await filterRecordsForRead(schema, result, ctx);

        const response: PaginatedResponse<ForjaEntry> = {
          data: filteredResults,
          meta: {
            total,
            page,
            pageSize,
            totalPages,
          },
        };

        return jsonResponse(response);
      }

      const response: PaginatedResponse<ForjaEntry> = {
        data: result as ForjaEntry[],
        meta: {
          total,
          page,
          pageSize,
          totalPages,
        },
      };

      return jsonResponse(response);
    }
  } catch (error) {
    if (error instanceof ForjaValidationError || error instanceof ForjaError) {
      return forjaErrorResponse({ success: false, error });
    }
    const message =
      error instanceof Error ? error.message : "Internal server error";
    const result = handlerError.internalError(
      message,
      error instanceof Error ? error : undefined,
    );
    return forjaErrorResponse(result);
  }
}

/**
 * Handle POST request
 */
async function handlePost(ctx: RequestContext): Promise<Response> {
  const { forja, schema, authEnabled, body, query } = ctx;

  if (!schema) {
    const result = handlerError.schemaNotFound(ctx.url.pathname);
    return forjaErrorResponse(result);
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    const result = handlerError.invalidBody();
    return forjaErrorResponse(result);
  }

  try {
    // Check field-level write permissions (only if auth enabled)
    if (authEnabled) {
      const fieldCheck = await checkFieldsForWrite(schema, ctx);

      if (!fieldCheck.allowed) {
        const result = handlerError.permissionDenied(
          `Permission denied for fields: ${fieldCheck.deniedFields?.join(", ")}`,
          { deniedFields: fieldCheck.deniedFields },
        );
        return forjaErrorResponse(result);
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
        result as unknown as ForjaEntry,
        ctx,
      );
      return jsonResponse({ data: filteredResult }, 201);
    }

    return jsonResponse({ data: result }, 201);
  } catch (error) {
    if (error instanceof ForjaValidationError || error instanceof ForjaError) {
      return forjaErrorResponse({ success: false, error });
    }
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
      const result = handlerError.invalidBody(message); // Re-wrap validation as 400
      return forjaErrorResponse(result);
    }

    const result = handlerError.internalError(
      message,
      error instanceof Error ? error : undefined,
    );
    return forjaErrorResponse(result);
  }
}

/**
 * Handle PATCH/PUT request (update)
 */
async function handleUpdate(ctx: RequestContext): Promise<Response> {
  const { forja, schema, authEnabled, body, id } = ctx;

  if (!schema) {
    const result = handlerError.schemaNotFound(ctx.url.pathname);
    return forjaErrorResponse(result);
  }

  if (!id) {
    const result = handlerError.missingId("update");
    return forjaErrorResponse(result);
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    const result = handlerError.invalidBody();
    return forjaErrorResponse(result);
  }

  try {
    // Get existing record for permission context
    const existingRecord = await forja.findById(schema.name, id);

    if (!existingRecord) {
      const result = handlerError.recordNotFound(schema.name, id);
      return forjaErrorResponse(result);
    }

    // Check field-level write permissions (only if auth enabled)
    if (authEnabled) {
      const fieldCheck = await checkFieldsForWrite(schema, ctx);

      if (!fieldCheck.allowed) {
        const result = handlerError.permissionDenied(
          `Permission denied for fields: ${fieldCheck.deniedFields?.join(", ")}`,
          { deniedFields: fieldCheck.deniedFields },
        );
        return forjaErrorResponse(result);
      }
    }

    const result = await forja.update(schema.name, id, body, {
      select: ctx.query?.select,
      populate: ctx.query?.populate,
    });

    if (!result) {
      const resultNotFound = handlerError.recordNotFound(schema.name, id);
      return forjaErrorResponse(resultNotFound);
    }

    // Filter response fields (only if auth enabled)
    if (authEnabled) {
      const { data: filteredResult } = await filterFieldsForRead(
        schema,
        result as unknown as ForjaEntry,
        ctx,
      );
      return jsonResponse({ data: filteredResult });
    }

    return jsonResponse({ data: result });
  } catch (error) {
    if (error instanceof ForjaValidationError || error instanceof ForjaError) {
      return forjaErrorResponse({ success: false, error });
    }
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
      const result = handlerError.invalidBody(message);
      return forjaErrorResponse(result);
    }

    const errResult = handlerError.internalError(
      message,
      error instanceof Error ? error : undefined,
    );
    return forjaErrorResponse(errResult);
  }
}

/**
 * Handle DELETE request
 */
async function handleDelete(ctx: RequestContext): Promise<Response> {
  const { forja, schema, id } = ctx;

  if (!schema) {
    const result = handlerError.schemaNotFound(ctx.url.pathname);
    return forjaErrorResponse(result);
  }

  if (!id) {
    const result = handlerError.missingId("delete");
    return forjaErrorResponse(result);
  }

  try {
    const deleted = await forja.delete(schema.name, id);

    if (!deleted) {
      const result = handlerError.recordNotFound(schema.name, id);
      return forjaErrorResponse(result);
    }

    return jsonResponse({ data: { id, deleted: true } });
  } catch (error) {
    if (error instanceof ForjaValidationError || error instanceof ForjaError) {
      return forjaErrorResponse({ success: false, error });
    }
    const message =
      error instanceof Error ? error.message : "Internal server error";
    const result = handlerError.internalError(
      message,
      error instanceof Error ? error : undefined,
    );
    return forjaErrorResponse(result);
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
      const result = handlerError.modelNotSpecified();
      return forjaErrorResponse(result);
    }

    // 2️⃣ PERMISSION CHECK (Schema-level) - Only if auth is enabled
    if (ctx.authEnabled) {
      const permissionResult = await checkSchemaPermission(
        ctx.schema,
        ctx,
        api.authDefaultPermission,
      );

      if (!permissionResult.allowed) {
        const result =
          ctx.user ?
            handlerError.permissionDenied("Schema scope permission denied")
            : handlerError.unauthorized();
        return forjaErrorResponse(result);
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
      default: {
        const result = handlerError.methodNotAllowed(ctx.method);
        return forjaErrorResponse(result);
      }
    }
  } catch (error) {
    // Handle parser errors and other ForjaErrors with rich context
    if (error instanceof ForjaValidationError || error instanceof ForjaError) {
      return forjaErrorResponse({ success: false, error });
    }

    // Generic error handling
    console.error("Unified Handler Error:", error);
    const message =
      error instanceof Error ? error.message : "Internal server error";
    const errResult = handlerError.internalError(
      message,
      error instanceof Error ? error : undefined,
    );
    return forjaErrorResponse(errResult);
  }
}
