/**
 * Relation Processing for Query Executor
 *
 * Handles async relation operations:
 * - connect/disconnect/set: Junction table or FK updates
 * - create/update/delete: Recursive queries (via QueryBuilder + Executor)
 */

import {
  SchemaDefinition,
  SchemaRegistry,
  ForjaEntry,
  ForjaRecord,
} from "forja-types/core/schema";
import { QueryObject, QueryRelations, NormalizedRelationOperations } from "forja-types/core/query-builder";
import type { ProcessedData } from "../query-builder/data";
import { QueryExecutor } from "./executor";

/**
 * Result type for handleCUD operations
 */
interface CUDResult {
  createdIds: number[];
}

/**
 * Process all relation operations for a record
 *
 * @param relations - Relation operations from QueryObject
 * @param parentId - Parent record ID
 * @param parentModel - Parent model name
 * @param schema - Parent schema definition
 * @param operations - Internal CRUD operations
 * @param schemaRegistry - Schema registry for QueryBuilder
 *
 * @example
 * ```ts
 * await processRelations(
 *   {
 *     tags: { connect: [{ id: 1 }, { id: 2 }] },
 *     author: { create: { name: 'John' } }
 *   },
 *   123,  // Post ID
 *   'Post',
 *   postSchema,
 *   internalOps,
 *   registry
 * );
 * ```
 */
export async function processRelations<T extends ForjaEntry>(
  relations: QueryRelations<T>,
  parentId: number,
  parentModel: string,
  schema: SchemaDefinition,
  executor: QueryExecutor,
  schemaRegistry: SchemaRegistry,
): Promise<void> {
  for (const [fieldName, relationData] of Object.entries(relations)) {
    await processRelation({
      parentId,
      parentModel,
      fieldName,
      relationData: relationData as NormalizedRelationOperations<ForjaEntry>,
      schema,
      executor,
      schemaRegistry,
    });
  }
}

/**
 * Process a single relation field
 *
 * Handles:
 * - belongsTo/hasOne: Update parent FK
 * - hasMany: Update child FKs
 * - manyToMany: Junction table operations
 *
 * @param parentId - Parent record ID
 * @param parentModel - Parent model name
 * @param fieldName - Relation field name
 * @param relationData - Relation input data
 * @param schema - Parent schema definition
 * @param operations - Internal CRUD operations
 * @param schemaRegistry - Schema registry for QueryBuilder
 */
