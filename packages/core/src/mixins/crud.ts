/**
 * CRUD Operations Mixin
 *
 * Provides database CRUD (Create, Read, Update, Delete) operations.
 * This class encapsulates all data manipulation logic.
 */

import { DatabaseAdapter } from "forja-types/adapter";
import {
  SchemaRegistry,
  SchemaDefinition,
  RESERVED_FIELDS,
  ForjaEntry,
  RelationField,
  RelationInput,
} from "forja-types/core/schema";
import {
  QueryObject,
  WhereClause,
  SelectClause,
  PopulateClause,
} from "forja-types/core/query-builder";
import { QueryAction } from "forja-types/plugin";
import { ForjaError } from "../forja";
import { Dispatcher } from "../dispatcher";
import { validateSchema, validatePartial } from "../validator";
import { IRawCrud } from "forja-types/forja";
import { ParsedQuery } from "forja-types";

/**
 * CRUD Operations Class
 *
 * Handles all database CRUD operations with type-safe query building.
 * Implements IRawCrud interface.
 */
export class CrudOperations implements IRawCrud {
  constructor(
    private readonly schemas: SchemaRegistry,
    private readonly getAdapter: () => DatabaseAdapter,
    private readonly getDispatcher: (() => Dispatcher) | null = null,
  ) { }

  /**
   * Execute a query with optional plugin hooks
   *
   * If getDispatcher is null (raw mode), executes directly without hooks.
   * Otherwise, runs through the full plugin lifecycle (onBeforeQuery, onAfterQuery).
   *
   * @param action - Query action type
   * @param model - Model name
   * @param table - Table name
   * @param query - Query object
   * @param handler - Function that executes the actual database query
   * @returns Query result
   */
  private async execute<T>(
    action: QueryAction,
    model: string,
    table: string,
    query: QueryObject,
    handler: (q: QueryObject) => Promise<T>,
  ): Promise<T> {
    if (!this.getDispatcher) {
      return handler(query);
    }
    return this.getDispatcher().executeQuery(
      action,
      model,
      table,
      query,
      handler,
    );
  }

  /**
   * Find one record by criteria
   *
   * @param model - Model name (e.g., 'User')
   * @param where - Filter criteria
   * @param options - Query options (select, populate)
   * @returns Record or null if not found
   *
   * @example
   * ```ts
   * const user = await crud.findOne('User', { email: 'test@example.com' });
   * const post = await crud.findOne('Post', { slug: 'hello-world' }, {
   *   populate: { author: { select: ['name', 'email'] } }
   * });
   * ```
   */
  async findOne<T extends ForjaEntry = ForjaEntry>(
    model: string,
    where: WhereClause,
    options?: Pick<ParsedQuery, "select" | "populate">,
  ): Promise<T | null> {
    const { tableName } = this.getSchema(model);
    const query: QueryObject = {
      type: "select",
      table: tableName!,
      where,
      select: this.processSelect(model, options?.select),
      populate: this.processPopulate(model, options?.populate),
      limit: 1,
    };

    return this.execute<T | null>(
      "findOne",
      model,
      tableName!,
      query,
      async (q) => {
        const result = await this.getAdapter().executeQuery<T>(q);
        if (!result.success) {
          throw new ForjaError(
            `Failed to find ${model}: ${result.error.message}`,
            "QUERY_FAILED",
          );
        }
        return result.data.rows[0] ?? null;
      },
    );
  }

  /**
   * Find one record by ID
   *
   * @param model - Model name
   * @param id - Record ID
   * @param options - Query options
   * @returns Record or null
   *
   * @example
   * ```ts
   * const user = await crud.findById('User', '123');
   * ```
   */
  async findById<T extends ForjaEntry = ForjaEntry>(
    model: string,
    id: string | number,
    options?: Pick<ParsedQuery, "select" | "populate">,
  ): Promise<T | null> {
    return this.findOne<T>(model, { id }, options);
  }

  /**
   * Find multiple records
   *
   * @param model - Model name
   * @param options - Query options
   * @returns Array of records
   *
   * @example
   * ```ts
   * const users = await crud.findMany('User', {
   *   where: { role: 'admin' },
   *   limit: 10,
   *   orderBy: [{ field: 'createdAt', direction: 'desc' }]
   * });
   * ```
   */
  async findMany<T extends ForjaEntry = ForjaEntry>(
    model: string,
    options?: Pick<
      ParsedQuery,
      "where" | "select" | "populate" | "orderBy" | "limit" | "offset"
    >,
  ): Promise<T[]> {
    const { tableName } = this.getSchema(model);
    const query: QueryObject = {
      type: "select",
      table: tableName!,
      where: options?.where,
      select: this.processSelect(model, options?.select),
      populate: this.processPopulate(model, options?.populate),
      orderBy: options?.orderBy,
      limit: options?.limit,
      offset: options?.offset,
    };

    return this.execute<T[]>("findMany", model, tableName!, query, async (q) => {
      const result = await this.getAdapter().executeQuery<T>(q);
      if (!result.success) {
        throw new ForjaError(
          `Failed to find ${model}: ${result.error.message}`,
          "QUERY_FAILED",
        );
      }
      return result.data.rows as T[];
    });
  }

