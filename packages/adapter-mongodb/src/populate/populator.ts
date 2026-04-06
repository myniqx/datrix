/**
 * MongoDB Populator
 *
 * Handles relation population using two strategies:
 * 1. $lookup aggregation pipeline (depth 1) - single query, best performance
 * 2. Batched queries with $in (depth 2+) - one query per level, clean and maintainable
 */

import type { Document, Filter } from "mongodb";
import type {
	QueryPopulate,
	QueryPopulateOptions,
	QuerySelectObject,
} from "@datrix/core";
import type { DatrixEntry, ISchemaRegistry } from "@datrix/core";
import type { MongoClient } from "../mongo-client";
import type { MongoDBQueryTranslator } from "../query-translator";
import { throwMaxDepthExceeded } from "@datrix/core";

/**
 * Maximum populate nesting depth
 */
const MAX_POPULATE_DEPTH = 5;

/**
 * MongoDB Populator Class
 *
 * Strategies:
 * - Depth 1: $lookup aggregation pipeline (single query)
 * - Depth 2+: Batched queries with $in (level-per-query)
 */
export class MongoDBPopulator<T extends DatrixEntry> {
	constructor(
		private readonly client: MongoClient<T>,
		private readonly schemaRegistry: ISchemaRegistry,
		private readonly translator: MongoDBQueryTranslator,
	) { }

	/**
	 * Main entry point for populate
	 */
	async populate(
		query: QuerySelectObject<T>,
		filter: Filter<Document>,
		projection?: Document,
		sort?: Document,
	): Promise<readonly T[]> {
		if (!query.populate) return [];

		const maxDepth = this.getMaxDepth(query.populate, query.table);
		if (maxDepth > MAX_POPULATE_DEPTH) {
			throwMaxDepthExceeded({
				adapter: "mongodb",
				currentDepth: maxDepth,
				maxDepth: MAX_POPULATE_DEPTH,
				relationPath: this.buildRelationPath(query.populate),
			});
		}

		if (maxDepth === 1) {
			return this.executeLookup(query, filter, projection, sort);
		}

		return this.executeBatched(query, filter, projection, sort);
	}

