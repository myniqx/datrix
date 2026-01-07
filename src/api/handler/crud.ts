/**
 * CRUD Operations
 *
 * Implements findMany, findOne, create, update, delete operations.
 * Uses query builder and database adapter.
 */

import type {
  RequestContext,
  HandlerResponse,
  HandlerConfig,
  ResponseMeta
} from './types';
import { parseQuery } from '@api/parser/query-parser';
import { createQueryBuilder } from '@core/query-builder/builder';
import { validateSchema, validatePartial } from '@core/validator/schema-validator';

/**
 * Find many records
 */
export async function findMany<TUser = unknown>(
  context: RequestContext<TUser>,
  config: HandlerConfig<TUser>
): Promise<HandlerResponse> {
  try {
    // Parse query parameters
    const parseResult = parseQuery(context.query, config.options);

    if (!parseResult.success) {
      return createErrorResponse(400, parseResult.error.message, 'INVALID_QUERY');
    }

    let parsedQuery = parseResult.data;

    // Run beforeFind hook
    if (config.hooks?.beforeFind) {
      parsedQuery = await config.hooks.beforeFind(context, parsedQuery);
    }

    // Build query
    const queryBuilder = createQueryBuilder(config.schema)
      .type('select')
      .table(config.schema.tableName ?? config.schema.name);

    if (parsedQuery.select) {
      queryBuilder.select(parsedQuery.select);
    }

    if (parsedQuery.where) {
      queryBuilder.where(parsedQuery.where);
    }

    if (parsedQuery.populate) {
      queryBuilder.populate(parsedQuery.populate);
    }

    if (parsedQuery.orderBy) {
      for (const order of parsedQuery.orderBy) {
        queryBuilder.orderBy(order.field, order.direction);
      }
    }

    if (parsedQuery.limit !== undefined) {
      queryBuilder.limit(parsedQuery.limit);
    }

    if (parsedQuery.offset !== undefined) {
      queryBuilder.offset(parsedQuery.offset);
    }

    const queryResult = queryBuilder.build();
    if (!queryResult.success) {
      return createErrorResponse(500, queryResult.error.message, 'QUERY_BUILD_ERROR');
    }

    // Execute query
    const executeResult = await config.adapter.executeQuery<Record<string, unknown>>(
      queryResult.data
    );

    if (!executeResult.success) {
      return createErrorResponse(500, executeResult.error.message, 'QUERY_ERROR');
    }

    const results = executeResult.data.rows;

    // Get total count for pagination
    let total: number | undefined;
    if (parsedQuery.limit !== undefined) {
      const countBuilder = createQueryBuilder(config.schema)
        .type('count')
        .table(config.schema.tableName ?? config.schema.name);

      if (parsedQuery.where) {
        countBuilder.where(parsedQuery.where);
      }

      const countResult = countBuilder.build();
      if (countResult.success) {
        const countExecuteResult = await config.adapter.executeQuery<{ count: number }>(
          countResult.data
        );
        if (countExecuteResult.success && countExecuteResult.data.rows.length > 0) {
          const countRow = countExecuteResult.data.rows[0];
          if (countRow && typeof countRow === 'object' && 'count' in countRow) {
            total = countRow.count as number;
          }
        }
      }
    }

    // Run afterFind hook
    let data: readonly Record<string, unknown>[] = results;
    if (config.hooks?.afterFind) {
      const hookResult = await config.hooks.afterFind(context, results);
      // Hook can modify the results, but we need to ensure it returns the same type
      if (Array.isArray(hookResult)) {
        // Validate that all items are records (not nested arrays)
        const isValidArray = hookResult.every((item) =>
          typeof item === 'object' && item !== null && !Array.isArray(item)
        );
        if (isValidArray) {
          // Create a new array to satisfy type requirements
          // We've verified all items are non-array objects through the type guard above
          data = hookResult.map((item) => item as Record<string, unknown>);
        }
      }
    }

    // Build response
    const responseBody: { data: unknown; meta?: ResponseMeta } = { data };

    if (total !== undefined && parsedQuery.page !== undefined && parsedQuery.pageSize !== undefined) {
      responseBody.meta = {
        pagination: {
          page: parsedQuery.page,
          pageSize: parsedQuery.pageSize,
          total,
          pageCount: Math.ceil(total / parsedQuery.pageSize)
        }
      };
    }

    const response: HandlerResponse = {
      status: 200,
      body: responseBody
    };

    return response;
  } catch (error) {
    return createErrorResponse(
      500,
      error instanceof Error ? error.message : 'Internal server error',
      'INTERNAL_ERROR'
    );
  }
}

/**
 * Find one record by ID
 */
