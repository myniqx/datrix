import {
	QuerySelect,
	QuerySelectObject,
	QueryPopulateOptions,
} from "forja-types/core/query-builder";
import type { JsonAdapter } from "./adapter";
import type { ForjaEntry, RelationField } from "forja-types/core/schema";
import {
	throwSchemaNotFound,
	throwRelationNotFound,
	throwInvalidRelationType,
	throwTargetModelNotFound,
} from "forja-types/errors/adapter";
import { JsonQueryRunner } from "./runner";

export class JsonPopulator {
	constructor(private adapter: JsonAdapter) {}

	async populate<T extends ForjaEntry>(
		rows: T[],
		query: QuerySelectObject<T>,
	): Promise<T[]> {
		if (!query.populate || rows.length === 0) {
			return rows;
		}

		// Get current schema directly from table file (cache-aware, O(1) lookup)
		const currentSchema = await this.adapter.getSchemaByTableName(query.table);
		if (!currentSchema) {
			throwSchemaNotFound({ adapter: "json", modelName: query.table });
		}
		const currentModelName = currentSchema.name;

		const result = [...rows];

		for (const [relationName, _options] of Object.entries(query.populate)) {
			// Get relation field from current schema
			const relationField = currentSchema.fields[relationName];
			if (!relationField) {
				throwRelationNotFound({
					adapter: "json",
					relationName,
					schemaName: currentSchema.name,
				});
			}

			if (relationField.type !== "relation") {
				throwInvalidRelationType({
					adapter: "json",
					relationName,
					fieldType: relationField.type,
					schemaName: currentSchema.name,
				});
			}

			const relField = relationField as RelationField;
			const targetModelName = relField.model;
			const foreignKey = relField.foreignKey!;
			const kind = relField.kind;

			// Get target schema from adapter (cache-aware)
			const targetSchema =
				await this.adapter.getSchemaByModelName(targetModelName);
			if (!targetSchema) {
				throwTargetModelNotFound({
					adapter: "json",
					targetModel: targetModelName,
					relationName,
					schemaName: currentSchema.name,
				});
			}

			const targetTable =
				targetSchema.tableName ?? targetModelName.toLowerCase();

			// Load target table using adapter's cache
			const tableData = await this.adapter.getCachedTable(targetTable);
			if (!tableData) continue;

			const relatedData = tableData.data as Record<string, unknown>[];

			// NOTE: We no longer apply select here - it's handled by adapter's applySelectRecursive
			// This ensures proper handling of nested populate + select combinations

			const options =
				typeof _options === "object" &&
				_options !== null &&
				!Array.isArray(_options)
					? (_options as QueryPopulateOptions<ForjaEntry>)
					: undefined;

			// Map data based on relation type
			if (kind === "belongsTo") {
				// Source has FK (e.g. Post.authorId -> User.id)
				const ids = new Set(
					result
						.map((r) => r[foreignKey as keyof T] as number)
						.filter((id): id is number => id !== null && id !== undefined),
				);

				const relatedMap = new Map<number, Record<string, unknown>>();
				if (ids.size > 0) {
					for (const item of relatedData) {
						const itemId = item["id"] as number;
						if (ids.has(itemId)) {
							relatedMap.set(itemId, item);
						}
					}
				}

				// If where is specified, pre-filter the map using runner's match logic
				let filteredMap = relatedMap;
				if (options?.where) {
					filteredMap = new Map();
					const filterRunner = new JsonQueryRunner(
						tableData,
						this.adapter,
						targetSchema,
					);
					for (const [id, item] of relatedMap) {
						const matched = await filterRunner.filterAndSort({
							type: "select",
							table: targetTable,
							where: options.where,
							select: "*" as unknown as QuerySelect,
						});
						if (matched.some((r) => r["id"] === id)) {
							filteredMap.set(id, item);
						}
					}
				}

				for (const row of result) {
					const fkValue = row[foreignKey as keyof T] as
						| number
						| null
						| undefined;
					if (fkValue !== null && fkValue !== undefined) {
						row[relationName as keyof T] = (filteredMap.get(fkValue) ??
							null) as T[keyof T];
					} else {
						row[relationName as keyof T] = null as T[keyof T];
					}
				}
			} else if (kind === "hasMany" || kind === "hasOne") {
				// Target has FK (e.g. User.id <- Post.authorId)
				const sourceIds = new Set(
					result
						.map((r) => r["id"])
						.filter((id): id is number => id !== null && id !== undefined),
				);

				// Group related items by FK
				const grouped = new Map<string | number, Record<string, unknown>[]>();
				for (const item of relatedData) {
					const fkValue = item[foreignKey] as number | null | undefined;
					if (
						fkValue !== null &&
						fkValue !== undefined &&
						sourceIds.has(fkValue)
					) {
						const group = grouped.get(fkValue) ?? [];
						group.push(item);
						grouped.set(fkValue, group);
					}
				}

				const hasSortOrFilter =
					options?.where ||
					options?.orderBy ||
					options?.limit !== undefined ||
					options?.offset !== undefined;

				for (const row of result) {
					const rowId = row["id"] as string | number;
					let group = grouped.get(rowId) ?? [];

					if (kind === "hasOne") {
						row[relationName as keyof T] = (group[0] ?? null) as T[keyof T];
					} else {
						if (hasSortOrFilter && group.length > 0) {
							const groupTable = { ...tableData, data: group };
							const groupRunner = new JsonQueryRunner(
								groupTable,
								this.adapter,
								targetSchema,
							);
							group = await groupRunner.filterAndSort({
								type: "select",
								table: targetTable,
								where: options?.where,
								orderBy: options?.orderBy,
								limit: options?.limit,
								offset: options?.offset,
								select: "*" as unknown as QuerySelect,
							});
						}
						row[relationName as keyof T] = group as T[keyof T];
					}
				}
			} else if (kind === "manyToMany") {
				// ManyToMany uses junction table (e.g. Post <-> Tag via post_tag)
				const junctionTableName = relField.through!;
				const sourceFK = `${currentModelName}Id`;
				const targetFK = `${targetModelName}Id`;

				// Load junction table using adapter cache
				const junctionData =
					await this.adapter.getCachedTable(junctionTableName);
				if (!junctionData) {
					throw new Error(
						`Junction table '${junctionTableName}' not found for manyToMany relation '${relationName}' in schema '${currentSchema.name}'`,
					);
				}

				// Collect source IDs
				const sourceIds = result
					.map((r) => r["id"])
					.filter((id): id is number => id !== null && id !== undefined);

				if (sourceIds.length === 0) continue;

				// Use Runner for schema-aware filtering (handles string/number coercion)
				const junctionRunner = new JsonQueryRunner(junctionData, this.adapter);
				const relevantJunctions = await junctionRunner.run({
					type: "select",
					table: junctionTableName,
					where: { [sourceFK]: { $in: sourceIds } },
					select: "*" as unknown as QuerySelect,
				});

				// Build mapping: sourceId -> targetIds[]
				// Normalize all IDs to number for consistent comparison
				const mapping = new Map<number, number[]>();
				for (const junction of relevantJunctions) {
					const srcId = junction[sourceFK as keyof typeof junction];
					const tgtId = junction[targetFK as keyof typeof junction];

					// Normalize to number
					const normalizedSrcId =
						typeof srcId === "string" ? Number(srcId) : (srcId as number);
					const normalizedTgtId =
						typeof tgtId === "string" ? Number(tgtId) : (tgtId as number);

					const existing = mapping.get(normalizedSrcId) ?? [];
					existing.push(normalizedTgtId);
					mapping.set(normalizedSrcId, existing);
				}

				// Collect all unique target IDs
				const allTargetIds = new Set<number>();
				for (const ids of mapping.values()) {
					ids.forEach((id) => allTargetIds.add(id));
				}

				// Filter target records with id filter merged with user's where
				const targetDataForRunner =
					await this.adapter.getCachedTable(targetTable);
				if (!targetDataForRunner) continue;

				const idFilter = { id: { $in: Array.from(allTargetIds) } };
				const userWhere = options?.where;
				const mergedWhere = userWhere
					? { $and: [idFilter, userWhere] }
					: idFilter;

				const targetRunner = new JsonQueryRunner(
					targetDataForRunner,
					this.adapter,
					targetSchema,
				);
				const targetRecords = await targetRunner.run({
					type: "select",
					table: targetTable,
					where: mergedWhere as QuerySelectObject["where"],
					orderBy: options?.orderBy,
					select: "*" as unknown as QuerySelect,
				});

				// Map to result rows, applying limit/offset per-row
				for (const row of result) {
					const rowId = row["id"];
					const normalizedRowId =
						typeof rowId === "string" ? Number(rowId) : (rowId as number);
					const targetIds = mapping.get(normalizedRowId) ?? [];

					// Filter to this row's related records (already where/order filtered above)
					let relatedRecords = targetRecords.filter((r) => {
						const rID = r["id"];
						const normalizedRID =
							typeof rID === "string" ? Number(rID) : (rID as number);
						return targetIds.includes(normalizedRID);
					});

					// Apply limit/offset per-row
					const offset = options?.offset ?? 0;
					if (options?.limit !== undefined) {
						relatedRecords = relatedRecords.slice(
							offset,
							offset + options.limit,
						);
					} else if (offset > 0) {
						relatedRecords = relatedRecords.slice(offset);
					}

					row[relationName as keyof T] = relatedRecords as T[keyof T];
				}
			}

			// Nested populate (recursion)
			if (
				typeof _options === "object" &&
				_options !== null &&
				_options.populate
			) {
				const nextRows: T[] = [];
				for (const row of result) {
					const val = row[relationName as keyof T] as T;
					if (!val) continue;
					if (Array.isArray(val)) {
						nextRows.push(...val);
					} else {
						nextRows.push(val);
					}
				}

				if (nextRows.length > 0) {
					await this.populate(nextRows, {
						type: "select",
						table: targetTable,
						populate: _options.populate,
						select: "*" as unknown as QuerySelect<T>,
					});
				}
			}
		}

		return result;
	}
}