	/**
	 * Strategy 1: $lookup aggregation pipeline (depth 1)
	 *
	 * Builds a single aggregation pipeline that:
	 * 1. $match → filter
	 * 2. $lookup → for each relation
	 * 3. $unwind → for belongsTo/hasOne (single result)
	 * 4. $project → field selection
	 * 5. $sort, $skip, $limit → pagination
	 */
	private async executeLookup(
		query: QuerySelectObject<T>,
		filter: Filter<Document>,
		projection?: Document,
		sort?: Document,
	): Promise<readonly T[]> {
		const modelName = this.schemaRegistry.findModelByTableName(query.table);
		if (!modelName) return [];
		const schema = this.schemaRegistry.get(modelName);
		if (!schema) return [];

		const pipeline: Document[] = [];

		// $match
		if (Object.keys(filter).length > 0) {
			pipeline.push({ $match: filter });
		}

		// $lookup for each relation
		for (const [relationName, _options] of Object.entries(query.populate!)) {
			const options = _options as QueryPopulateOptions<T>;
			const relationField = schema.fields[relationName];
			if (!relationField || relationField.type !== "relation") continue;

			const relation = relationField;
			const targetSchema = this.schemaRegistry.get(relation.model);
			if (!targetSchema) continue;

			const targetCollection =
				targetSchema.tableName ?? relation.model.toLowerCase();

			if (relation.kind === "belongsTo") {
				pipeline.push(
					...this.buildLookupWithUnwind(
						targetCollection,
						relation.foreignKey!,
						"id",
						relationName,
						options,
						targetCollection,
					),
				);
			} else if (relation.kind === "hasOne") {
				pipeline.push(
					...this.buildLookupWithUnwind(
						targetCollection,
						"id",
						relation.foreignKey!,
						relationName,
						options,
						targetCollection,
					),
				);
			} else if (relation.kind === "hasMany") {
				pipeline.push({
					$lookup: {
						from: targetCollection,
						localField: "id",
						foreignField: relation.foreignKey!,
						as: relationName,
						...this.buildLookupPipeline(options, targetCollection),
					},
				});
			} else if (relation.kind === "manyToMany") {
				const junctionCollection = relation.through!;
				const sourceFK = `${schema.name}Id`;
				const targetFK = `${relation.model}Id`;

				// Two-stage lookup: source → junction → target
				const junctionAlias = `_junction_${relationName}`;
				pipeline.push({
					$lookup: {
						from: junctionCollection,
						localField: "id",
						foreignField: sourceFK,
						as: junctionAlias,
					},
				});
				pipeline.push({
					$lookup: {
						from: targetCollection,
						localField: `${junctionAlias}.${targetFK}`,
						foreignField: "id",
						as: relationName,
						...this.buildLookupPipeline(options, targetCollection),
					},
				});
				// Remove junction temp field
				pipeline.push({ $project: { [junctionAlias]: 0 } });
			}
		}

		// $sort
		if (sort && Object.keys(sort).length > 0) {
			pipeline.push({ $sort: sort });
		}

		// $skip
		if (query.offset !== undefined) {
			pipeline.push({ $skip: query.offset });
		}

		// $limit
		if (query.limit !== undefined) {
			pipeline.push({ $limit: query.limit });
		}

		// $project - exclude _id, apply field selection
		const finalProjection = this.buildFinalProjection(
			projection,
			query.populate!,
		);
		if (finalProjection) {
			pipeline.push({ $project: finalProjection });
		}

		const collection = this.client.getCollection(query.table);
		const sessionOpts = this.client.sessionOptions();
		const rows = await this.client.execute(
			`aggregate:${query.table}`,
			() => collection.aggregate(pipeline, sessionOpts).toArray(),
			{ pipeline },
		);

		return rows as unknown as T[];
	}

	/**
	 * Strategy 2: Batched queries with $in (depth 2+)
	 *
	 * 1. Execute main query
	 * 2. For each relation: collect parent IDs → $in query → map results in memory
	 * 3. Recurse for nested populate
	 */
	private async executeBatched(
		query: QuerySelectObject<T>,
		filter: Filter<Document>,
		projection?: Document,
		sort?: Document,
	): Promise<readonly T[]> {
		const modelName = this.schemaRegistry.findModelByTableName(query.table);
		if (!modelName) return [];
		const schema = this.schemaRegistry.get(modelName);
		if (!schema) return [];

		// Inject FK columns needed for belongsTo relations into projection
		// so that batched populate can use them to look up related records.
		const enrichedProjection = this.injectFkColumns(
			projection,
			schema,
			query.populate!,
		);

		// Execute main query
		const collection = this.client.getCollection(query.table);
		const sessionOpts = this.client.sessionOptions();

		let cursor = collection.find(filter, {
			...sessionOpts,
			projection: { ...enrichedProjection, _id: 0 },
		});
		if (sort) cursor = cursor.sort(sort);
		if (query.offset !== undefined) cursor = cursor.skip(query.offset);
		if (query.limit !== undefined) cursor = cursor.limit(query.limit);

		const rows = (await this.client.execute(`find:${query.table}`, () =>
			cursor.toArray(),
		)) as unknown as T[];

		if (rows.length === 0) return rows;

		// Populate relations
		await this.populateBatchedRows(rows, query.table, query.populate!);

		return rows;
	}

