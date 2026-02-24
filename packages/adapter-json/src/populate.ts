import {
	QuerySelect,
	QuerySelectObject,
	WhereClause,
} from "forja-types/core/query-builder";
import type { JsonAdapter } from "./adapter";
import type { ForjaEntry, RelationField } from "forja-types/core/schema";
import {
	throwSchemaNotFound,
	throwRelationNotFound,
	throwInvalidRelationType,
	throwTargetModelNotFound,
} from "./error-helper";
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
			throwSchemaNotFound(query.table);
		}
		const currentModelName = currentSchema.name;

		const result = [...rows];

		for (const [relationName, _options] of Object.entries(query.populate)) {
			// Get relation field from current schema
			const relationField = currentSchema.fields[relationName];
			if (!relationField) {
				throwRelationNotFound(relationName, currentSchema.name);
			}

			if (relationField.type !== "relation") {
				throwInvalidRelationType(
					relationName,
					relationField.type,
					currentSchema.name,
				);
			}

			const relField = relationField as RelationField;
			const targetModelName = relField.model;
			const foreignKey = relField.foreignKey!;
			const kind = relField.kind;

			// Get target schema from adapter (cache-aware)
			const targetSchema =
				await this.adapter.getSchemaByModelName(targetModelName);
			if (!targetSchema) {
				throwTargetModelNotFound(
					targetModelName,
					relationName,
					currentSchema.name,
				);
			}

			const targetTable =
				targetSchema.tableName ?? targetModelName.toLowerCase();

			// Load target table using adapter's cache
			const tableData = await this.adapter.getCachedTable(targetTable);
			if (!tableData) continue;

			const relatedData = tableData.data as Record<string, unknown>[];

			// NOTE: We no longer apply select here - it's handled by adapter's applySelectRecursive
			// This ensures proper handling of nested populate + select combinations

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

				for (const row of result) {
					const fkValue = row[foreignKey as keyof T] as
						| number
						| null
						| undefined;
					if (fkValue !== null && fkValue !== undefined) {
						row[relationName as keyof T] = (relatedMap.get(fkValue) ??
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

				for (const row of result) {
					const rowId = row["id"] as string | number;
					const group = grouped.get(rowId) ?? [];
					if (kind === "hasOne") {
						row[relationName as keyof T] = (group[0] ?? null) as T[keyof T];
					} else {
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
					where: { [sourceFK]: { $in: sourceIds } } as WhereClause<T>,
					select: "*" as unknown as QuerySelect<T>,
				} satisfies QuerySelectObject<T>);

				// Build mapping: sourceId -> targetIds[]
				// Normalize all IDs to number for consistent comparison
				const mapping = new Map<number, number[]>();
				for (const junction of relevantJunctions) {
					const srcId = junction[sourceFK as keyof T];
					const tgtId = junction[targetFK as keyof T];

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

				// Filter target records directly from relatedData (already loaded)
				// Use runner for schema-aware ID comparison
				const targetDataForRunner =
					await this.adapter.getCachedTable(targetTable);
				if (!targetDataForRunner) continue;

				const targetRunner = new JsonQueryRunner(
					targetDataForRunner,
					this.adapter,
				);
				const targetRecords = await targetRunner.run({
					type: "select",
					table: targetTable,
					where: { id: { $in: Array.from(allTargetIds) } } as WhereClause<T>,
					select: "*" as unknown as QuerySelect<T>,
				});

				// Map to result rows
				for (const row of result) {
					const rowId = row["id"];
					const normalizedRowId =
						typeof rowId === "string" ? Number(rowId) : (rowId as number);
					const targetIds = mapping.get(normalizedRowId) ?? [];

					// Filter using normalized IDs
					const relatedRecords = targetRecords.filter((r) => {
						const rID = r["id"];
						const normalizedRID =
							typeof rID === "string" ? Number(rID) : (rID as number);
						return targetIds.includes(normalizedRID);
					});

					row[relationName as keyof T] = relatedRecords as T[keyof T];
				}
			}

			// Nested populate (recursion)
			if (typeof _options === "object" && _options.populate) {
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
