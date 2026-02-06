/**
 * Relation Processing for Query Executor
 *
 * Strategy: "Resolve-then-link"
 * 1. Execute create/update/delete first (recursive, via executor)
 * 2. Merge created IDs into connect/set arrays
 * 3. Process only ID-based operations (connect/disconnect/set)
 *
 * This prevents duplicate creation when updateMany targets multiple records.
 * create/update run ONCE, then each parent only does ID-based linking.
 */

import {
	SchemaDefinition,
	SchemaRegistry,
	ForjaEntry,
	ForjaRecord,
} from "forja-types/core/schema";
import {
	QueryObject,
	QueryRelations,
	NormalizedRelationOperations,
	WhereClause,
} from "forja-types/core/query-builder";
import { QueryExecutor } from "./executor";

// TODO: Implement circular relation detection
// Nested create can cause infinite loops:
// Post.create({ author: { create: { posts: { create: [...] } } } })
// Add depth limit or visited set before processing nested relations.

/**
 * Resolved relation operations (mutable, after CUD resolution)
 *
 * After resolveCUD runs, create/update/delete are consumed and
 * their resulting IDs are merged into connect/set.
 * Only ID-based operations remain for per-parent linking.
 */
interface ResolvedRelationOps {
	connect: number[];
	disconnect: number[];
	set: number[] | undefined;
	deleteIds: number[];
}

/**
 * Process all relation operations for a single parent record
 *
 * Called per-parent from executor. By this point, CUD operations
 * should already be resolved via resolveRelationCUD.
 *
 * @param resolvedRelations - Pre-resolved relation ops (ID-based only)
 * @param parentId - Parent record ID
 * @param parentModel - Parent model name
 * @param schema - Parent schema definition
 * @param executor - Query executor
 * @param schemaRegistry - Schema registry
 */
export async function processRelations<T extends ForjaEntry>(
	resolvedRelations: Record<string, ResolvedRelationOps>,
	parentId: number,
	parentModel: string,
	schema: SchemaDefinition,
	executor: QueryExecutor,
	schemaRegistry: SchemaRegistry,
): Promise<void> {
	for (const [fieldName, ops] of Object.entries(resolvedRelations)) {
		await processRelation<T>({
			parentId,
			parentModel,
			fieldName,
			ops,
			schema,
			executor,
			schemaRegistry,
		});
	}
}

/**
 * Resolve CUD operations from relation data
 *
 * Executes create/update/delete ONCE, then merges resulting IDs
 * into connect arrays. Returns resolved ops ready for per-parent linking.
 *
 * This is called ONCE before the per-parent loop in executor,
 * preventing duplicate creation when updateMany targets N records.
 *
 * @param relations - Raw relation operations from QueryObject
 * @param schema - Parent schema definition
 * @param executor - Query executor
 * @param schemaRegistry - Schema registry
 * @returns Resolved relation ops per field (ID-based only)
 *
 * @example
 * ```ts
 * // Input:  { tags: { create: [{ data: { name: 'New' } }], connect: [1] } }
 * // Output: { tags: { connect: [1, 42], disconnect: [], set: undefined, deleteIds: [] } }
 * //                          ↑ 42 = newly created tag ID
 * ```
 */
export async function resolveRelationCUD<T extends ForjaEntry>(
	relations: QueryRelations<T>,
	schema: SchemaDefinition,
	executor: QueryExecutor,
	schemaRegistry: SchemaRegistry,
): Promise<Record<string, ResolvedRelationOps>> {
	const resolved: Record<string, ResolvedRelationOps> = {};

	for (const [fieldName, relationData] of Object.entries(relations)) {
		const relData =
			relationData as NormalizedRelationOperations<ForjaEntry>;
		const field = schema.fields[fieldName];
		if (!field || field.type !== "relation") {
			continue;
		}

		const relatedModel = field.model;

		// Start with existing ID-based ops (copy from readonly)
		const ops: ResolvedRelationOps = {
			connect: relData.connect ? [...relData.connect] : [],
			disconnect: relData.disconnect ? [...relData.disconnect] : [],
			set: relData.set ? [...relData.set] : undefined,
			deleteIds: relData.delete ? [...relData.delete] : [],
		};

		// --- Execute CREATE (once) and merge IDs ---
		if (relData.create) {
			const relSchema = schemaRegistry.get(relatedModel)!;

			// TODO: hasMany + updateMany guard
			// When parent query is updateMany (multiple parents), hasMany create
			// is semantically ambiguous: a child can only belong to one parent.
			// Guard implementation (commented out - enable when needed):
			//
			// if (field.kind === 'hasMany' && parentCount > 1) {
			//   const count = await executor.executeCount(countQuery, parentSchema, { noDispatcher: true });
			//   if (count > 1) {
			//     throw new Error(
			//       `Cannot use create in hasMany relation "${fieldName}" when updating multiple records. ` +
			//       `A hasMany child can only belong to one parent. Use connect instead, ` +
			//       `or narrow your where clause to target a single record.`
			//     );
			//   }
			// }

			for (const createItem of relData.create) {
				const createdId = await executor.execute<ForjaEntry, number>(
					{
						type: "insert",
						table: relSchema.tableName!,
						data: createItem.data,
						relations: createItem.relations,
					},
					{ noReturning: true, noDispatcher: true },
				);

				// Merge created ID into connect or set
				if (ops.set !== undefined) {
					ops.set.push(createdId);
				} else {
					ops.connect.push(createdId);
				}
			}
		}

		// --- Execute UPDATE (once) ---
		if (relData.update) {
			const relSchema = schemaRegistry.get(relatedModel)!;

			for (const updateItem of relData.update) {
				const { where, data, relations: nestedRelations } = updateItem;

				await executor.execute(
					{
						type: "update",
						table: relSchema.tableName!,
						data,
						relations: nestedRelations,
						where: where as WhereClause<ForjaEntry>,
					},
					{ noReturning: true, noDispatcher: true },
				);
			}
		}

		// --- Execute DELETE (once) ---
		if (ops.deleteIds.length > 0) {
			const relSchema = schemaRegistry.get(relatedModel)!;

			await executor.execute({
				type: "delete",
				table: relSchema.tableName!,
				where: { id: { $in: ops.deleteIds } },
			});
		}

		resolved[fieldName] = ops;
	}

	return resolved;
}

