/**
 * API Error System
 *
 * Provides a unified error structure for the API package,
 * extending ForjaError with HTTP status handling and helpful context.
 */

import { ForjaError } from "@forja/core/types/errors";

/**
 * Base API Error Class
 *
 * All API-specific errors should inherit from this class
 * or be created via its static helpers.
 */
export class ForjaApiError extends ForjaError {
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

/**
 * Handler Error Helpers
 *
 * Centralized error creation for routine API handlers.
 */
export const handlerError = {
	schemaNotFound(tableName: string, availableModels?: string[]): ForjaApiError {
		return new ForjaApiError(`Model not found for table: ${tableName}`, {
			code: "SCHEMA_NOT_FOUND",
			status: 404,
			context: { tableName, availableModels },
			suggestion:
				"Check if the table name is correct and the schema is properly defined.",
		});
	},

	modelNotSpecified(): ForjaApiError {
		return new ForjaApiError("Model not specified in the request URL", {
			code: "MODEL_NOT_SPECIFIED",
			status: 400,
			suggestion: "Ensure the URL includes the model name (e.g., /api/users).",
		});
	},

	recordNotFound(modelName: string, id: number | string): ForjaApiError {
		return new ForjaApiError(`${modelName} record not found with ID: ${id}`, {
			code: "NOT_FOUND",
			status: 404,
			context: { modelName, id },
			suggestion: "Verify the ID is correct or if the record has been deleted.",
		});
	},

	invalidBody(reason?: string): ForjaApiError {
		return new ForjaApiError(
			reason ? `Invalid request body: ${reason}` : "Invalid request body",
			{
				code: "INVALID_BODY",
				status: 400,
				context: { reason },
				suggestion:
					"Ensure the request body is a valid JSON object and contains all required fields.",
			},
		);
	},

	missingId(operation: string): ForjaApiError {
		return new ForjaApiError(`ID is required for ${operation}`, {
			code: "MISSING_ID",
			status: 400,
			suggestion: `Provide a valid ID in the URL for the ${operation} operation.`,
		});
	},

	methodNotAllowed(method: string): ForjaApiError {
		return new ForjaApiError(
			`HTTP Method ${method} is not allowed for this route`,
			{
				code: "METHOD_NOT_ALLOWED",
				status: 405,
				context: { method },
				suggestion:
					"Check the API documentation for supported methods on this endpoint.",
			},
		);
	},

	permissionDenied(
		reason: string,
		context?: Record<string, unknown>,
	): ForjaApiError {
		return new ForjaApiError("Permission denied", {
			code: "FORBIDDEN",
			status: 403,
			context: { reason, ...context },
			suggestion: "Check your permissions or contact an administrator.",
		});
	},

	unauthorized(reason?: string): ForjaApiError {
		return new ForjaApiError("Unauthorized access", {
			code: "UNAUTHORIZED",
			status: 401,
			context: { reason },
			suggestion: "Provide valid authentication credentials.",
		});
	},

	internalError(message: string, cause?: Error): ForjaApiError {
		return new ForjaApiError(message, {
			code: "INTERNAL_ERROR",
			status: 500,
			...(cause && { cause }),
		});
	},

	conflict(reason: string, context?: Record<string, unknown>): ForjaApiError {
		return new ForjaApiError(reason, {
			code: "CONFLICT",
			status: 409,
			...(context && { context }),
			suggestion:
				"Ensure the resource you are trying to create does not already exist.",
		});
	},
};
