/**
 * PostgreSQL Populator
 *
 * Main orchestrator for populate functionality.
 * Decides strategy based on query complexity and executes accordingly.
 */

import type { Pool } from "pg";
import type { QueryObject, PopulateClause } from "forja-types/core/query-builder";
import type { SchemaRegistry } from "forja-core/schema";
import type { PostgresQueryTranslator } from "../query-translator";
import type {
  PopulateStrategy,
  PopulateOptionsAnalysis,
  ProcessedResult,
} from "./types";
import { JoinBuilder } from "./join-builder";
import { AggregationBuilder } from "./aggregation-builder";
import { ResultProcessor } from "./result-processor";
import { throwMaxDepthExceeded } from "../error-helper";

/**
 * Maximum populate nesting depth
 */
const MAX_POPULATE_DEPTH = 5;

/**
 * PostgreSQL Populator Class
 *
 * Handles all populate operations with strategy selection:
 * - JSON Aggregation: Single query with json_agg() for simple cases
 * - LATERAL Joins: Complex populate options (limit, offset, where, orderBy)
 * - Separate Queries: Fallback for very deep nesting (>3 levels)
 *
 * @example
 * ```ts
 * const populator = new PostgresPopulator(pool, translator, schemaRegistry);
 * const results = await populator.populate(query);
 * ```
 */
export class PostgresPopulator {
  private joinBuilder: JoinBuilder;
  private aggregationBuilder: AggregationBuilder;
  private resultProcessor: ResultProcessor;

  constructor(
    private pool: Pool,
    private translator: PostgresQueryTranslator,
    private schemaRegistry: SchemaRegistry,
  ) {
    this.joinBuilder = new JoinBuilder(schemaRegistry, translator);
    this.aggregationBuilder = new AggregationBuilder(translator, schemaRegistry);
    this.resultProcessor = new ResultProcessor(schemaRegistry);
  }

  /**
   * Main entry point for populate
   *
   * Analyzes query, selects strategy, and executes populate
   *
   * @param query - Query object with populate
   * @returns Rows with populated relations
   */
  async populate<T extends Record<string, unknown>>(
    query: QueryObject,
  ): Promise<readonly T[]> {
    if (!query.populate) {
      return [] as readonly T[];
    }

    // Analyze populate requirements
    const analysis = this.analyzePopulate(query.populate);

    // Check max depth
    if (analysis.maxDepth > MAX_POPULATE_DEPTH) {
      throwMaxDepthExceeded(
        analysis.maxDepth,
        MAX_POPULATE_DEPTH,
        this.buildRelationPath(query.populate),
      );
    }

    // Select strategy
    const strategy = this.selectStrategy(analysis);

    // Execute based on strategy
    switch (strategy) {
      case "json-aggregation":
        return this.executeJsonAggregation<T>(query);
      case "lateral-joins":
        return this.executeLateralJoins<T>(query);
      case "separate-queries":
        return this.executeSeparateQueries<T>(query);
    }
  }

  /**
   * Strategy 1: JSON Aggregation (Default, Most Performant)
   *
   * Uses json_agg() and row_to_json() for single-query populate.
   * Best for simple cases without complex populate options.
   *
   * SQL Example:
   * ```sql
   * SELECT
   *   posts.*,
   *   row_to_json(users.*) as author,
   *   json_agg(DISTINCT comments.*) FILTER (WHERE comments.id IS NOT NULL) as comments
   * FROM posts
   * LEFT JOIN users ON posts.author_id = users.id
   * LEFT JOIN comments ON posts.id = comments.post_id
   * GROUP BY posts.id, users.id
   * ```
   */
  private async executeJsonAggregation<T extends Record<string, unknown>>(
    query: QueryObject,
  ): Promise<readonly T[]> {
    // Build modified query with JOINs and aggregations
    const modifiedQuery = this.buildJsonAggregationQuery(query);

    // Execute query
    const { sql, params } = this.translator.translate(modifiedQuery);
    const result = await this.pool.query(sql, params as unknown[]);

    // Process results (parse JSON fields)
    const processed = this.resultProcessor.processJsonAggregation<T>(
      result.rows as T[],
      query.populate!,
    );

    return processed;
  }

  /**
   * Strategy 2: LATERAL Joins (Complex Options)
   *
   * Uses LATERAL joins for populate with limit/offset/where/orderBy.
   * Allows per-relation options while maintaining single query.
   *
   * SQL Example:
   * ```sql
   * SELECT
   *   posts.*,
   *   related_comments.data as comments
   * FROM posts
   * LEFT JOIN LATERAL (
   *   SELECT json_agg(row_to_json(c.*)) as data
   *   FROM (
   *     SELECT comments.*
   *     FROM comments
   *     WHERE comments.post_id = posts.id
   *       AND comments.status = 'approved'
   *     ORDER BY comments.created_at DESC
   *     LIMIT 5
   *   ) c
   * ) related_comments ON true
   * ```
   */
  private async executeLateralJoins<T extends Record<string, unknown>>(
    query: QueryObject,
  ): Promise<readonly T[]> {
    // Build modified query with LATERAL JOINs
    const modifiedQuery = this.buildLateralJoinsQuery(query);

    // Execute query
    const { sql, params } = this.translator.translate(modifiedQuery);
    const result = await this.pool.query(sql, params as unknown[]);

    // Process results (parse JSON fields)
    const processed = this.resultProcessor.processJsonAggregation<T>(
      result.rows as T[],
      query.populate!,
    );

    return processed;
  }