export async function findOne<TUser = unknown>(
  context: RequestContext<TUser>,
  config: HandlerConfig<TUser>
): Promise<HandlerResponse> {
  try {
    const id = context.params['id'];

    if (!id) {
      return createErrorResponse(400, 'ID parameter is required', 'MISSING_ID');
    }

    // Parse query parameters (for populate, fields)
    const parseResult = parseQuery(context.query, config.options);

    if (!parseResult.success) {
      return createErrorResponse(400, parseResult.error.message, 'INVALID_QUERY');
    }

    const parsedQuery = parseResult.data;

    // Build query
    const queryBuilder = createQueryBuilder(config.schema)
      .type('select')
      .table(config.schema.tableName ?? config.schema.name)
      .where({ id })
      .limit(1);

    if (parsedQuery.select) {
      queryBuilder.select(parsedQuery.select);
    }

    if (parsedQuery.populate) {
      queryBuilder.populate(parsedQuery.populate);
    }

    const queryResult = queryBuilder.build();
    if (!queryResult.success) {
      return createErrorResponse(500, queryResult.error.message, 'QUERY_BUILD_ERROR');
    }

    // Execute query
    const executeResult = await config.adapter.executeQuery<Record<string, unknown>>(
      queryResult.data
    );

    if (!executeResult.success) {
      return createErrorResponse(500, executeResult.error.message, 'QUERY_ERROR');
    }

    const results = executeResult.data.rows;

    if (!results || results.length === 0) {
      return createErrorResponse(404, 'Record not found', 'NOT_FOUND');
    }

    const firstResult = results[0];
    if (!firstResult || typeof firstResult !== 'object' || Array.isArray(firstResult)) {
      return createErrorResponse(500, 'Invalid result from database', 'INVALID_RESULT');
    }

    let data: Record<string, unknown> = { ...firstResult };

    // Run afterFind hook
    if (config.hooks?.afterFind) {
      const hookResult = await config.hooks.afterFind(context, data);
      // Hook can modify the result, but we need to ensure it returns a single record
      if (hookResult && typeof hookResult === 'object' && !Array.isArray(hookResult)) {
        data = hookResult;
      }
    }

    return {
      status: 200,
      body: { data }
    };
  } catch (error) {
    return createErrorResponse(
      500,
      error instanceof Error ? error.message : 'Internal server error',
      'INTERNAL_ERROR'
    );
  }
}

/**
 * Create a new record
 */
export async function create<TUser = unknown>(
  context: RequestContext<TUser>,
  config: HandlerConfig<TUser>
): Promise<HandlerResponse> {
  try {
    // Validate body
    if (!context.body || typeof context.body !== 'object' || Array.isArray(context.body)) {
      return createErrorResponse(400, 'Invalid request body', 'INVALID_BODY');
    }

    let data = context.body as Record<string, unknown>;

    // Run beforeCreate hook
    if (config.hooks?.beforeCreate) {
      data = await config.hooks.beforeCreate(context, data);
    }

    // Validate against schema
    const validationResult = validateSchema(data, config.schema);
    if (!validationResult.success) {
      return createErrorResponse(
        400,
        'Validation failed',
        'VALIDATION_ERROR',
        validationResult.error
      );
    }

    // Build insert query
    const queryBuilder = createQueryBuilder(config.schema)
      .type('insert')
      .table(config.schema.tableName ?? config.schema.name)
      .data(validationResult.data)
      .returning('*');

    const queryResult = queryBuilder.build();
    if (!queryResult.success) {
      return createErrorResponse(500, queryResult.error.message, 'QUERY_BUILD_ERROR');
    }

    // Execute query
    const executeResult = await config.adapter.executeQuery<Record<string, unknown>>(
      queryResult.data
    );

    if (!executeResult.success) {
      return createErrorResponse(500, executeResult.error.message, 'QUERY_ERROR');
    }

    const resultRows = executeResult.data.rows;
    if (!resultRows || resultRows.length === 0) {
      return createErrorResponse(500, 'No data returned from insert', 'QUERY_ERROR');
    }

    let createdData = resultRows[0] as Record<string, unknown>;

    // Run afterCreate hook
    if (config.hooks?.afterCreate) {
      const hookResult = await config.hooks.afterCreate(context, createdData);
      if (hookResult && typeof hookResult === 'object' && !Array.isArray(hookResult)) {
        createdData = hookResult as Record<string, unknown>;
      }
    }

    return {
      status: 201,
      body: { data: createdData }
    };
  } catch (error) {
    return createErrorResponse(
      500,
      error instanceof Error ? error.message : 'Internal server error',
      'INTERNAL_ERROR'
    );
  }
}

/**
 * Update a record by ID
 */