	/**
	 * Populate relations on already-fetched rows using batched $in queries
	 */
	private async populateBatchedRows(
		rows: T[],
		tableName: string,
		populate: QueryPopulate<T>,
	): Promise<void> {
		const modelName = this.schemaRegistry.findModelByTableName(tableName);
		if (!modelName) return;
		const schema = this.schemaRegistry.get(modelName);
		if (!schema) return;

		const sessionOpts = this.client.sessionOptions();

		for (const [relationName, _options] of Object.entries(populate)) {
			const options = _options as QueryPopulateOptions<T>;
			const relationField = schema.fields[relationName];
			if (!relationField || relationField.type !== "relation") continue;

			const relation = relationField as {
				kind: string;
				model: string;
				foreignKey?: string;
				through?: string;
			};
			const targetSchema = this.schemaRegistry.get(relation.model);
			if (!targetSchema) continue;

			const targetCollection =
				targetSchema.tableName ?? relation.model.toLowerCase();
			let baseTargetProjection = this.buildSelectProjection(
				options.select as readonly string[] | undefined,
			);

			// hasOne/hasMany: FK is on target table — ensure it's in the projection
			// so we can map results back to parent rows
			if (
				(relation.kind === "hasOne" || relation.kind === "hasMany") &&
				baseTargetProjection &&
				relation.foreignKey
			) {
				baseTargetProjection = {
					...baseTargetProjection,
					[relation.foreignKey]: 1,
				};
			}

			// Inject FK columns needed by nested populate into target projection
			const targetProjection =
				options.populate && baseTargetProjection
					? this.injectFkColumns(
						baseTargetProjection,
						targetSchema,
						options.populate,
					)
					: baseTargetProjection;

			if (relation.kind === "belongsTo") {
				const fkColumn = relation.foreignKey!;
				const fkValues = rows
					.map((row) => row[fkColumn as keyof T])
					.filter((v) => v != null);

				if (fkValues.length === 0) {
					for (const row of rows)
						row[relationName as keyof T] = null as T[keyof T];
					continue;
				}

				const relatedRows = await this.fetchAndPopulateNested(
					targetCollection,
					{ id: { $in: fkValues } },
					targetProjection,
					sessionOpts,
					options,
				);

				const dataMap = new Map(relatedRows.map((r) => [r.id, r]));
				for (const row of rows) {
					const fkValue = row[fkColumn as keyof T];
					row[relationName as keyof T] = (dataMap.get(fkValue as number) ??
						null) as T[keyof T];
					delete row[fkColumn as keyof T];
				}
			} else if (relation.kind === "hasOne") {
				const fkColumn = relation.foreignKey!;
				const parentIds = rows.map((r) => r.id);

				const relatedRows = await this.fetchAndPopulateNested(
					targetCollection,
					{ [fkColumn]: { $in: parentIds } },
					targetProjection,
					sessionOpts,
					options,
				);

				const dataMap = new Map(
					relatedRows.map((r) => [
						(r as T & { [key: string]: unknown })[fkColumn] as number,
						r,
					]),
				);
				for (const row of rows) {
					row[relationName as keyof T] = (dataMap.get(row.id) ??
						null) as T[keyof T];
				}
			} else if (relation.kind === "hasMany") {
				const fkColumn = relation.foreignKey!;
				const parentIds = rows.map((r) => r.id);

				const relatedRows = await this.fetchAndPopulateNested(
					targetCollection,
					{ [fkColumn]: { $in: parentIds } },
					targetProjection,
					sessionOpts,
					options,
				);

				const groupMap = new Map<number, DatrixEntry[]>();
				for (const r of relatedRows) {
					const fk = (r as T & { [key: string]: unknown })[fkColumn] as number;
					if (!groupMap.has(fk)) groupMap.set(fk, []);
					groupMap.get(fk)!.push(r);
				}
				for (const row of rows) {
					row[relationName as keyof T] = (groupMap.get(row.id) ??
						[]) as T[keyof T];
				}
			} else if (relation.kind === "manyToMany") {
				const junctionCollection = relation.through!;
				const sourceFK = `${schema.name}Id`;
				const targetFK = `${relation.model}Id`;
				const parentIds = rows.map((r) => r.id);

				const junctionCol = this.client.getCollection(junctionCollection);
				const junctionDocs = await this.client.execute(
					`batch:${junctionCollection}`,
					() =>
						junctionCol
							.find(
								{ [sourceFK]: { $in: parentIds } },
								{ ...sessionOpts, projection: { _id: 0 } },
							)
							.toArray(),
				);

				const targetIds = junctionDocs.map((j) => j[targetFK] as number);
				if (targetIds.length === 0) {
					for (const row of rows)
						row[relationName as keyof T] = [] as T[keyof T];
					continue;
				}

				const relatedRows = await this.fetchAndPopulateNested(
					targetCollection,
					{ id: { $in: targetIds } },
					targetProjection,
					sessionOpts,
					options,
				);

				const targetMap = new Map(relatedRows.map((r) => [r.id, r]));

				// Build parent → related mapping via junction
				const groupMap = new Map<number, DatrixEntry[]>();
				for (const j of junctionDocs) {
					const sFK = j[sourceFK] as number;
					const tFK = j[targetFK] as number;
					const target = targetMap.get(tFK);
					if (!target) continue;
					if (!groupMap.has(sFK)) groupMap.set(sFK, []);
					groupMap.get(sFK)!.push(target);
				}

				for (const row of rows) {
					row[relationName as keyof T] = (groupMap.get(row.id) ??
						[]) as T[keyof T];
				}
			}
		}
	}