  /**
   * Strategy 3: Separate Queries (Fallback for Deep Nesting)
   *
   * Executes separate queries for each relation (N+1 pattern).
   * Fallback for very deep nesting or when other strategies fail.
   *
   * Less performant but more reliable for complex cases.
   */
  private async executeSeparateQueries<T extends Record<string, unknown>>(
    query: QueryObject,
  ): Promise<readonly T[]> {
    // First, execute main query
    const mainResult = await this.pool.query(
      this.translator.translate(query).sql,
      this.translator.translate(query).params as unknown[],
    );

    const rows = mainResult.rows as T[];

    if (rows.length === 0) {
      return rows;
    }

    // Then, populate each relation separately
    await this.populateSeparately(rows, query.table, query.populate!);

    return rows;
  }

  /**
   * Populate relations using separate queries (recursive)
   */
  private async populateSeparately(
    rows: Record<string, unknown>[],
    tableName: string,
    populate: PopulateClause,
    depth = 0,
  ): Promise<void> {
    if (depth > MAX_POPULATE_DEPTH) {
      throwMaxDepthExceeded(
        depth,
        MAX_POPULATE_DEPTH,
        this.buildRelationPath(populate),
      );
    }

    // Get schema
    const modelName = this.schemaRegistry.findModelByTableName(tableName);
    if (!modelName) return;

    const schema = this.schemaRegistry.get(modelName);
    if (!schema) return;

    // Process each relation
    for (const [relationName, options] of Object.entries(populate)) {
      const relationField = schema.fields[relationName];
      if (!relationField || relationField.type !== "relation") continue;

      // TODO: Implement separate query logic for each relation type
      // This is the fallback strategy, similar to JsonAdapter approach
    }
  }

  /**
   * Build query with JSON aggregation
   */
  private buildJsonAggregationQuery(query: QueryObject): QueryObject {
    const joins = this.joinBuilder.buildJoins(query, "json-aggregation");
    const aggregations = this.aggregationBuilder.buildAggregations(
      query.table,
      query.populate!,
    );

    const joinSQL = this.joinBuilder.generateJoinSQL(joins);
    const aggregationSQL = this.aggregationBuilder.generateAggregationSQL(aggregations);

    return {
      ...query,
      _metadata: {
        ...query._metadata,
        populateJoins: joinSQL,
        populateAggregations: aggregationSQL,
      },
    };
  }

  /**
   * Build query with LATERAL joins
   */
  private buildLateralJoinsQuery(query: QueryObject): QueryObject {
    return {
      ...query,
      _metadata: {
        ...query._metadata,
        populateStrategy: "lateral-joins" as const,
        populateClause: query.populate,
      },
    };
  }

  /**
   * Analyze populate requirements
   *
   * Determines:
   * - Max nesting depth
   * - Whether complex options are used
   * - Whether LATERAL joins are needed
   * - Number of relations
   */
  private analyzePopulate(populate: PopulateClause): PopulateOptionsAnalysis {
    let maxDepth = 1;
    let hasComplexOptions = false;
    let relationCount = 0;

    const analyze = (pop: PopulateClause, depth: number): void => {
      if (depth > maxDepth) {
        maxDepth = depth;
      }

      for (const [_relationName, options] of Object.entries(pop)) {
        relationCount++;

        // Check for complex options
        if (typeof options === "object" && options !== null) {
          if (
            "limit" in options ||
            "offset" in options ||
            "where" in options ||
            "orderBy" in options
          ) {
            hasComplexOptions = true;
          }

          // Recursive nested populate
          if ("populate" in options && options.populate) {
            analyze(options.populate, depth + 1);
          }
        }
      }
    };

    analyze(populate, 1);

    return {
      hasComplexOptions,
      maxDepth,
      requiresLateral: hasComplexOptions,
      requiresSeparateQueries: maxDepth > 3,
      relationCount,
    };
  }

  /**
   * Select populate strategy based on analysis
   */
  private selectStrategy(analysis: PopulateOptionsAnalysis): PopulateStrategy {
    // Deep nesting: use separate queries
    if (analysis.requiresSeparateQueries) {
      return "separate-queries";
    }

    // Complex options: use LATERAL joins
    if (analysis.requiresLateral) {
      return "lateral-joins";
    }

    // Default: JSON aggregation
    return "json-aggregation";
  }

  /**
   * Build relation path string for error messages
   */
  private buildRelationPath(populate: PopulateClause, prefix = ""): string {
    const paths: string[] = [];

    for (const [relationName, options] of Object.entries(populate)) {
      const currentPath = prefix ? `${prefix}.${relationName}` : relationName;
      paths.push(currentPath);

      if (typeof options === "object" && options.populate) {
        paths.push(...this.buildRelationPath(options.populate, currentPath).split(", "));
      }
    }

    return paths.join(", ");
  }
}
