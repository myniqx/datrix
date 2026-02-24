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
	QueryRelations,
	NormalizedRelationOperations,
	WhereClause,
} from "forja-types/core/query-builder";
import { QueryRunner } from "forja-types/adapter";
import { validateData } from "./validation";

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
	runner: QueryRunner,
	schemaRegistry: SchemaRegistry,
): Promise<void> {
	for (const [fieldName, ops] of Object.entries(resolvedRelations)) {
		await processRelation<T>({
			parentId,
			parentModel,
			fieldName,
			ops,
			schema,
			runner,
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
	runner: QueryRunner,
	schemaRegistry: SchemaRegistry,
): Promise<Record<string, ResolvedRelationOps>> {
	const resolved: Record<string, ResolvedRelationOps> = {};

	for (const [fieldName, relationData] of Object.entries(relations)) {
		const relData = relationData as NormalizedRelationOperations<ForjaEntry>;
		const field = schema.fields[fieldName];
		if (!field || field.type !== "relation") {
			continue;
		}

		const relatedModel = field.model;
		const relSchema = schemaRegistry.get(relatedModel)!;

		// Start with existing ID-based ops (copy from readonly)
		const ops: ResolvedRelationOps = {
			connect: relData.connect ? [...relData.connect] : [],
			disconnect: relData.disconnect ? [...relData.disconnect] : [],
			set: relData.set ? [...relData.set] : undefined,
			deleteIds: relData.delete ? [...relData.delete] : [],
		};

		// --- Execute CREATE (once) and merge IDs ---
		if (relData.create) {
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

			// Separate items with nested relations from plain ones
			const plainItems = relData.create.filter((item) => !item.relations);
			const nestedItems = relData.create.filter((item) => item.relations);

			// Bulk insert plain items (no nested relations)
			if (plainItems.length > 0) {
				const validatedBulkData = plainItems.map((item) =>
					validateData<ForjaEntry, false>(
						item.data,
						item.relations,
						relSchema,
						{
							partial: false,
							isCreate: true,
							isRawMode: true,
						},
					),
				);
				const bulkResult = await runner.executeQuery<ForjaEntry>({
					type: "insert",
					table: relSchema.tableName!,
					data: validatedBulkData,
				});
				if (!bulkResult.success) {
					throw bulkResult.error;
				}

				for (const created of bulkResult.data.rows) {
					if (ops.set !== undefined) {
						ops.set.push(created.id);
					} else {
						ops.connect.push(created.id);
					}
				}
			}

			// Items with nested relations must be inserted individually
			for (const createItem of nestedItems) {
				const validatedData = validateData<ForjaEntry, false>(
					createItem.data,
					createItem.relations,
					relSchema,
					{
						partial: false,
						isCreate: true,
						isRawMode: true,
					},
				);
				const createResult = await runner.executeQuery<ForjaEntry>({
					type: "insert",
					table: relSchema.tableName!,
					data: [validatedData],
				});
				if (!createResult.success) {
					throw createResult.error;
				}
				const createdId = createResult.data.rows[0]!.id;

				// Recursively resolve nested relations
				if (createItem.relations) {
					const nestedResolved = await resolveRelationCUD(
						createItem.relations,
						relSchema,
						runner,
						schemaRegistry,
					);
					await processRelations(
						nestedResolved,
						createdId,
						relSchema.name,
						relSchema,
						runner,
						schemaRegistry,
					);
				}

				if (ops.set !== undefined) {
					ops.set.push(createdId);
				} else {
					ops.connect.push(createdId);
				}
			}
		}

		// --- Execute UPDATE (once) ---
		if (relData.update) {
			for (const updateItem of relData.update) {
				const { where, data, relations: nestedRelations } = updateItem;

				const validatedData = validateData<ForjaEntry, true>(
					data,
					nestedRelations,
					relSchema,
					{
						partial: true,
						isCreate: false,
						isRawMode: true,
					},
				);
				const updateResult = await runner.executeQuery<ForjaEntry>({
					type: "update",
					table: relSchema.tableName!,
					data: validatedData,
					where: where as WhereClause<ForjaEntry>,
				});
				if (!updateResult.success) {
					throw updateResult.error;
				}

				// Recursively resolve nested relations
				if (nestedRelations) {
					for (const updated of updateResult.data.rows) {
						const nestedResolved = await resolveRelationCUD(
							nestedRelations,
							relSchema,
							runner,
							schemaRegistry,
						);
						await processRelations(
							nestedResolved,
							updated.id,
							relSchema.name,
							relSchema,
							runner,
							schemaRegistry,
						);
					}
				}
			}
		}

		// --- Execute DELETE (once) ---
		if (ops.deleteIds.length > 0) {
			const deleteResult = await runner.executeQuery<ForjaEntry>({
				type: "delete",
				table: relSchema.tableName!,
				where: { id: { $in: ops.deleteIds } },
			});
			if (!deleteResult.success) {
				throw deleteResult.error;
			}
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
	runner,
	schemaRegistry,
}: {
	parentId: number;
	parentModel: string;
	fieldName: string;
	ops: ResolvedRelationOps;
	schema: SchemaDefinition;
	runner: QueryRunner;
	schemaRegistry: SchemaRegistry;
}): Promise<void> {
	const field = schema.fields[fieldName];
	if (!field || field.type !== "relation") {
		return;
	}

	const relation = field;
	const foreignKey = relation.foreignKey ?? `${fieldName}Id`;

	// belongsTo → Update THIS record's foreign key (FK is on owner)
	if (relation.kind === "belongsTo") {
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
			const result = await runner.executeQuery<T>({
				table: schema.tableName!,
				type: "update",
				where: { id: parentId } as WhereClause<T>,
				data: updateData as Partial<T>,
			});
			if (!result.success) {
				throw result.error;
			}
		}
	}

	// hasOne → Update TARGET record's foreign key (FK is on target, singular)
	if (relation.kind === "hasOne") {
		const reverseForeignKey = relation.foreignKey ?? `${parentModel}Id`;
		const relationSchema = schemaRegistry.get(relation.model)!;

		// For hasOne, we need to ensure only one target is linked
		if (ops.connect.length > 0) {
			// First, disconnect any existing target
			const disconnectResult = await runner.executeQuery<T>({
				table: relationSchema.tableName!,
				type: "update",
				data: { [reverseForeignKey]: null } as Partial<T>,
				where: { [reverseForeignKey]: parentId } as WhereClause<T>,
			});
			if (!disconnectResult.success) {
				throw disconnectResult.error;
			}

			// Then connect the new target (only first one for hasOne)
			const result = await runner.executeQuery<T>({
				table: relationSchema.tableName!,
				type: "update",
				data: { [reverseForeignKey]: parentId } as Partial<T>,
				where: { id: ops.connect[0] } as WhereClause<T>,
			});
			if (!result.success) {
				throw result.error;
			}
		}

		if (ops.disconnect.length > 0) {
			const result = await runner.executeQuery<T>({
				table: relationSchema.tableName!,
				type: "update",
				data: { [reverseForeignKey]: null } as Partial<T>,
				where: { id: { $in: ops.disconnect } } as WhereClause<T>,
			});
			if (!result.success) {
				throw result.error;
			}
		}

		if (ops.set !== undefined) {
			// 1. Disconnect current
			const disconnectResult = await runner.executeQuery<T>({
				table: relationSchema.tableName!,
				type: "update",
				data: { [reverseForeignKey]: null } as Partial<T>,
				where: { [reverseForeignKey]: parentId } as WhereClause<T>,
			});
			if (!disconnectResult.success) {
				throw disconnectResult.error;
			}

			// 2. Connect new one (if any)
			if (ops.set.length > 0) {
				const connectResult = await runner.executeQuery<T>({
					table: relationSchema.tableName!,
					type: "update",
					data: { [reverseForeignKey]: parentId } as Partial<T>,
					where: { id: ops.set[0] } as WhereClause<T>,
				});
				if (!connectResult.success) {
					throw connectResult.error;
				}
			}
		}
	}

	// hasMany → Update TARGET records' foreign key (FK is on target, plural)
	if (relation.kind === "hasMany") {
		const reverseForeignKey = relation.foreignKey ?? `${parentModel}Id`;
		const relationSchema = schemaRegistry.get(relation.model)!;

		if (ops.connect.length > 0) {
			const result = await runner.executeQuery<T>({
				table: relationSchema.tableName!,
				type: "update",
				data: { [reverseForeignKey]: parentId } as Partial<T>,
				where: { id: { $in: ops.connect } } as WhereClause<T>,
			});
			if (!result.success) {
				throw result.error;
			}
		}

		if (ops.disconnect.length > 0) {
			const result = await runner.executeQuery<T>({
				table: relationSchema.tableName!,
				type: "update",
				data: { [reverseForeignKey]: null } as Partial<T>,
				where: { id: { $in: ops.disconnect } } as WhereClause<T>,
			});
			if (!result.success) {
				throw result.error;
			}
		}

		if (ops.set !== undefined) {
			// 1. Disconnect all current
			const disconnectResult = await runner.executeQuery<T>({
				table: relationSchema.tableName!,
				type: "update",
				data: { [reverseForeignKey]: null } as Partial<T>,
				where: {
					[reverseForeignKey]: parentId,
				} as WhereClause<T>,
			});
			if (!disconnectResult.success) {
				throw disconnectResult.error;
			}

			// 2. Connect new ones
			if (ops.set.length > 0) {
				const connectResult = await runner.executeQuery<T>({
					table: relationSchema.tableName!,
					type: "update",
					data: {
						[reverseForeignKey]: parentId,
					} as Partial<T>,
					where: {
						id: { $in: ops.set },
					} as WhereClause<T>,
				});
				if (!connectResult.success) {
					throw connectResult.error;
				}
			}
		}
	}

	// manyToMany → Junction table operations
	if (relation.kind === "manyToMany") {
		const junctionTable = relation.through!;
		const sourceFK = `${parentModel}Id`;
		const targetFK = `${relation.model}Id`;

		// Connect → INSERT INTO junction table (bulk)
		if (ops.connect.length > 0) {
			const rows = ops.connect.map((targetId) => ({
				[sourceFK]: parentId,
				[targetFK]: targetId,
			}));
			const result = await runner.executeQuery<ForjaEntry>({
				table: junctionTable,
				type: "insert",
				data: rows,
			});
			if (!result.success) {
				throw result.error;
			}
		}

		// Disconnect → DELETE FROM junction table
		if (ops.disconnect.length > 0) {
			const result = await runner.executeQuery<ForjaEntry>({
				table: junctionTable,
				type: "delete",
				where: {
					[sourceFK]: parentId,
					[targetFK]: { $in: ops.disconnect },
				},
			});
			if (!result.success) {
				throw result.error;
			}
		}

		// Set → DELETE all + INSERT new
		if (ops.set !== undefined) {
			// 1. Delete all existing relations for this record
			const deleteResult = await runner.executeQuery<ForjaEntry>({
				table: junctionTable,
				type: "delete",
				where: {
					[sourceFK]: parentId,
				},
			});
			if (!deleteResult.success) {
				throw deleteResult.error;
			}

			// 2. Insert new relations (bulk)
			if (ops.set.length > 0) {
				const rows = ops.set.map((targetId) => ({
					[sourceFK]: parentId,
					[targetFK]: targetId,
				}));
				const insertResult = await runner.executeQuery<ForjaEntry>({
					table: junctionTable,
					type: "insert",
					data: rows,
				});
				if (!insertResult.success) {
					throw insertResult.error;
				}
			}
		}
	}
}
