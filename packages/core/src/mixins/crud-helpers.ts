/**
 * CRUD Helper Functions
 *
 * Pure utility functions for CRUD operations.
 * These functions don't depend on database connections or dispatchers.
 */

import {
  SchemaDefinition,
  RelationField,
  RelationInput,
  normalizeRelationIds,
  normalizeRelationId,
  RelationIdRefs,
  RESERVED_FIELDS,
  ForjaEntry,
  ForjaRecord,
} from "forja-types/core/schema";
import {
  SelectClause,
  PopulateClause,
  WhereClause,
} from "forja-types/core/query-builder";
import { validateOrThrow, validatePartialOrThrow } from "../validator";
import {
  throwReservedFieldError,
  throwInvalidPopulateError,
} from "./error-helper";

/**
 * Check if value is a RelationInput object (has connect/disconnect/set/etc)
 * vs a raw ID reference
 *
 * @param value - Value to check
 * @returns True if value is a RelationInput object
 *
 * @example
 * ```ts
 * isRelationInputObject({ connect: { id: 5 } })  // true
 * isRelationInputObject({ id: 5 })               // false (raw ref)
 * isRelationInputObject(5)                       // false
 * ```
 */
export function isRelationInputObject(value: unknown): boolean {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  // If it has 'id' property directly, it's a raw { id } ref, not RelationInput
  if ("id" in value && !("connect" in value || "set" in value)) {
    return false;
  }
  // Check for RelationInput keys
  return (
    "connect" in value ||
    "disconnect" in value ||
    "set" in value ||
    "create" in value ||
    "update" in value ||
    "delete" in value
  );
}

/**
 * Normalize relation input to standard { id } format
 *
 * Handles all flexible formats:
 * - Top-level shortcuts: 5, [1,2,3]
 * - RelationInput operations: connect, disconnect, set, delete
 *
 * @param data - Input data with potential relation fields
 * @param schema - Schema definition to identify relation fields
 * @returns Normalized data with all relations in standard format
 *
 * @example
 * ```ts
 * // Shortcuts
 * { category: 5 }                    -> { category: { connect: [{ id: 5 }] } }
 * { tags: [1, 2] }                   -> { tags: { set: [{ id: 1 }, { id: 2 }] } }
 *
 * // Flexible connect
 * { author: { connect: 5 } }         -> { author: { connect: [{ id: 5 }] } }
 * { author: { connect: { id: 5 } } } -> { author: { connect: [{ id: 5 }] } }
 * { tags: { connect: [1, 2] } }      -> { tags: { connect: [{ id: 1 }, { id: 2 }] } }
 *
 * // Mixed formats
 * { tags: { set: [1, { id: 2 }] } }  -> { tags: { set: [{ id: 1 }, { id: 2 }] } }
 * ```
 */
export function normalizeRelations(
  data: Record<string, unknown>,
  schema: SchemaDefinition,
): Record<string, unknown> {
  const normalized = { ...data };

  for (const [key, value] of Object.entries(data)) {
    const field = schema.fields[key];

    if (field?.type === "relation") {
      // Case 1: Direct ID shortcut (category: 5)
      if (typeof value === "number" || typeof value === "string") {
        normalized[key] = { set: [normalizeRelationId(value)] };
        continue;
      }

      // Case 2: Array shortcut (tags: [1, 2, 3])
      if (Array.isArray(value)) {
        // Check if it's already a RelationInput array vs raw ID array
        const isRawIdArray = value.length === 0 || !isRelationInputObject(value[0]);
        if (isRawIdArray) {
          normalized[key] = {
            set: normalizeRelationIds(value as RelationIdRefs),
          };
          continue;
        }
      }

      // Case 3: RelationInput object - normalize each operation
      if (typeof value === "object" && value !== null) {
        const relInput = value as RelationInput;
        const normalizedInput: RelationInput = {};

        // Normalize connect
        if (relInput.connect !== undefined) {
          normalizedInput.connect = normalizeRelationIds(relInput.connect);
        }

        // Normalize disconnect
        if (relInput.disconnect !== undefined) {
          normalizedInput.disconnect = normalizeRelationIds(relInput.disconnect);
        }

        // Normalize set
        if (relInput.set !== undefined) {
          normalizedInput.set = normalizeRelationIds(relInput.set);
        }

        // Normalize delete
        if (relInput.delete !== undefined) {
          normalizedInput.delete = normalizeRelationIds(relInput.delete);
        }

        // Pass through create/update unchanged
        if (relInput.create !== undefined) {
          normalizedInput.create = relInput.create;
        }
        if (relInput.update !== undefined) {
          normalizedInput.update = relInput.update;
        }

        normalized[key] = normalizedInput;
      }
    }
  }

  return normalized;
}