	/**
	 * Helper function to fetch target collection data and recursively
	 * populate if nested populate options are present.
	 */
	private async fetchAndPopulateNested(
		targetCollection: string,
		filter: Filter<Document>,
		projection: Document | undefined,
		sessionOpts: Filter<Document>,
		options: QueryPopulateOptions<T>,
	): Promise<T[]> {
		// Merge user where into the base filter
		let mergedFilter = filter;
		if (options.where) {
			const whereFilter = this.translator.translateWhere(
				options.where,
				targetCollection,
			);
			if (Object.keys(whereFilter).length > 0) {
				mergedFilter = { $and: [filter, whereFilter] } as Filter<Document>;
			}
		}

		// Build sort document from orderBy
		let sort: Document | undefined;
		if (options.orderBy && options.orderBy.length > 0) {
			sort = {};
			for (const item of options.orderBy) {
				sort[item.field as string] = item.direction === "asc" ? 1 : -1;
			}
		}

		const targetCol = this.client.getCollection(targetCollection);
		let cursor = targetCol.find(mergedFilter, {
			...sessionOpts,
			projection: { _id: 0, ...projection },
		});

		if (sort) cursor = cursor.sort(sort);
		if (options.offset !== undefined && options.offset > 0)
			cursor = cursor.skip(options.offset);
		if (options.limit !== undefined) cursor = cursor.limit(options.limit);

		const relatedDocs = await this.client.execute(
			`batch:${targetCollection}`,
			() => cursor.toArray(),
		);

		const relatedRows = relatedDocs as unknown as T[];

		if (options.populate && relatedRows.length > 0) {
			await this.populateBatchedRows(
				relatedRows,
				targetCollection,
				options.populate,
			);
		}

		return relatedRows;
	}

	/**
	 * Build $lookup pipeline sub-options (field selection for lookup results)
	 */
	private buildLookupPipeline(
		options: QueryPopulateOptions<T>,
		targetCollection?: string,
	): { pipeline?: Document[] } {
		const innerPipeline: Document[] = [];

		// $match for where filter
		if (options.where) {
			const filter = this.translator.translateWhere(
				options.where,
				targetCollection,
			);
			if (Object.keys(filter).length > 0) {
				innerPipeline.push({ $match: filter });
			}
		}

		// $sort for orderBy
		if (options.orderBy && options.orderBy.length > 0) {
			const sort: Document = {};
			for (const item of options.orderBy) {
				sort[item.field as string] = item.direction === "asc" ? 1 : -1;
			}
			innerPipeline.push({ $sort: sort });
		}

		// $skip for offset
		if (options.offset !== undefined && options.offset > 0) {
			innerPipeline.push({ $skip: options.offset });
		}

		// $limit for limit
		if (options.limit !== undefined) {
			innerPipeline.push({ $limit: options.limit });
		}

		// $project for select (always exclude _id)
		const selectProjection = this.buildSelectProjection(
			options.select as readonly string[] | undefined,
		);
		if (selectProjection) {
			innerPipeline.push({ $project: { _id: 0, ...selectProjection } });
		} else {
			innerPipeline.push({ $project: { _id: 0 } });
		}

		return { pipeline: innerPipeline };
	}