  /**
   * Count records
   *
   * @param model - Model name
   * @param where - Filter criteria
   * @returns Number of matching records
   *
   * @example
   * ```ts
   * const totalUsers = await crud.count('User');
   * const adminCount = await crud.count('User', { role: 'admin' });
   * ```
   */
  async count(model: string, where?: WhereClause): Promise<number> {
    const { tableName } = this.getSchema(model);
    const query: QueryObject = {
      type: "count",
      table: tableName!,
      where,
    };

    return this.execute<number>("count", model, tableName!, query, async (q) => {
      const result = await this.getAdapter().executeQuery<{ count: number }>(q);
      if (!result.success) {
        throw new ForjaError(
          `Failed to count ${model}: ${result.error.message}`,
          "QUERY_FAILED",
        );
      }
      return result.data.rows[0]?.count ?? 0;
    });
  }

  /**
   * Create a new record
   *
   * @param model - Model name
   * @param data - Record data
   * @returns Created record
   *
   * @example
   * ```ts
   * const user = await crud.create('User', {
   *   email: 'john@example.com',
   *   name: 'John Doe',
   *   role: 'user'
   * });
   * ```
   */
  async create<T extends ForjaEntry = ForjaEntry>(
    model: string,
    data: Record<string, unknown>,
    options?: Pick<ParsedQuery, "select" | "populate">,
  ): Promise<T> {
    const schema = this.getSchema(model);

    // Separate scalar fields from relations
    const { scalars, relations } = this.separateRelations(data, schema);

    // Validate scalar data against schema (full validation, timestamps added inside)
    const finalData = this.validateData<T, false>(
      model,
      scalars,
      schema,
      false,
      true,
    );

    // INSERT query - adapter returns insertedId
    const query: QueryObject = {
      type: "insert",
      table: schema.tableName!,
      data: finalData,
      // Don't use returning - adapters should return insertedId in metadata
    };

    const insertedId = await this.execute<number | string>(
      "create",
      model,
      schema.tableName!,
      query,
      async (q) => {
        const result = await this.getAdapter().executeQuery<T>(q);
        if (!result.success) {
          throw new ForjaError(
            `Failed to create ${model}: ${result.error.message}`,
            "QUERY_FAILED",
          );
        }
        // Get insertedId from result (standardized across adapters)
        return result.data.metadata?.insertId ?? result.data.rows?.[0]?.id!;
      },
    );

    // Process relations (connect/disconnect/set)
    for (const [fieldName, relationData] of Object.entries(relations)) {
      await this.processRelation(
        model,
        insertedId,
        fieldName,
        relationData,
        schema,
      );
    }

    // Fetch created record with options applied (process select and populate)
    const fetchOptions =
      options ?
        {
          select: this.processSelect(model, options.select),
          populate: this.processPopulate(model, options.populate),
        }
        : undefined;

    return (await this.findById<T>(model, insertedId, fetchOptions))!;
  }

  /**
   * Update a record by ID
   *
   * @param model - Model name
   * @param id - Record ID
   * @param data - Updated data
   * @returns Updated record
   *
   * @example
   * ```ts
   * const user = await crud.update('User', '123', {
   *   name: 'Jane Doe'
   * });
   * ```
   */
  async update<T extends ForjaEntry = ForjaEntry>(
    model: string,
    id: string | number,
    data: Record<string, unknown>,
    options?: Pick<ParsedQuery, "select" | "populate">,
  ): Promise<T> {
    const schema = this.getSchema(model);

    // Separate scalar fields from relations
    const { scalars, relations } = this.separateRelations(data, schema);

    // Validate scalar data against schema (partial validation, timestamps added inside)
    const finalData = this.validateData<T, true>(
      model,
      scalars,
      schema,
      true,
      false,
    );

    // UPDATE query (only if there are scalar fields to update)
    if (Object.keys(finalData).length > 0) {
      const query: QueryObject = {
        type: "update",
        table: schema.tableName!,
        where: { id },
        data: finalData,
      };

      await this.execute<void>(
        "update",
        model,
        schema.tableName!,
        query,
        async (q) => {
          const result = await this.getAdapter().executeQuery<T>(q);
          if (!result.success) {
            throw new ForjaError(
              `Failed to update ${model}: ${result.error.message}`,
              "QUERY_FAILED",
            );
          }
        },
      );
    }

    // Process relations (connect/disconnect/set)
    for (const [fieldName, relationData] of Object.entries(relations)) {
      await this.processRelation(model, id, fieldName, relationData, schema);
    }

    // Fetch updated record with options applied (process select and populate)
    const fetchOptions =
      options ?
        {
          select: this.processSelect(model, options.select),
          populate: this.processPopulate(model, options.populate),
        }
        : undefined;

    return (await this.findById<T>(model, id, fetchOptions))!;
  }