/**
 * Result of separating scalar and relation fields
 */
export interface SeparatedFields {
  /** Scalar fields (including inlined foreign keys) */
  scalars: Record<string, unknown>;
  /** Relation fields that need async processing */
  relations: Record<string, unknown>;
}

/**
 * Separate scalar fields from relation fields
 *
 * For belongsTo/hasOne relations, inlines the foreign key into scalars
 * so it can be included in the main INSERT/UPDATE query.
 *
 * @param data - Normalized data (after normalizeRelations)
 * @param schema - Schema definition
 * @returns Separated scalars and relations
 *
 * @example
 * ```ts
 * // Input (after normalization)
 * {
 *   name: "Post 1",
 *   category: { connect: [{ id: 5 }] },  // belongsTo
 *   tags: { set: [{ id: 1 }, { id: 2 }] } // hasMany
 * }
 *
 * // Output
 * {
 *   scalars: { name: "Post 1", categoryId: 5 },
 *   relations: { tags: { set: [{ id: 1 }, { id: 2 }] } }
 * }
 * ```
 */
export function separateRelations<T extends ForjaEntry = ForjaRecord>(
  data: T,
  schema: SchemaDefinition,
): SeparatedFields {
  const scalars: Record<string, unknown> = {};
  const relations: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    const field = schema.fields[key];

    if (field?.type === "relation") {
      const relation = field as RelationField;
      const relData = value as RelationInput;

      // Check if this relation can be inlined (belongsTo or hasOne with local FK)
      if (relation.kind === "belongsTo" || relation.kind === "hasOne") {
        const foreignKey = relation.foreignKey!;
        let inlinedId: string | number | null | undefined = undefined;

        if (relData.connect) {
          inlinedId =
            Array.isArray(relData.connect) ?
              relData.connect[0]?.id
              : relData.connect.id;
        } else if (relData.set) {
          inlinedId =
            Array.isArray(relData.set) ?
              relData.set[0]?.id
              : (relData.set as { id: string | number })?.id;
        } else if (relData.disconnect) {
          inlinedId = null;
        }

        if (inlinedId !== undefined) {
          scalars[foreignKey] = inlinedId;
          // Also keep in relations if there are other operations like 'create' or 'update'
          const hasOtherOps = relData.create || relData.update || relData.delete;
          if (hasOtherOps) {
            relations[key] = value;
          }
        } else {
          relations[key] = value;
        }
      } else {
        relations[key] = value;
      }
    } else {
      scalars[key] = value;
    }
  }

  return { scalars, relations };
}

/**
 * Options for validateData function
 */
export interface ValidateDataOptions {
  /** If true, use partial validation (for updates) */
  partial: boolean;
  /** If true, this is a create operation (affects timestamp handling) */
  isCreate: boolean;
  /** If true, skip reserved field checks and use smart defaults for timestamps */
  isRawMode: boolean;
}

/**
 * Check for reserved fields in user data
 *
 * Reserved fields (id, createdAt, updatedAt) are automatically managed
 * and cannot be set manually in normal mode.
 *
 * @param data - Data to check
 * @param isRawMode - If true, skip the check
 * @throws ForjaError if reserved field is found in normal mode
 */
export function checkReservedFields(
  data: Record<string, unknown>,
  isRawMode: boolean,
): void {
  if (isRawMode) {
    return;
  }

  for (const field of RESERVED_FIELDS) {
    if (field in data) {
      throwReservedFieldError(field, "unknown");
    }
  }
}