export async function update<TUser = unknown>(
  context: RequestContext<TUser>,
  config: HandlerConfig<TUser>
): Promise<HandlerResponse> {
  try {
    const id = context.params['id'];

    if (!id) {
      return createErrorResponse(400, 'ID parameter is required', 'MISSING_ID');
    }

    // Validate body
    if (!context.body || typeof context.body !== 'object' || Array.isArray(context.body)) {
      return createErrorResponse(400, 'Invalid request body', 'INVALID_BODY');
    }

    let data = context.body as Record<string, unknown>;

    // Run beforeUpdate hook
    if (config.hooks?.beforeUpdate) {
      data = await config.hooks.beforeUpdate(context, id, data);
    }

    // Validate against schema (partial validation for update)
    const validationResult = validatePartial(data, config.schema);
    if (!validationResult.success) {
      return createErrorResponse(
        400,
        'Validation failed',
        'VALIDATION_ERROR',
        validationResult.error
      );
    }

    // Build update query
    const queryBuilder = createQueryBuilder(config.schema)
      .type('update')
      .table(config.schema.tableName ?? config.schema.name)
      .where({ id })
      .data(validationResult.data)
      .returning('*');

    const queryResult = queryBuilder.build();
    if (!queryResult.success) {
      return createErrorResponse(500, queryResult.error.message, 'QUERY_BUILD_ERROR');
    }

    // Execute query
    const executeResult = await config.adapter.executeQuery<Record<string, unknown>>(
      queryResult.data
    );

    if (!executeResult.success) {
      return createErrorResponse(500, executeResult.error.message, 'QUERY_ERROR');
    }

    const resultRows = executeResult.data.rows;
    if (!resultRows || resultRows.length === 0) {
      return createErrorResponse(404, 'Record not found', 'NOT_FOUND');
    }

    let updatedData = resultRows[0] as Record<string, unknown>;

    // Run afterUpdate hook
    if (config.hooks?.afterUpdate) {
      const hookResult = await config.hooks.afterUpdate(context, updatedData);
      if (hookResult && typeof hookResult === 'object' && !Array.isArray(hookResult)) {
        updatedData = hookResult as Record<string, unknown>;
      }
    }

    return {
      status: 200,
      body: { data: updatedData }
    };
  } catch (error) {
    return createErrorResponse(
      500,
      error instanceof Error ? error.message : 'Internal server error',
      'INTERNAL_ERROR'
    );
  }
}

/**
 * Delete a record by ID
 */
export async function deleteRecord<TUser = unknown>(
  context: RequestContext<TUser>,
  config: HandlerConfig<TUser>
): Promise<HandlerResponse> {
  try {
    const id = context.params['id'];

    if (!id) {
      return createErrorResponse(400, 'ID parameter is required', 'MISSING_ID');
    }

    // Run beforeDelete hook
    if (config.hooks?.beforeDelete) {
      await config.hooks.beforeDelete(context, id);
    }

    // Build delete query
    const queryBuilder = createQueryBuilder(config.schema)
      .type('delete')
      .table(config.schema.tableName ?? config.schema.name)
      .where({ id })
      .returning('*');

    const queryResult = queryBuilder.build();
    if (!queryResult.success) {
      return createErrorResponse(500, queryResult.error.message, 'QUERY_BUILD_ERROR');
    }

    // Execute query
    const executeResult = await config.adapter.executeQuery<Record<string, unknown>>(
      queryResult.data
    );

    if (!executeResult.success) {
      return createErrorResponse(500, executeResult.error.message, 'QUERY_ERROR');
    }

    const resultRows = executeResult.data.rows;
    if (!resultRows || resultRows.length === 0) {
      return createErrorResponse(404, 'Record not found', 'NOT_FOUND');
    }

    const result = resultRows[0] as Record<string, unknown>;

    // Run afterDelete hook
    if (config.hooks?.afterDelete) {
      await config.hooks.afterDelete(context, id);
    }

    return {
      status: 200,
      body: { data: result }
    };
  } catch (error) {
    return createErrorResponse(
      500,
      error instanceof Error ? error.message : 'Internal server error',
      'INTERNAL_ERROR'
    );
  }
}

/**
 * Count records
 */
export async function count<TUser = unknown>(
  context: RequestContext<TUser>,
  config: HandlerConfig<TUser>
): Promise<HandlerResponse> {
  try {
    // Parse query parameters
    const parseResult = parseQuery(context.query);

    if (!parseResult.success) {
      return createErrorResponse(400, parseResult.error.message, 'INVALID_QUERY');
    }

    const parsedQuery = parseResult.data;

    // Build count query
    const queryBuilder = createQueryBuilder(config.schema)
      .type('count')
      .table(config.schema.tableName ?? config.schema.name);

    if (parsedQuery.where) {
      queryBuilder.where(parsedQuery.where);
    }

    const queryResult = queryBuilder.build();
    if (!queryResult.success) {
      return createErrorResponse(500, queryResult.error.message, 'QUERY_BUILD_ERROR');
    }

    // Execute query
    const executeResult = await config.adapter.executeQuery<{ count: number }>(
      queryResult.data
    );

    if (!executeResult.success) {
      return createErrorResponse(500, executeResult.error.message, 'QUERY_ERROR');
    }

    const resultRows = executeResult.data.rows;
    const count = resultRows.length > 0 && resultRows[0] && typeof resultRows[0] === 'object' && 'count' in resultRows[0]
      ? (resultRows[0].count as number)
      : 0;

    return {
      status: 200,
      body: { data: { count } }
    };
  } catch (error) {
    return createErrorResponse(
      500,
      error instanceof Error ? error.message : 'Internal server error',
      'INTERNAL_ERROR'
    );
  }
}

/**
 * Create error response
 */
function createErrorResponse(
  status: number,
  message: string,
  code: string,
  details?: unknown
): HandlerResponse {
  return {
    status,
    body: {
      error: {
        message,
        code,
        ...(details !== undefined && { details })
      }
    }
  };
}