  /**
   * Update multiple records
   *
   * @param model - Model name
   * @param where - Filter criteria
   * @param data - Updated data
   * @returns Number of updated records
   *
   * @example
   * ```ts
   * const count = await crud.updateMany('User',
   *   { role: 'user' },
   *   { verified: true }
   * );
   * ```
   */
  async updateMany(
    model: string,
    where: WhereClause,
    data: Record<string, unknown>,
  ): Promise<number> {
    const schema = this.getSchema(model);

    // Validate data against schema (partial validation, timestamps added inside)
    const finalData = this.validateData<ForjaEntry, true>(
      model,
      data,
      schema,
      true,
      false,
    );

    const query: QueryObject = {
      type: "update",
      table: schema.tableName!,
      where,
      data: finalData,
    };

    return this.execute<number>(
      "updateMany",
      model,
      schema.tableName!,
      query,
      async (q) => {
        const result = await this.getAdapter().executeQuery<{ count: number }>(q);
        if (!result.success) {
          throw new ForjaError(
            `Failed to update ${model}: ${result.error.message}`,
            "QUERY_FAILED",
          );
        }
        return result.data.metadata.rowCount ?? 0;
      },
    );
  }

  /**
   * Delete a record by ID
   *
   * @param model - Model name
   * @param id - Record ID
   * @returns True if deleted
   *
   * @example
   * ```ts
   * const deleted = await crud.delete('User', '123');
   * ```
   */
  async delete(
    model: string,
    id: string | number,
    options?: Pick<ParsedQuery, "select" | "populate">,
  ): Promise<boolean> {
    const { tableName } = this.getSchema(model);

    // If options provided, fetch record before deleting
    // (to return it with select/populate applied)
    if (options) {
      await this.findById(model, id, options);
    }

    // DELETE query
    const query: QueryObject = {
      type: "delete",
      table: tableName!,
      where: { id },
    };

    return this.execute<boolean>(
      "delete",
      model,
      tableName!,
      query,
      async (q) => {
        const result = await this.getAdapter().executeQuery<unknown>(q);
        if (!result.success) {
          throw new ForjaError(
            `Failed to delete ${model}: ${result.error.message}`,
            "QUERY_FAILED",
          );
        }
        return (result.data.metadata.rowCount ?? 0) > 0;
      },
    );
  }

  /**
   * Delete multiple records
   *
   * @param model - Model name
   * @param where - Filter criteria
   * @returns Number of deleted records
   *
   * @example
   * ```ts
   * const count = await crud.deleteMany('User', { verified: false });
   * ```
   */
  async deleteMany(model: string, where: WhereClause): Promise<number> {
    const { tableName } = this.getSchema(model);
    const query: QueryObject = {
      type: "delete",
      table: tableName!,
      where,
    };

    return this.execute<number>(
      "deleteMany",
      model,
      tableName!,
      query,
      async (q) => {
        const result = await this.getAdapter().executeQuery<unknown>(q);
        if (!result.success) {
          throw new ForjaError(
            `Failed to delete ${model}: ${result.error.message}`,
            "QUERY_FAILED",
          );
        }
        return result.data.metadata.rowCount ?? 0;
      },
    );
  }

  /**
   * Get schema and table name (internal helper)
   * Reduces code duplication across all CRUD methods
   */
  private getSchema(model: string): SchemaDefinition {
    const schema = this.schemas.get(model);
    if (!schema) {
      throw new ForjaError(`Schema '${model}' not found`, "SCHEMA_NOT_FOUND");
    }
    return schema;
  }