/**
 * Validate data against schema with timestamp handling
 *
 * @param data - Data to validate
 * @param schema - Schema definition
 * @param options - Validation options
 * @returns Validated data with timestamps
 * @throws ForjaError if validation fails
 *
 * @example
 * ```ts
 * // Create operation (normal mode)
 * const validated = validateData(data, schema, {
 *   partial: false,
 *   isCreate: true,
 *   isRawMode: false,
 * });
 *
 * // Update operation (raw mode)
 * const validated = validateData(data, schema, {
 *   partial: true,
 *   isCreate: false,
 *   isRawMode: true,
 * });
 * ```
 */
export function validateData<
  T extends ForjaEntry = ForjaEntry,
  P extends boolean = false,
>(
  data: Record<string, unknown>,
  schema: SchemaDefinition,
  options: ValidateDataOptions,
): P extends true ? Partial<T> : T {
  const { partial, isCreate, isRawMode } = options;

  // 1. Check for reserved fields (only in normal mode)
  checkReservedFields(data, isRawMode);

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
  const validationOptions = {
    strict: true,
    stripUnknown: false,
    abortEarly: false,
  };

  if (partial) {
    return validatePartialOrThrow<T>(
      dataWithTimestamps,
      schema,
      validationOptions,
    ) as P extends true ? Partial<T> : T;
  }

  return validateOrThrow<T>(
    dataWithTimestamps,
    schema,
    validationOptions,
  ) as P extends true ? Partial<T> : T;
}

/**
 * Dependencies for processPopulate function
 */
export interface PopulateDeps {
  /** Get schema by model name */
  getSchema: (model: string) => SchemaDefinition;
  /** Process select clause for a model */
  processSelect: (model: string, select?: SelectClause) => SelectClause;
}

/**
 * Process populate object (nested support)
 *
 * - Converts populate[relation]=true to populate[relation]={select: [...]}
 * - Recursively processes nested populate
 * - Uses provided dependencies to resolve schemas and select fields
 *
 * @param model - Current model name
 * @param populate - Populate configuration
 * @param deps - Dependencies (getSchema, processSelect)
 * @returns Processed populate object
 *
 * @example
 * ```ts
 * const processed = processPopulate('Post', {
 *   author: true,
 *   category: { select: ['name'], populate: { parent: true } }
 * }, deps);
 * ```
 */
export function processPopulate(
  model: string,
  populate: PopulateClause | undefined,
  deps: PopulateDeps,
): PopulateClause | undefined {
  if (!populate) {
    return populate;
  }

  const schema = deps.getSchema(model);
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
        select: deps.processSelect(targetModel, "*"),
      };
    } else if (typeof value === "object") {
      // populate[category]={ select: [...], populate: {...} }
      result[relationName] = {
        ...value,
        // Process select for this level
        select: deps.processSelect(targetModel, value.select),
        // Recursively process nested populate
        populate:
          value.populate ?
            processPopulate(targetModel, value.populate, deps)
            : value.populate,
      };
    } else if (value === "*") {
      // populate[category]=* → convert to { select: [...] }
      result[relationName] = {
        select: deps.processSelect(targetModel, "*"),
      };
    } else {
      // Invalid value
      throwInvalidPopulateError(model, relationName, value);
    }
  }

  return result;
}

/**
 * Internal update function signature
 */
export type InternalUpdateFn = (
  model: string,
  where: WhereClause,
  data: Record<string, unknown>,
) => Promise<number>;

/**
 * Internal insert function signature
 */
export type InternalInsertFn = (
  model: string,
  data: Record<string, unknown>,
) => Promise<number | string>;

/**
 * Internal delete function signature
 */
export type InternalDeleteFn = (
  model: string,
  where: WhereClause,
) => Promise<number>;

