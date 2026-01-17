/**
 * Unified Request Handler
 *
 * SINGLE ENTRY POINT for all API requests
 * Handles authentication, permission checking, and routing
 */

import type { Forja } from 'forja-core';
import type { SchemaDefinition } from 'forja-types/core/schema';
import type { DefaultPermission } from 'forja-types/core/permission';
import type { RequestContext, ContextBuilderOptions } from '../middleware/types';
import { buildRequestContext } from '../middleware/context';
import {
  methodToAction,
  checkSchemaPermission,
  checkFieldsForWrite,
  filterFieldsForRead,
  filterRecordsForRead,
  createPermissionContext,
} from '../middleware/permission';
import { jsonResponse, errorResponse } from './utils';
import { ApiPlugin } from '../api';

/**
 * Handle GET request
 */
async function handleGet(
  context: RequestContext,
  forja: Forja,
  schema: SchemaDefinition,
  defaultPermission?: DefaultPermission
): Promise<Response> {
  try {
    const permCtx = createPermissionContext(
      context.user,
      'read',
      forja,
      undefined,
      undefined
    );

    if (context.id) {
      // findOne by ID
      const result = await forja.findById(context.model!, context.id, {
        select: context.query?.select,
        populate: context.query?.populate,
      });

      if (!result) {
        return errorResponse('Not found', 'NOT_FOUND', 404);
      }

      // Filter fields based on permission
      const { data: filteredResult } = await filterFieldsForRead(
        schema,
        result as Record<string, unknown>,
        permCtx
      );

      return jsonResponse({ data: filteredResult });
    } else {
      // findMany
      const result = await forja.findMany(context.model!, {
        where: context.query?.where,
        select: context.query?.select,
        populate: context.query?.populate,
        orderBy: context.query?.orderBy,
        limit: context.query?.limit,
        offset: context.query?.offset,
      });

      // Get total count
      const total = await forja.count(context.model!, context.query?.where);

      // Filter fields for each record
      const filteredResults = await filterRecordsForRead(
        schema,
        result as Record<string, unknown>[],
        permCtx
      );

      return jsonResponse({
        data: filteredResults,
        meta: {
          total,
          count: filteredResults.length,
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
async function handlePost(
  context: RequestContext,
  forja: Forja,
  schema: SchemaDefinition,
  defaultPermission?: DefaultPermission
): Promise<Response> {
  if (!context.body || typeof context.body !== 'object' || Array.isArray(context.body)) {
    return errorResponse('Invalid request body', 'INVALID_BODY', 400);
  }

  try {
    // Check field-level write permissions
    const permCtx = createPermissionContext(
      context.user,
      'create',
      forja,
      undefined,
      context.body as Record<string, unknown>
    );

    const fieldCheck = await checkFieldsForWrite(
      schema,
      context.body as Record<string, unknown>,
      permCtx
    );

    if (!fieldCheck.allowed) {
      return errorResponse(
        `Permission denied for fields: ${fieldCheck.deniedFields?.join(', ')}`,
        'FIELD_PERMISSION_DENIED',
        403
      );
    }

    const result = await forja.create(context.model!, context.body);

    // Filter response fields
    const { data: filteredResult } = await filterFieldsForRead(
      schema,
      result as Record<string, unknown>,
      permCtx
    );

    return jsonResponse({ data: filteredResult }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    const code = (error as Record<string, unknown>)?.code as string || 'INTERNAL_ERROR';

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
async function handleUpdate(
  context: RequestContext,
  forja: Forja,
  schema: SchemaDefinition,
  defaultPermission?: DefaultPermission
): Promise<Response> {
  if (!context.id) {
    return errorResponse('ID is required for update', 'MISSING_ID', 400);
  }

  if (!context.body || typeof context.body !== 'object' || Array.isArray(context.body)) {
    return errorResponse('Invalid request body', 'INVALID_BODY', 400);
  }

  try {
    // Get existing record for permission context
    const existingRecord = await forja.findById(context.model!, context.id);

    if (!existingRecord) {
      return errorResponse('Not found', 'NOT_FOUND', 404);
    }

    // Check field-level write permissions
    const permCtx = createPermissionContext(
      context.user,
      'update',
      forja,
      existingRecord as Record<string, unknown>,
      context.body as Record<string, unknown>
    );

    const fieldCheck = await checkFieldsForWrite(
      schema,
      context.body as Record<string, unknown>,
      permCtx
    );

    if (!fieldCheck.allowed) {
      return errorResponse(
        `Permission denied for fields: ${fieldCheck.deniedFields?.join(', ')}`,
        'FIELD_PERMISSION_DENIED',
        403
      );
    }

    const result = await forja.update(context.model!, context.id, context.body);

    if (!result) {
      return errorResponse('Not found', 'NOT_FOUND', 404);
    }

    // Filter response fields
    const { data: filteredResult } = await filterFieldsForRead(
      schema,
      result as Record<string, unknown>,
      permCtx
    );

    return jsonResponse({ data: filteredResult });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    const code = (error as Record<string, unknown>)?.code as string || 'INTERNAL_ERROR';

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
async function handleDelete(
  context: RequestContext,
  forja: Forja,
  schema: SchemaDefinition,
  defaultPermission?: DefaultPermission
): Promise<Response> {
  if (!context.id) {
    return errorResponse('ID is required for delete', 'MISSING_ID', 400);
  }

  try {
    const deleted = await forja.delete(context.model!, context.id);

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
 * 2. Check schema-level permission - ONCE
 * 3. Route to method handler (which handles field-level permissions)
 */
export async function handleRequest(
  request: Request,
  forja: Forja,
  api: ApiPlugin<string>,
  options?: ContextBuilderOptions
): Promise<Response> {
  try {
    // 1️⃣ BUILD REQUEST CONTEXT (Single place - auth, parse, extract)
    const context = await buildRequestContext(request, forja, api.authManager, options);

    if (!context.model) {
      return errorResponse('Model not specified', 'MODEL_NOT_SPECIFIED', 400);
    }

    // Check if schema exists
    const schema = forja.getSchema(context.model);
    if (!schema) {
      return errorResponse(
        `Schema '${context.model}' not found`,
        'SCHEMA_NOT_FOUND',
        404
      );
    }

    // 2️⃣ PERMISSION CHECK (Schema-level)
    const action = methodToAction(context.method);

    // Get default permission from API config
    const defaultPermission = api.authDefaultPermission;

    if (api.isAuthEnabled()) {
      const permCtx = createPermissionContext(
        context.user,
        action,
        forja,
        undefined,
        context.body as Record<string, unknown> | undefined
      );

      const permissionResult = await checkSchemaPermission(
        schema,
        action,
        permCtx,
        defaultPermission
      );

      if (!permissionResult.allowed) {
        return errorResponse(
          context.user ? 'Forbidden' : 'Unauthorized',
          context.user ? 'FORBIDDEN' : 'UNAUTHORIZED',
          context.user ? 403 : 401
        );
      }
    }

    api.setUser(context.user);

    // 3️⃣ ROUTE TO METHOD HANDLER
    switch (context.method) {
      case 'GET':
        return handleGet(context, forja, schema, defaultPermission);
      case 'POST':
        return handlePost(context, forja, schema, defaultPermission);
      case 'PATCH':
      case 'PUT':
        return handleUpdate(context, forja, schema, defaultPermission);
      case 'DELETE':
        return handleDelete(context, forja, schema, defaultPermission);
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
