/**
 * Unified Request Handler
 *
 * SINGLE ENTRY POINT for all API requests
 * Handles authentication, permission checking, and routing
 */

import type { Forja } from 'forja-core';
import type { AuthManager } from '../auth/manager';
import type { RequestContext, ContextBuilderOptions } from '../middleware/types';
import { buildRequestContext, checkPermission, methodToAction } from '../middleware';
import { jsonResponse, errorResponse } from './utils';
import { ApiPlugin } from '../api';

/**
 * Handle GET request
 */
async function handleGet(context: RequestContext, forja: Forja): Promise<Response> {
  if (!context.model) {
    return errorResponse('Model not specified', 'MODEL_NOT_SPECIFIED', 400);
  }

  try {
    if (context.id) {
      // findOne by ID
      const result = await forja.findById(context.model, context.id, {
        select: context.query?.select,
        populate: context.query?.populate,
      });

      if (!result) {
        return errorResponse('Not found', 'NOT_FOUND', 404);
      }

      return jsonResponse({ data: result });
    } else {
      // findMany
      const result = await forja.findMany(context.model, {
        where: context.query?.where,
        select: context.query?.select,
        populate: context.query?.populate,
        orderBy: context.query?.orderBy,
        limit: context.query?.limit,
        offset: context.query?.offset,
      });

      // Get total count
      const total = await forja.count(context.model, context.query?.where);

      return jsonResponse({
        data: result,
        meta: {
          total,
          count: Array.isArray(result) ? result.length : 0,
          limit: context.query?.limit,
          offset: context.query?.offset,
        },
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return errorResponse(message, 'INTERNAL_ERROR', 500);
  }
}

/**
 * Handle POST request
 */
async function handlePost(context: RequestContext, forja: Forja): Promise<Response> {
  if (!context.model) {
    return errorResponse('Model not specified', 'MODEL_NOT_SPECIFIED', 400);
  }

  if (!context.body || typeof context.body !== 'object' || Array.isArray(context.body)) {
    return errorResponse('Invalid request body', 'INVALID_BODY', 400);
  }

  try {
    const result = await forja.create(context.model, context.body);
    return jsonResponse({ data: result }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    const code = (error as any)?.code || 'INTERNAL_ERROR';

    // Validation and constraint errors should return 400
    if (
      code === 'VALIDATION_FAILED' ||
      message.toLowerCase().includes('duplicate') ||
      message.toLowerCase().includes('unique')
    ) {
      return errorResponse(message, code, 400);
    }

    return errorResponse(message, code, 500);
  }
}

/**
 * Handle PATCH/PUT request (update)
 */
async function handleUpdate(context: RequestContext, forja: Forja): Promise<Response> {
  if (!context.model) {
    return errorResponse('Model not specified', 'MODEL_NOT_SPECIFIED', 400);
  }

  if (!context.id) {
    return errorResponse('ID is required for update', 'MISSING_ID', 400);
  }

  if (!context.body || typeof context.body !== 'object' || Array.isArray(context.body)) {
    return errorResponse('Invalid request body', 'INVALID_BODY', 400);
  }

  try {
    const result = await forja.update(context.model, context.id, context.body);

    if (!result) {
      return errorResponse('Not found', 'NOT_FOUND', 404);
    }

    return jsonResponse({ data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    const code = (error as any)?.code || 'INTERNAL_ERROR';

    // Validation and constraint errors should return 400
    if (
      code === 'VALIDATION_FAILED' ||
      message.toLowerCase().includes('duplicate') ||
      message.toLowerCase().includes('unique')
    ) {
      return errorResponse(message, code, 400);
    }

    return errorResponse(message, code, 500);
  }
}

/**
 * Handle DELETE request
 */
async function handleDelete(context: RequestContext, forja: Forja): Promise<Response> {
  if (!context.model) {
    return errorResponse('Model not specified', 'MODEL_NOT_SPECIFIED', 400);
  }

  if (!context.id) {
    return errorResponse('ID is required for delete', 'MISSING_ID', 400);
  }

  try {
    const deleted = await forja.delete(context.model, context.id);

    if (!deleted) {
      return errorResponse('Not found', 'NOT_FOUND', 404);
    }

    return jsonResponse({ data: { id: context.id, deleted: true } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return errorResponse(message, 'INTERNAL_ERROR', 500);
  }
}

/**
 * Unified Request Handler
 *
 * Main entry point - handles all HTTP methods
 *
 * Flow:
 * 1. Build context (auth, parse URL, parse query/body) - ONCE
 * 2. Check permission (RBAC) - ONCE
 * 3. Route to method handler
 */
export async function handleRequest(
  request: Request,
  forja: Forja,
  api: ApiPlugin,
  options?: ContextBuilderOptions
): Promise<Response> {
  try {
    // 1️⃣ BUILD REQUEST CONTEXT (Single place - auth, parse, extract)
    const context = await buildRequestContext(request, forja, api.authManager, options);

    if (!context.model) {
      return errorResponse('Model not specified', 'MODEL_NOT_SPECIFIED', 400);
    }

    // Check if schema exists
    if (!forja.hasSchema(context.model)) {
      return errorResponse(
        `Schema '${context.model}' not found`,
        'SCHEMA_NOT_FOUND',
        404
      );
    }

    // 2️⃣ PERMISSION CHECK (Single place - RBAC)
    const action = methodToAction(context.method);
    const allowed = await checkPermission(
      context.user,
      context.model,
      action,
      api.authManager
    );

    if (!allowed) {
      return errorResponse(
        context.user ? 'Forbidden' : 'Unauthorized',
        context.user ? 'FORBIDDEN' : 'UNAUTHORIZED',
        context.user ? 403 : 401
      );
    }

    api.setUser(context.user);

    // 3️⃣ ROUTE TO METHOD HANDLER
    switch (context.method) {
      case 'GET':
        return handleGet(context, forja);
      case 'POST':
        return handlePost(context, forja);
      case 'PATCH':
      case 'PUT':
        return handleUpdate(context, forja);
      case 'DELETE':
        return handleDelete(context, forja);
      default:
        return errorResponse(
          `Method ${context.method} not allowed`,
          'METHOD_NOT_ALLOWED',
          405
        );
    }
  } catch (error) {
    console.error('Unified Handler Error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return errorResponse(message, 'INTERNAL_ERROR', 500);
  }
}