  /**
   * Ensure reserved fields are included in select
   * Reserved fields (id, createdAt, updatedAt) must always be present
   *
   * @param select - User-provided select array or "*"
   * @returns Select with reserved fields guaranteed
   */
  /**
   * Process select clause using SchemaRegistry
   * - Resolves "*" to clean field list (excludes hidden & relation fields)
   * - Adds reserved fields to user-provided arrays
   *
   * @param model - Model name
   * @param select - User-provided select clause
   * @returns Processed select clause
   */
  private processSelect(model: string, select?: SelectClause): SelectClause {
    return this.schemas.getSelectFieldsFor(model, select);
  }

  /**
   * Process populate object (nested support)
   * - Converts populate[relation]=true to populate[relation]={select: [...]}
   * - Recursively processes nested populate
   * - Uses SchemaRegistry to resolve clean field lists
   *
   * @param model - Current model name
   * @param populate - Populate configuration
   * @returns Processed populate object
   */
  private processPopulate(
    model: string,
    populate?: PopulateClause,
  ): PopulateClause | undefined {
    if (!populate) {
      return populate;
    }

    const schema = this.getSchema(model);
    const result: Record<string, object> = {};

    for (const [relationName, value] of Object.entries(populate)) {
      const field = schema.fields[relationName];
      if (!field || field.type !== "relation") {
        // Skip non-relation fields
        continue;
      }

      const relationField = field as RelationField;
      const targetModel = relationField.model;

      if (typeof value === "boolean") {
        // populate[category]=true → convert to { select: [...] }
        result[relationName] = {
          select: this.processSelect(targetModel, "*"),
        };
      } else if (typeof value === "object") {
        // populate[category]={ select: [...], populate: {...} }
        result[relationName] = {
          ...value,
          // Process select for this level
          select: this.processSelect(targetModel, value.select),
          // Recursively process nested populate
          populate:
            value.populate ?
              this.processPopulate(targetModel, value.populate)
              : value.populate,
        };
      } else if (value === "*") {
        // populate[category]=* → convert to { select: [...] }
        result[relationName] = {
          select: this.processSelect(targetModel, "*"),
        };
      } else {
        // Invalid value
        throw new ForjaError(
          `Invalid populate value for ${model}.${relationName}: ${value}`,
          "INVALID_POPULATE_VALUE",
        );
      }
    }

    // Return populated object
    return result;
  }

  /**
   * Separate scalar fields from relation fields
   * Normalizes relation shortcuts (id → { connect: { id } })
   */
  private separateRelations(
    data: Record<string, unknown>,
    schema: SchemaDefinition,
  ): { scalars: Record<string, unknown>; relations: Record<string, unknown> } {
    const scalars: Record<string, unknown> = {};
    const relations: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(data)) {
      const field = schema.fields[key];

      if (field?.type === "relation") {
        // Normalize shortcuts
        if (typeof value === "number" || typeof value === "string") {
          // Shortcut: category: 5 → { connect: { id: 5 } }
          relations[key] = { connect: { id: value } };
        } else if (Array.isArray(value)) {
          // Shortcut: products: [1, 2] → { set: [{ id: 1 }, { id: 2 }] }
          relations[key] = { set: value.map((id) => ({ id })) };
        } else {
          // Full API: { connect, disconnect, set }
          relations[key] = value;
        }
      } else {
        scalars[key] = value;
      }
    }