async function processRelation<T extends ForjaEntry>(
  {
    parentId,
    parentModel,
    fieldName,
    relationData,
    schema,
    executor,
    schemaRegistry
  }: {
    parentId: number,
    parentModel: string,
    fieldName: string,
    relationData: NormalizedRelationOperations<T>,
    schema: SchemaDefinition,
    executor: QueryExecutor,
    schemaRegistry: SchemaRegistry
  }
): Promise<void> {
  const field = schema.fields[fieldName];
  if (!field || field.type !== "relation") {
    return;
  }

  const relation = field;
  const relData = relationData
  const foreignKey = relation.foreignKey ?? `${fieldName}Id`;

  // belongsTo / hasOne → Update THIS record's foreign key
  if (relation.kind === "belongsTo" || relation.kind === "hasOne") {
    const updateData: ForjaRecord = {};

    // After normalization: connect/set/disconnect are now number[]
    if (relData.connect) {
      const ids = relData.connect;
      if (ids.length > 0) {
        updateData[foreignKey] = ids[0];
      }
    }
    if (relData.disconnect) {
      updateData[foreignKey] = null;
    }
    if (relData.set) {
      const ids = relData.set;
      updateData[foreignKey] = ids.length > 0 ? ids[0] : null;
    }

    // Handle create/update/delete (recursive queries)
    const cudResult = await handleCUD(relData, relation.model, executor, schemaRegistry);

    // If create returned IDs, assign the first one as FK
    if (cudResult.createdIds.length > 0) {
      updateData[foreignKey] = cudResult.createdIds[0];
    }

    // Only fire update if we have data and it wasn't already handled by inlining
    if (Object.keys(updateData).length > 0) {
      const query: QueryObject<T> = {
        table: schema.tableName!,
        type: 'update',
        where: { id: parentId },
        data: updateData,
      }
      await executor.executeUpdate(query, schema, { noDispatcher: true });
    }
  }

  // hasMany → Update TARGET records' foreign key
  if (relation.kind === "hasMany") {
    const reverseForeignKey = relation.foreignKey ?? `${parentModel}Id`;
    const relationSchema = schemaRegistry.get(relation.model)!;
    const query: QueryObject<T> = {
      table: relationSchema.tableName!,
      type: 'update',
    }

    // After normalization: connect/set/disconnect are now number[]
    if (relData.connect) {
      const ids = relData.connect;
      if (ids.length > 0) {
        await executor.executeUpdate({
          ...query,
          data: { [reverseForeignKey]: parentId },
          where: { id: { $in: ids } },
        }, relationSchema, { noDispatcher: true });
      }
    }

    if (relData.disconnect) {
      const ids = relData.disconnect;
      if (ids.length > 0) {
        await executor.executeUpdate({
          ...query,
          data: { [reverseForeignKey]: null },
          where: { id: { $in: ids } },
        }, relationSchema, { noDispatcher: true });
      }
    }

    if (relData.set) {
      // 1. Disconnect all current
      await executor.executeUpdate({
        ...query,
        data: { [reverseForeignKey]: null },
        where: { [reverseForeignKey]: parentId },
      }, relationSchema, { noDispatcher: true });

      // 2. Connect new ones
      const ids = relData.set as number[];
      if (ids.length > 0) {
        await executor.executeUpdate({
          ...query,
          data: { [reverseForeignKey]: parentId },
          where: { id: { $in: ids } },
        }, relationSchema, { noDispatcher: true });
      }
    }

    // Handle create/update/delete (recursive queries)
    const cudResult = await handleCUD(relData, relation.model, executor, schemaRegistry);

    // For created children, assign parent FK
    if (cudResult.createdIds.length > 0) {
      await executor.executeUpdate({
        ...query,
        data: { [reverseForeignKey]: parentId },
        where: { id: { $in: cudResult.createdIds } },
      }, relationSchema, { noDispatcher: true });
    }
  }

  // manyToMany → Junction table operations
  if (relation.kind === "manyToMany") {
    const junctionTable = relation.through!;
    const sourceFK = `${parentModel}Id`;
    const targetFK = `${relation.model}Id`;

    // After normalization: connect/set/disconnect are now number[]

    // Connect → INSERT INTO junction table
    if (relData.connect) {
      const ids = relData.connect;
      for (const targetId of ids) {
        await executor.execute({
          table: junctionTable,
          type: 'insert',
          data: {
            [sourceFK]: parentId,
            [targetFK]: targetId,
          }
        }, { noDispatcher: true, noReturning: true });
      }
    }

    // Disconnect → DELETE FROM junction table
    if (relData.disconnect) {
      const ids = relData.disconnect;
      if (ids.length > 0) {
        await executor.execute({
          table: junctionTable,
          type: 'delete',
          where: {
            [sourceFK]: parentId,
            [targetFK]: { $in: ids },
          }
        }, { noDispatcher: true, noReturning: true });
      }
    }

    // Set → DELETE all + INSERT new
    if (relData.set) {
      // 1. Delete all existing relations for this record
      await executor.execute({
        table: junctionTable,
        type: 'delete',
        where: {
          [sourceFK]: parentId,
        }
      }, { noDispatcher: true, noReturning: true });

      // 2. Insert new relations
      const ids = relData.set as number[];
      for (const targetId of ids) {
        await executor.execute({
          table: junctionTable,
          type: 'insert',
          data: {
            [sourceFK]: parentId,
            [targetFK]: targetId,
          }
        }, { noDispatcher: true, noReturning: true });
      }
    }

    // Handle create/update/delete (recursive queries)
    const cudResult = await handleCUD(relData, relation.model, executor, schemaRegistry);

    // For created targets, insert junction records
    if (cudResult.createdIds.length > 0) {
      for (const targetId of cudResult.createdIds) {
        await executor.execute({
          table: junctionTable,
          type: 'insert',
          data: {
            [sourceFK]: parentId,
            [targetFK]: targetId,
          }
        }, { noDispatcher: true, noReturning: true });
      }
    }
  }
}

/**
 * Handle create/update/delete operations (CUD)
 *
 * After processData normalization:
 * - create: ProcessedData | ProcessedData[] → { data, relations }
 * - update: { where, data, relations } | array
 * - delete: number[] (already normalized)
 *
 * Uses recursive QueryBuilder + Executor to handle nested relations.
 * Respects parent query's dispatcher mode (raw vs normal).
 *
 * @param relData - Relation input data (normalized by processData)
 * @param relatedModel - Related model name
 * @param executor - Query executor
 * @param schemaRegistry - Schema registry for QueryBuilder
 * @returns Created IDs (for FK assignment)
 */
async function handleCUD<T extends ForjaEntry>(
  relData: NormalizedRelationOperations<T>,
  relatedModel: string,
  executor: QueryExecutor,
  schemaRegistry: SchemaRegistry,
): Promise<CUDResult> {
  const createdIds: number[] = [];
  const schema = schemaRegistry.get(relatedModel)!;

  // Handle create (ProcessedData format from processData)
  if (relData.create) {
    const createItems = Array.isArray(relData.create)
      ? relData.create
      : [relData.create];

    for (const createItem of createItems) {
      const processedData = createItem as ProcessedData<ForjaEntry>;

      // Execute with noReturning: true (returns ID only)
      const createdId = await executor.execute<ForjaEntry, number>({
        type: "insert",
        table: schema.tableName!,
        data: processedData.data,
        relations: processedData.relations,
      }, { noReturning: true, noDispatcher: true });

      createdIds.push(createdId);
    }
  }

  // Handle update (ProcessedData format from processData)
  if (relData.update) {
    const updateItems = relData.update

    for (const updateItem of updateItems) {
      const { where, data, relations } = updateItem

      // Execute (validation + timestamps + RECURSIVE relations processing)
      await executor.execute({
        type: "update",
        table: schema.tableName!,
        data,
        relations,
        where,
      }, { noReturning: true, noDispatcher: true });
    }
  }

  // Handle delete (number[] after normalization)
  if (relData.delete) {
    const deleteIds = relData.delete;
    if (deleteIds.length > 0) {
      await executor.execute({
        type: "delete",
        table: schema.tableName!,
        where: { id: { $in: deleteIds } },
      })
    }
  }

  return { createdIds };
}
