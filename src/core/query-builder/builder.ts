/**
 * Query Builder Base Implementation (~150 LOC)
 *
 * Fluent API for building database-agnostic queries.
 * Produces QueryObject instances that adapters translate to SQL/NoSQL.
 */

import type {
  QueryBuilder,
  QueryObject,
  QueryType,
  SelectClause,
  WhereClause,
  PopulateClause,
  OrderByItem,
  OrderDirection
} from './types';
import type { SchemaDefinition } from '@core/schema/types';
import type { Result } from '@utils/types';
import { mergeWhereClauses } from './where';
import { mergePopulateClauses } from './populate';
import { normalizeSelectClause, validateSelectFields } from './select';
import { validateWhereClause } from './where';

/**
 * Query builder error
 */
export class QueryBuilderError extends Error {
  constructor(
    message: string,
    public readonly code: string = 'QUERY_BUILD_ERROR',
    public readonly details?: {
      field?: string;
      value?: unknown;
    }
  ) {
    super(message);
    this.name = 'QueryBuilderError';
  }
}

/**
 * Deep clone an object (safe for JSON-serializable data)
 */
function deepClone<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (obj instanceof Date) {
    return new Date(obj.getTime()) as T;
  }

  if (obj instanceof RegExp) {
    return new RegExp(obj.source, obj.flags) as T;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => deepClone(item)) as T;
  }

  const cloned: Record<string, unknown> = {};
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      cloned[key] = deepClone(obj[key]);
    }
  }

  return cloned as T;
}

/**
 * Mutable query state for building
 */
interface MutableQueryState {
  type?: QueryType;
  table?: string;
  select?: SelectClause;
  where?: WhereClause;
  populate?: PopulateClause;
  orderBy?: OrderByItem[];
  limit?: number;
  offset?: number;
  data?: Record<string, unknown>;
  returning?: SelectClause;
  distinct?: boolean;
  groupBy?: string[];
  having?: WhereClause;
}

/**
 * Query builder implementation
 */
