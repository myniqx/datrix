/**
 * API Error System
 *
 * Provides a unified error structure for the API package,
 * extending ForjaError with HTTP status handling and helpful context.
 */

import { ForjaError } from "forja-types/errors/base";
import type { Result } from "forja-types/utils";

/**
 * Base API Error Class
 *
 * All API-specific errors should inherit from this class
 * or be created via its static helpers.
 */
export class ApiError extends ForjaError {
  /** HTTP status code associated with this error */
  status: number;

  constructor(message: string, options: ApiErrorOptions) {
    super(message, {
      code: options.code,
      operation: options.operation || "api:handler",
      ...(options.context && { context: options.context }),
      ...(options.suggestion && { suggestion: options.suggestion }),
      ...(options.expected && { expected: options.expected }),
      ...(options.received !== undefined && { received: options.received }),
      ...(options.cause && { cause: options.cause }),
    });

    this.status = options.status || 500;
  }

  /**
   * Override toJSON to include status
   */
  override toJSON() {
    return {
      ...super.toJSON(),
      status: this.status,
    };
  }
}

export interface ApiErrorOptions {
  code: string;
  status: number;
  operation?: string;
  context?: Record<string, unknown>;
  suggestion?: string;
  expected?: string;
  received?: unknown;
  cause?: Error;
}

export type ErrorResult<T = never> = Result<T, ApiError | ForjaError>;

/**
 * Handler Error Helpers
 *
 * Centralized error creation for routine API handlers.
 */
export const handlerError = {
  schemaNotFound(tableName: string, availableModels?: string[]): ErrorResult {
    return {
      success: false,
      error: new ApiError(`Model not found for table: ${tableName}`, {
        code: "SCHEMA_NOT_FOUND",
        status: 404,
        context: { tableName, availableModels },
        suggestion:
          "Check if the table name is correct and the schema is properly defined.",
      }),
    };
  },

  modelNotSpecified(): ErrorResult {
    return {
      success: false,
      error: new ApiError("Model not specified in the request URL", {
        code: "MODEL_NOT_SPECIFIED",
        status: 400,
        suggestion: "Ensure the URL includes the model name (e.g., /api/users).",
      }),
    };
  },

  recordNotFound(modelName: string, id: string): ErrorResult {
    return {
      success: false,
      error: new ApiError(`${modelName} record not found with ID: ${id}`, {
        code: "NOT_FOUND",
        status: 404,
        context: { modelName, id },
        suggestion: "Verify the ID is correct or if the record has been deleted.",
      }),
    };
  },

  invalidBody(reason?: string): ErrorResult {
    return {
      success: false,
      error: new ApiError(
        reason ? `Invalid request body: ${reason}` : "Invalid request body",
        {
          code: "INVALID_BODY",
          status: 400,
          context: { reason },
          suggestion:
            "Ensure the request body is a valid JSON object and contains all required fields.",
        },
      ),
    };
  },

  missingId(operation: string): ErrorResult {
    return {
      success: false,
      error: new ApiError(`ID is required for ${operation}`, {
        code: "MISSING_ID",
        status: 400,
        suggestion: `Provide a valid ID in the URL for the ${operation} operation.`,
      }),
    };
  },

  methodNotAllowed(method: string): ErrorResult {
    return {
      success: false,
      error: new ApiError(`HTTP Method ${method} is not allowed for this route`, {
        code: "METHOD_NOT_ALLOWED",
        status: 405,
        context: { method },
        suggestion:
          "Check the API documentation for supported methods on this endpoint.",
      }),
    };
  },

  permissionDenied(
    reason: string,
    context?: Record<string, unknown>,
  ): ErrorResult {
    return {
      success: false,
      error: new ApiError("Permission denied", {
        code: "FORBIDDEN",
        status: 403,
        context: { reason, ...context },
        suggestion: "Check your permissions or contact an administrator.",
      }),
    };
  },

  unauthorized(reason?: string): ErrorResult {
    return {
      success: false,
      error: new ApiError("Unauthorized access", {
        code: "UNAUTHORIZED",
        status: 401,
        context: { reason },
        suggestion: "Provide valid authentication credentials.",
      }),
    };
  },

  internalError(message: string, cause?: Error): ErrorResult {
    return {
      success: false,
      error: new ApiError(message, {
        code: "INTERNAL_ERROR",
        status: 500,
        ...(cause && { cause }),
      }),
    };
  },

  conflict(reason: string, context?: Record<string, unknown>): ErrorResult {
    return {
      success: false,
      error: new ApiError(reason, {
        code: "CONFLICT",
        status: 409,
        ...(context && { context }),
        suggestion:
          "Ensure the resource you are trying to create does not already exist.",
      }),
    };
  },
};