	/**
	 * Build projection from select array
	 */
	private buildSelectProjection(
		select: readonly string[] | undefined,
	): Record<string, number> | undefined {
		if (!select || select.length === 0) return undefined;
		const projection: Record<string, number> = {};
		for (const field of select) {
			projection[field] = 1;
		}
		projection["id"] = 1;
		return projection;
	}

	/**
	 * Build final projection for $lookup pipeline (exclude _id, include populated fields)
	 */
	private buildFinalProjection(
		baseProjection: Document | undefined,
		populate: QueryPopulate<T>,
	): Document | undefined {
		const proj: Record<string, unknown> = { _id: 0 };

		if (baseProjection) {
			Object.assign(proj, baseProjection);
		}

		// Ensure populated relation fields are included
		for (const relationName of Object.keys(populate)) {
			proj[relationName] = 1;
		}

		return Object.keys(proj).length > 1 ? proj : { _id: 0 };
	}

	/**
	 * Build standardized $lookup + $unwind pipeline steps for belongsTo/hasOne
	 */
	private buildLookupWithUnwind(
		targetCollection: string,
		localField: string,
		foreignField: string,
		asName: string,
		options: QueryPopulateOptions<T>,
		collectionName?: string,
	): Document[] {
		return [
			{
				$lookup: {
					from: targetCollection,
					localField,
					foreignField,
					as: asName,
					...this.buildLookupPipeline(options, collectionName),
				},
			},
			{
				$unwind: {
					path: `$${asName}`,
					preserveNullAndEmptyArrays: true,
				},
			},
			{
				$addFields: {
					[asName]: { $ifNull: [`$${asName}`, null] },
				},
			},
		];
	}

	/**
	 * Calculate max depth of populate tree
	 */
	private getMaxDepth(
		populate: QueryPopulate<T>,
		_tableName: string,
		depth = 1,
	): number {
		let maxDepth = depth;

		for (const [, options] of Object.entries(populate)) {
			if (
				typeof options === "object" &&
				options !== null &&
				"populate" in options &&
				options.populate
			) {
				const nestedDepth = this.getMaxDepth(options.populate, "", depth + 1);
				if (nestedDepth > maxDepth) maxDepth = nestedDepth;
			}
		}

		return maxDepth;
	}

	/**
	 * Build relation path string for error messages
	 */
	private buildRelationPath(populate: QueryPopulate<T>, prefix = ""): string {
		const paths: string[] = [];

		for (const [relationName, options] of Object.entries(populate)) {
			const currentPath = prefix ? `${prefix}.${relationName}` : relationName;
			paths.push(currentPath);

			if (
				typeof options === "object" &&
				options !== null &&
				"populate" in options &&
				options.populate
			) {
				const nested = this.buildRelationPath(options.populate, currentPath);
				paths.push(...nested.split(", "));
			}
		}

		return paths.join(", ");
	}

	/**
	 * Inject FK columns into projection for belongsTo relations.
	 * Without these, batched populate cannot look up related records
	 * because the FK value (e.g. authorId) is excluded from query results.
	 */
	private injectFkColumns(
		projection: Document | undefined,
		schema: {
			readonly fields: Record<
				string,
				{
					readonly type: string;
					readonly foreignKey?: string;
					readonly kind?: string;
				}
			>;
		},
		populate: QueryPopulate<T>,
	): Document | undefined {
		// If no projection (select *), all fields are returned - no injection needed
		if (!projection) return undefined;

		const enriched = { ...projection };

		for (const relationName of Object.keys(populate)) {
			const field = schema.fields[relationName];
			if (!field || field.type !== "relation") continue;

			const relation = field as { kind?: string; foreignKey?: string };
			if (relation.kind === "belongsTo" && relation.foreignKey) {
				enriched[relation.foreignKey] = 1;
			}
		}

		return enriched;
	}
}