/**
 * Process a single relation (connect/disconnect/set)
 *
 * Handles relation operations by updating foreign keys:
 * - belongsTo/hasOne: Updates the source record's FK
 * - hasMany: Updates target records' FK
 * - manyToMany: Junction table insert/delete operations
 *
 * @param model - Source model name
 * @param recordId - Source record ID
 * @param fieldName - Relation field name
 * @param relationData - Relation input data (connect/disconnect/set)
 * @param schema - Schema definition
 * @param internalUpdate - Function to perform silent updates
 * @param internalInsert - Function to perform silent inserts
 * @param internalDelete - Function to perform silent deletes
 *
 * @example
 * ```ts
 * await processRelation(
 *   'Post',
 *   1,
 *   'tags',
 *   { connect: [{ id: 1 }, { id: 2 }] },
 *   postSchema,
 *   internalUpdate,
 *   internalInsert,
 *   internalDelete
 * );
 * ```
 */
export async function processRelation(
  model: string,
  recordId: number | string,
  fieldName: string,
  relationData: unknown,
  schema: SchemaDefinition,
  internalUpdate: InternalUpdateFn,
  internalInsert: InternalInsertFn,
  internalDelete: InternalDeleteFn,
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
    const updateData: Record<string, unknown> = {};

    if (relData.connect) {
      const connectId =
        Array.isArray(relData.connect) ?
          relData.connect[0]?.id
          : relData.connect.id;
      if (connectId !== undefined) {
        updateData[foreignKey] = connectId;
      }
    }
    if (relData.disconnect) {
      updateData[foreignKey] = null;
    }
    if (relData.set) {
      const setId =
        Array.isArray(relData.set) ?
          relData.set[0]?.id
          : (relData.set as { id: string | number })?.id;
      updateData[foreignKey] = setId ?? null;
    }

    // Only fire update if we have data and it wasn't already handled by inlining
    if (Object.keys(updateData).length > 0) {
      await internalUpdate(model, { id: recordId }, updateData);
    }
  }

  // hasMany → Update TARGET records' foreign key (silent, no dispatcher)
  if (relation.kind === "hasMany") {
    const reverseForeignKey = relation.foreignKey ?? `${model}Id`;

    if (relData.connect) {
      const ids =
        Array.isArray(relData.connect) ?
          relData.connect.map((c) => c.id)
          : [relData.connect.id];
      if (ids.length > 0) {
        await internalUpdate(
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
        await internalUpdate(
          relation.model,
          { id: { $in: ids } },
          { [reverseForeignKey]: null },
        );
      }
    }

    if (relData.set) {
      // 1. Disconnect all current
      await internalUpdate(
        relation.model,
        { [reverseForeignKey]: recordId },
        { [reverseForeignKey]: null },
      );
      // 2. Connect new ones
      const ids = relData.set.map((item) => item.id);
      if (ids.length > 0) {
        await internalUpdate(
          relation.model,
          { id: { $in: ids } },
          { [reverseForeignKey]: recordId },
        );
      }
    }
  }

  // manyToMany → Junction table insert/delete
  if (relation.kind === "manyToMany") {
    const junctionTable = relation.through!;
    const sourceFK = `${model}Id`;
    const targetFK = `${relation.model}Id`;

    // Connect → INSERT INTO junction table
    if (relData.connect) {
      const ids =
        Array.isArray(relData.connect) ?
          relData.connect.map((c) => c.id)
          : [relData.connect.id];

      for (const targetId of ids) {
        await internalInsert(junctionTable, {
          [sourceFK]: recordId,
          [targetFK]: targetId,
        });
      }
    }

    // Disconnect → DELETE FROM junction table
    if (relData.disconnect) {
      const ids =
        Array.isArray(relData.disconnect) ?
          relData.disconnect.map((c) => c.id)
          : [relData.disconnect.id];

      if (ids.length > 0) {
        await internalDelete(junctionTable, {
          [sourceFK]: recordId,
          [targetFK]: { $in: ids },
        });
      }
    }

    // Set → DELETE all + INSERT new
    if (relData.set) {
      // 1. Delete all existing relations for this record
      await internalDelete(junctionTable, { [sourceFK]: recordId });

      // 2. Insert new relations
      const ids = relData.set.map((item) => item.id);
      for (const targetId of ids) {
        await internalInsert(junctionTable, {
          [sourceFK]: recordId,
          [targetFK]: targetId,
        });
      }
    }
  }
}