export class ForjaQueryBuilder<TSchema = Record<string, unknown>>
  implements QueryBuilder<TSchema> {
  private query: MutableQueryState = {};
  private readonly _schema: SchemaDefinition | undefined;

  constructor(schema?: SchemaDefinition) {
    this._schema = schema;
  }

  /**
   * Set query type
   */
  type(queryType: QueryType): this {
    this.query.type = queryType;
    return this;
  }

  /**
   * Set table name
   */
  table(name: string): this {
    this.query.table = name;
    return this;
  }

  /**
   * Select fields
   */
  select(fields: SelectClause): this {
    this.query.select = normalizeSelectClause(fields);
    return this;
  }

  /**
   * Add WHERE conditions
   */
  where(conditions: WhereClause): this {
    this.query.where = conditions;
    return this;
  }

  /**
   * Add AND condition
   */
  andWhere(conditions: WhereClause): this {
    const merged = mergeWhereClauses(this.query.where, conditions);
    if (merged !== undefined) {
      this.query.where = merged;
    }
    return this;
  }

  /**
   * Add OR condition
   */
  orWhere(conditions: WhereClause): this {
    const existing = this.query.where || ({} as WhereClause);
    this.query.where = {
      $or: [existing, conditions]
    } as WhereClause;
    return this;
  }

  /**
   * Populate relations
   */
  populate(relations: PopulateClause): this {
    this.query.populate = mergePopulateClauses(this.query.populate, relations);
    return this;
  }

  /**
   * Order by field
   */
  orderBy(field: string, direction: OrderDirection = 'asc'): this {
    const orderByItem: OrderByItem = { field, direction };
    this.query.orderBy = [...(this.query.orderBy || []), orderByItem];
    return this;
  }

  /**
   * Set limit
   */
  limit(count: number): this {
    this.query.limit = count;
    return this;
  }

  /**
   * Set offset
   */
  offset(count: number): this {
    this.query.offset = count;
    return this;
  }

  /**
   * Set data for INSERT/UPDATE
   */
  data(values: Record<string, unknown>): this {
    this.query.data = values;
    return this;
  }

  /**
   * Set returning fields (for INSERT/UPDATE/DELETE)
   */
  returning(fields: SelectClause): this {
    this.query.returning = normalizeSelectClause(fields);
    return this;
  }

  /**
   * Set DISTINCT
   */
  distinct(enabled = true): this {
    this.query.distinct = enabled;
    return this;
  }

  /**
   * Group by fields
   */
  groupBy(fields: readonly string[]): this {
    this.query.groupBy = [...(this.query.groupBy || []), ...fields];
    return this;
  }

  /**
   * Having clause (for GROUP BY)
   */
  having(conditions: WhereClause): this {
    this.query.having = conditions;
    return this;
  }

  /**
   * Build final QueryObject
   */
  build(): Result<QueryObject, QueryBuilderError> {
    // Validate required fields
    if (!this.query.type) {
      return {
        success: false,
        error: new QueryBuilderError('Query type is required')
      };
    }

    if (!this.query.table) {
      return {
        success: false,
        error: new QueryBuilderError('Table name is required')
      };
    }

    const result: QueryObject = {
      type: this.query.type,
      table: this.query.table,
      ...(this.query.select !== undefined && { select: this.query.select }),
      ...(this.query.where !== undefined && { where: this.query.where }),
      ...(this.query.populate !== undefined && { populate: this.query.populate }),
      ...(this.query.orderBy !== undefined && { orderBy: this.query.orderBy as readonly OrderByItem[] }),
      ...(this.query.limit !== undefined && { limit: this.query.limit }),
      ...(this.query.offset !== undefined && { offset: this.query.offset }),
      ...(this.query.data !== undefined && { data: this.query.data }),
      ...(this.query.returning !== undefined && { returning: this.query.returning }),
      ...(this.query.distinct !== undefined && { distinct: this.query.distinct }),
      ...(this.query.groupBy !== undefined && { groupBy: this.query.groupBy as readonly string[] }),
      ...(this.query.having !== undefined && { having: this.query.having })
    };

    // Validate select fields
    if (this._schema && this.query.select) {
      const validation = validateSelectFields(this.query.select, this._schema);
      if (!validation.success) {
        return {
          success: false,
          error: new QueryBuilderError(
            validation.error.message,
            validation.error.code,
            validation.error.details
          )
        };
      }
    }

    // Validate where clause
    if (this._schema && this.query.where) {
      const validation = validateWhereClause(this.query.where, this._schema);
      if (!validation.success) {
        return {
          success: false,
          error: new QueryBuilderError(
            validation.error.message,
            validation.error.code,
            validation.error.details
          )
        };
      }
    }

    // Inject relation metadata if schema and populate are present
    if (this._schema && this.query.populate) {
      const relations: Record<string, unknown> = {};

      for (const relationName of Object.keys(this.query.populate)) {
        const field = this._schema.fields[relationName];

        if (!field) {
          return {
            success: false,
            error: new QueryBuilderError(
              `Relation '${relationName}' not found in schema '${this._schema.name}'`,
              'INVALID_RELATION',
              { field: relationName }
            )
          };
        }

        if (field.type !== 'relation') {
          return {
            success: false,
            error: new QueryBuilderError(
              `Field '${relationName}' is not a relation`,
              'INVALID_RELATION',
              { field: relationName }
            )
          };
        }

        relations[relationName] = {
          model: field.model,
          foreignKey: field.foreignKey,
          kind: field.kind,
          targetTable: field.model.toLowerCase() // Simple convention for now
        };
      }

      if (Object.keys(relations).length > 0) {
        result.meta = {
          ...result.meta,
          relations
        };
      }
    }

    return { success: true, data: result };
  }

  /**
   * Clone builder (for reusability)
   */
  clone(): QueryBuilder<TSchema> {
    const cloned = new ForjaQueryBuilder<TSchema>(this._schema);

    // Deep clone the query state to avoid shared references
    cloned.query = {
      ...this.query,
      // Deep clone nested objects
      ...(this.query.where !== undefined && { where: deepClone(this.query.where) }),
      ...(this.query.populate !== undefined && { populate: deepClone(this.query.populate) }),
      ...(this.query.data !== undefined && { data: deepClone(this.query.data) }),
      ...(this.query.orderBy !== undefined && { orderBy: deepClone(this.query.orderBy) }),
      ...(this.query.groupBy !== undefined && { groupBy: deepClone(this.query.groupBy) }),
      ...(this.query.having !== undefined && { having: deepClone(this.query.having) })
    };

    return cloned;
  }

  /**
   * Reset builder to initial state
   */
  reset(): this {
    this.query = {};
    return this;
  }
}

/**
 * Create a new query builder
 */
export function createQueryBuilder<TSchema = Record<string, unknown>>(
  schema?: SchemaDefinition
): ForjaQueryBuilder<TSchema> {
  return new ForjaQueryBuilder<TSchema>(schema);
}

/**
 * Create SELECT query builder
 */
export function selectFrom<TSchema = Record<string, unknown>>(
  table: string,
  schema?: SchemaDefinition
): ForjaQueryBuilder<TSchema> {
  return createQueryBuilder<TSchema>(schema).type('select').table(table);
}

/**
 * Create INSERT query builder
 */
export function insertInto<TSchema = Record<string, unknown>>(
  table: string,
  data: Record<string, unknown>,
  schema?: SchemaDefinition
): ForjaQueryBuilder<TSchema> {
  return createQueryBuilder<TSchema>(schema)
    .type('insert')
    .table(table)
    .data(data);
}

/**
 * Create UPDATE query builder
 */
export function updateTable<TSchema = Record<string, unknown>>(
  table: string,
  data: Record<string, unknown>,
  schema?: SchemaDefinition
): ForjaQueryBuilder<TSchema> {
  return createQueryBuilder<TSchema>(schema)
    .type('update')
    .table(table)
    .data(data);
}

/**
 * Create DELETE query builder
 */
export function deleteFrom<TSchema = Record<string, unknown>>(
  table: string,
  schema?: SchemaDefinition
): ForjaQueryBuilder<TSchema> {
  return createQueryBuilder<TSchema>(schema).type('delete').table(table);
}

/**
 * Create COUNT query builder
 */
export function countFrom<TSchema = Record<string, unknown>>(
  table: string,
  schema?: SchemaDefinition
): ForjaQueryBuilder<TSchema> {
  return createQueryBuilder<TSchema>(schema).type('count').table(table);
}