    return { scalars, relations };
  }

  /**
   * Process a single relation (connect/disconnect/set)
   */
  private async processRelation(
    model: string,
    recordId: number | string,
    fieldName: string,
    relationData: unknown,
    schema: SchemaDefinition,
  ): Promise<void> {
    const field = schema.fields[fieldName];
    if (!field || field.type !== "relation") {
      return;
    }

    const relation = field as RelationField;
    const relData = relationData as RelationInput;
    const foreignKey = relation.foreignKey ?? `${fieldName}Id`;

    // belongsTo / hasOne → Update THIS record's foreign key
    if (relation.kind === "belongsTo" || relation.kind === "hasOne") {
      if (relData.connect) {
        const connectId =
          Array.isArray(relData.connect) ?
            relData.connect[0]?.id
            : relData.connect.id;
        if (connectId !== undefined) {
          await this.update(model, recordId, { [foreignKey]: connectId });
        }
      }
      if (relData.disconnect) {
        await this.update(model, recordId, { [foreignKey]: null });
      }
      if (relData.set) {
        // set can be array or single object for belongsTo/hasOne
        const setId = Array.isArray(relData.set) ?
          relData.set[0]?.id
          : (relData.set as { id: string | number })?.id;
        await this.update(model, recordId, {
          [foreignKey]: setId ?? null,
        });
      }
    }

    // hasMany → Update TARGET records' foreign key
    if (relation.kind === "hasMany") {
      const reverseForeignKey = relation.foreignKey ?? `${model}Id`;

      if (relData.connect) {
        const ids =
          Array.isArray(relData.connect) ?
            relData.connect.map((c) => c.id)
            : [relData.connect.id];
        if (ids.length > 0) {
          await this.updateMany(
            relation.model,
            { id: { $in: ids } },
            { [reverseForeignKey]: recordId },
          );
        }
      }

      if (relData.disconnect) {
        const ids =
          Array.isArray(relData.disconnect) ?
            relData.disconnect.map((c) => c.id)
            : [relData.disconnect.id];
        if (ids.length > 0) {
          await this.updateMany(
            relation.model,
            { id: { $in: ids } },
            { [reverseForeignKey]: null },
          );
        }
      }

      if (relData.set) {
        // 1. Disconnect all current
        await this.updateMany(
          relation.model,
          { [reverseForeignKey]: recordId },
          { [reverseForeignKey]: null },
        );
        // 2. Connect new ones
        const ids = relData.set.map((item) => item.id);
        if (ids.length > 0) {
          await this.updateMany(
            relation.model,
            { id: { $in: ids } },
            { [reverseForeignKey]: recordId },
          );
        }
      }
    }

    // manyToMany → TODO: Junction table insert/delete
    if (relation.kind === "manyToMany") {
      throw new ForjaError(
        "manyToMany relations not yet implemented",
        "NOT_IMPLEMENTED",
      );
    }
  }

  /**
   * Check for reserved fields in user data (internal helper)
   *
   * Reserved fields (id, createdAt, updatedAt) are automatically managed
   * and cannot be set manually in normal mode. Use forja.raw for manual control.
   *
   * @param data - Data to check
   * @throws ForjaError if reserved field is found in normal mode
   */
  private checkReservedFields(data: Record<string, unknown>): void {
    // Skip check in raw mode (dispatcher is null)
    if (this.getDispatcher === null) {
      return;
    }

    for (const field of RESERVED_FIELDS) {
      if (field in data) {
        throw new ForjaError(
          `Cannot set reserved field '${field}'. Use forja.raw.create() or forja.raw.update() for manual control.`,
          "RESERVED_FIELD_WRITE",
        );
      }
    }
  }

  /**
   * Validate data against schema (internal helper)
   * Used by create/update methods to ensure data integrity
   *
   * @param model - Model name (for error messages)
   * @param data - Data to validate
   * @param schema - Schema definition
   * @param partial - If true, use partial validation (for updates)
   * @param isCreate - If true, this is a create operation (affects timestamp handling)
   * @returns Validated data
   * @throws ForjaError if validation fails
   */
  private validateData<
    T extends ForjaEntry = ForjaEntry,
    P extends boolean = false,
  >(
    model: string,
    data: Record<string, unknown>,
    schema: SchemaDefinition,
    partial: P,
    isCreate: boolean = false,
  ): P extends true ? Partial<T> : T {
    const isRawMode = this.getDispatcher === null;

    // 1. Check for reserved fields (only in normal mode)
    this.checkReservedFields(data);

    // 2. Add timestamps BEFORE validation so they're present during validation
    const now = new Date();
    const dataWithTimestamps: Record<string, unknown> = { ...data };

    if (isCreate) {
      if (isRawMode) {
        // Raw mode: Smart defaults (only if not provided)
        if (!("createdAt" in dataWithTimestamps)) {
          dataWithTimestamps["createdAt"] = now;
        }
        if (!("updatedAt" in dataWithTimestamps)) {
          dataWithTimestamps["updatedAt"] = dataWithTimestamps["createdAt"];
        }
      } else {
        // Normal mode: Always add timestamps
        dataWithTimestamps["createdAt"] = now;
        dataWithTimestamps["updatedAt"] = now;
      }
    } else {
      // Update operation
      if (isRawMode) {
        // Raw mode: Add updatedAt only if not provided
        if (!("updatedAt" in dataWithTimestamps)) {
          dataWithTimestamps["updatedAt"] = now;
        }
      } else {
        // Normal mode: Always update timestamp
        dataWithTimestamps["updatedAt"] = now;
      }
    }

    // 3. Schema validation (with timestamps already present)
    const validationFn = partial ? validatePartial : validateSchema;
    const result = validationFn(dataWithTimestamps, schema, {
      strict: true,
      stripUnknown: false,
      abortEarly: false,
    });

    if (!result.success) {
      const errorMessages = result.error
        .map((e) => `${e.field}: ${e.message}`)
        .join(", ");
      throw new ForjaError(
        `Validation failed for ${model}: ${errorMessages}`,
        "VALIDATION_FAILED",
      );
    }

    return result.data as P extends true ? Partial<T> : T;
  }
}