/**
 * Process a single relation field (ID-based operations only)
 *
 * At this point, create/update/delete are already resolved.
 * Only connect/disconnect/set remain as ID arrays.
 */
async function processRelation<T extends ForjaEntry>({
	parentId,
	parentModel,
	fieldName,
	ops,
	schema,
	executor,
	schemaRegistry,
}: {
	parentId: number;
	parentModel: string;
	fieldName: string;
	ops: ResolvedRelationOps;
	schema: SchemaDefinition;
	executor: QueryExecutor;
	schemaRegistry: SchemaRegistry;
}): Promise<void> {
	const field = schema.fields[fieldName];
	if (!field || field.type !== "relation") {
		return;
	}

	const relation = field;
	const foreignKey = relation.foreignKey ?? `${fieldName}Id`;

	// belongsTo / hasOne → Update THIS record's foreign key
	if (relation.kind === "belongsTo" || relation.kind === "hasOne") {
		const updateData: Partial<ForjaRecord> = {};

		if (ops.connect.length > 0) {
			updateData[foreignKey] = ops.connect[0];
		}
		if (ops.disconnect.length > 0) {
			updateData[foreignKey] = null;
		}
		if (ops.set !== undefined) {
			updateData[foreignKey] = ops.set.length > 0 ? ops.set[0] : null;
		}

		if (Object.keys(updateData).length > 0) {
			const query: QueryObject<T> = {
				table: schema.tableName!,
				type: "update",
				where: { id: parentId } as WhereClause<T>,
				data: updateData as Partial<T>,
			};
			await executor.executeUpdate(query, schema, {
				noDispatcher: true,
			});
		}
	}

	// hasMany → Update TARGET records' foreign key
	if (relation.kind === "hasMany") {
		const reverseForeignKey = relation.foreignKey ?? `${parentModel}Id`;
		const relationSchema = schemaRegistry.get(relation.model)!;
		const baseQuery: QueryObject<T> = {
			table: relationSchema.tableName!,
			type: "update",
		};

		if (ops.connect.length > 0) {
			await executor.executeUpdate(
				{
					...baseQuery,
					data: { [reverseForeignKey]: parentId } as Partial<T>,
					where: { id: { $in: ops.connect } } as WhereClause<T>,
				},
				relationSchema,
				{ noDispatcher: true },
			);
		}

		if (ops.disconnect.length > 0) {
			await executor.executeUpdate(
				{
					...baseQuery,
					data: { [reverseForeignKey]: null } as Partial<T>,
					where: { id: { $in: ops.disconnect } } as WhereClause<T>,
				},
				relationSchema,
				{ noDispatcher: true },
			);
		}

		if (ops.set !== undefined) {
			// 1. Disconnect all current
			await executor.executeUpdate(
				{
					...baseQuery,
					data: { [reverseForeignKey]: null } as Partial<T>,
					where: {
						[reverseForeignKey]: parentId,
					} as WhereClause<T>,
				},
				relationSchema,
				{ noDispatcher: true },
			);

			// 2. Connect new ones
			if (ops.set.length > 0) {
				await executor.executeUpdate(
					{
						...baseQuery,
						data: {
							[reverseForeignKey]: parentId,
						} as Partial<T>,
						where: {
							id: { $in: ops.set },
						} as WhereClause<T>,
					},
					relationSchema,
					{ noDispatcher: true },
				);
			}
		}
	}

	// manyToMany → Junction table operations
	if (relation.kind === "manyToMany") {
		const junctionTable = relation.through!;
		const sourceFK = `${parentModel}Id`;
		const targetFK = `${relation.model}Id`;

		// Connect → INSERT INTO junction table
		if (ops.connect.length > 0) {
			for (const targetId of ops.connect) {
				await executor.execute(
					{
						table: junctionTable,
						type: "insert",
						data: {
							[sourceFK]: parentId,
							[targetFK]: targetId,
						},
					},
					{ noDispatcher: true, noReturning: true },
				);
			}
		}

		// Disconnect → DELETE FROM junction table
		if (ops.disconnect.length > 0) {
			await executor.execute(
				{
					table: junctionTable,
					type: "delete",
					where: {
						[sourceFK]: parentId,
						[targetFK]: { $in: ops.disconnect },
					},
				},
				{ noDispatcher: true, noReturning: true },
			);
		}

		// Set → DELETE all + INSERT new
		if (ops.set !== undefined) {
			// 1. Delete all existing relations for this record
			await executor.execute(
				{
					table: junctionTable,
					type: "delete",
					where: {
						[sourceFK]: parentId,
					},
				},
				{ noDispatcher: true, noReturning: true },
			);

			// 2. Insert new relations
			for (const targetId of ops.set) {
				await executor.execute(
					{
						table: junctionTable,
						type: "insert",
						data: {
							[sourceFK]: parentId,
							[targetFK]: targetId,
						},
					},
					{ noDispatcher: true, noReturning: true },
				);
			}
		}
	}
}
