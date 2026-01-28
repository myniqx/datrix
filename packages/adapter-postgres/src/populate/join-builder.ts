/**
 * PostgreSQL JOIN Builder
 *
 * Generates SQL JOIN clauses for populate functionality.
 * Supports all relation types: belongsTo, hasOne, hasMany, manyToMany.
 */

import type { QueryObject, PopulateClause } from "forja-types/core/query-builder";
import type { SchemaRegistry } from "forja-core/schema";
import type { RelationField } from "forja-types/core/schema";
import type { PostgresQueryTranslator } from "../query-translator";
import type { JoinClause, PopulateStrategy } from "./types";
import {
  throwModelNotFound,
  throwSchemaNotFound,
  throwRelationNotFound,
  throwInvalidRelationType,
  throwTargetModelNotFound,
  throwJoinBuildError,
  throwJunctionTableNotFound,
} from "../error-helper";

/**
 * JOIN Builder Class
 *
 * Generates optimized JOIN clauses for different populate strategies.
 */
export class JoinBuilder {
  constructor(
    private schemaRegistry: SchemaRegistry,
    private translator: PostgresQueryTranslator,
  ) {}

  /**
   * Build all JOINs for a query
   *
   * @param query - Query with populate
   * @param strategy - Populate strategy
   * @returns Array of JOIN clauses
   */
  buildJoins(
    query: QueryObject,
    strategy: PopulateStrategy,
  ): readonly JoinClause[] {
    if (!query.populate) {
      return [];
    }

    // Get current schema
    const modelName = this.schemaRegistry.findModelByTableName(query.table);
    if (!modelName) {
      throwModelNotFound(query.table);
    }

    const schema = this.schemaRegistry.get(modelName);
    if (!schema) {
      throwSchemaNotFound(modelName);
    }

    const joins: JoinClause[] = [];

    // Build JOIN for each relation
    for (const [relationName, options] of Object.entries(query.populate)) {
      // Get relation field
      const relationField = schema.fields[relationName];
      if (!relationField) {
        throwRelationNotFound(relationName, schema.name);
      }

      if (relationField.type !== "relation") {
        throwInvalidRelationType(relationName, relationField.type, schema.name);
      }

      const relField = relationField as RelationField;

      // Build JOIN based on strategy and relation kind
      const joinClauses = this.buildRelationJoin(
        query.table,
        relationName,
        relField,
        strategy,
        options,
      );

      joins.push(...joinClauses);
    }

    return joins;
  }

  /**
   * Build JOIN for a specific relation
   */
  private buildRelationJoin(
    sourceTable: string,
    relationName: string,
    relation: RelationField,
    strategy: PopulateStrategy,
    options: unknown,
  ): JoinClause[] {
    try {
      switch (relation.kind) {
        case "belongsTo":
          return this.buildBelongsToJoin(sourceTable, relationName, relation);

        case "hasOne":
          if (strategy === "lateral-joins" && this.hasComplexOptions(options)) {
            return this.buildHasOneLateralJoin(
              sourceTable,
              relationName,
              relation,
              options,
            );
          }
          return this.buildHasOneJoin(sourceTable, relationName, relation);

        case "hasMany":
          if (strategy === "lateral-joins" && this.hasComplexOptions(options)) {
            return this.buildHasManyLateralJoin(
              sourceTable,
              relationName,
              relation,
              options,
            );
          }
          return this.buildHasManyJoin(sourceTable, relationName, relation);

        case "manyToMany":
          if (strategy === "lateral-joins" && this.hasComplexOptions(options)) {
            return this.buildManyToManyLateralJoin(
              sourceTable,
              relationName,
              relation,
              options,
            );
          }
          return this.buildManyToManyJoin(sourceTable, relationName, relation);

        default:
          throwJoinBuildError(relationName, relation.kind);
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes("ADAPTER_")) {
        throw error;
      }
      throwJoinBuildError(
        relationName,
        relation.kind,
        error instanceof Error ? error : undefined,
      );
    }
  }

  /**
   * Build JOIN for belongsTo relation
   *
   * Source has FK: source.foreignKey = target.id
   *
   * Example: Post.authorId -> User.id
   * LEFT JOIN users ON posts.author_id = users.id
   */
  private buildBelongsToJoin(
    sourceTable: string,
    relationName: string,
    relation: RelationField,
  ): JoinClause[] {
    // Get target schema
    const targetSchema = this.schemaRegistry.get(relation.model);
    if (!targetSchema) {
      throwTargetModelNotFound(relation.model, relationName, sourceTable);
    }

    const targetTable = targetSchema.tableName ?? relation.model.toLowerCase();
    const foreignKey = relation.foreignKey!;

    const sourceTableEsc = this.translator.escapeIdentifier(sourceTable);
    const targetTableEsc = this.translator.escapeIdentifier(targetTable);
    const foreignKeyEsc = this.translator.escapeIdentifier(foreignKey);
    const relationAlias = this.translator.escapeIdentifier(relationName);

    const condition = `${sourceTableEsc}.${foreignKeyEsc} = ${relationAlias}."id"`;

    return [
      {
        type: "LEFT JOIN",
        table: targetTable,
        alias: relationName,
        condition,
        isLateral: false,
      },
    ];
  }

  /**
   * Build JOIN for hasOne relation
   *
   * Target has FK: source.id = target.foreignKey
   *
   * Example: User.id <- Profile.userId
   * LEFT JOIN profiles ON users.id = profiles.user_id
   */
  private buildHasOneJoin(
    sourceTable: string,
    relationName: string,
    relation: RelationField,
  ): JoinClause[] {
    // Get target schema
    const targetSchema = this.schemaRegistry.get(relation.model);
    if (!targetSchema) {
      throwTargetModelNotFound(relation.model, relationName, sourceTable);
    }

    const targetTable = targetSchema.tableName ?? relation.model.toLowerCase();
    const foreignKey = relation.foreignKey!;

    const sourceTableEsc = this.translator.escapeIdentifier(sourceTable);
    const targetTableEsc = this.translator.escapeIdentifier(targetTable);
    const foreignKeyEsc = this.translator.escapeIdentifier(foreignKey);
    const relationAlias = this.translator.escapeIdentifier(relationName);

    const condition = `${sourceTableEsc}."id" = ${relationAlias}.${foreignKeyEsc}`;

    return [
      {
        type: "LEFT JOIN",
        table: targetTable,
        alias: relationName,
        condition,
        isLateral: false,
      },
    ];
  }

  /**
   * Build JOIN for hasMany relation
   *
   * Target has FK: source.id = target.foreignKey
   * Uses LEFT JOIN (aggregation happens in SELECT)
   *
   * Example: User.id <- Post.authorId
   * LEFT JOIN posts ON users.id = posts.author_id
   */
  private buildHasManyJoin(
    sourceTable: string,
    relationName: string,
    relation: RelationField,
  ): JoinClause[] {
    // Same as hasOne but with aggregation in SELECT clause
    return this.buildHasOneJoin(sourceTable, relationName, relation);
  }

  /**
   * Build LATERAL JOIN for hasOne with complex options
   *
   * Allows limit, offset, where, orderBy on the relation
   */
  private buildHasOneLateralJoin(
    sourceTable: string,
    relationName: string,
    relation: RelationField,
    _options: unknown,
  ): JoinClause[] {
    // Get target schema
    const targetSchema = this.schemaRegistry.get(relation.model);
    if (!targetSchema) {
      throwTargetModelNotFound(relation.model, relationName, sourceTable);
    }

    const targetTable = targetSchema.tableName ?? relation.model.toLowerCase();
    const foreignKey = relation.foreignKey!;

    const sourceTableEsc = this.translator.escapeIdentifier(sourceTable);
    const targetTableEsc = this.translator.escapeIdentifier(targetTable);
    const foreignKeyEsc = this.translator.escapeIdentifier(foreignKey);
    const relationAlias = this.translator.escapeIdentifier(relationName);

    // LATERAL JOIN allows subquery to reference outer query
    const condition = `${sourceTableEsc}."id" = ${targetTableEsc}.${foreignKeyEsc}`;

    // Note: The actual subquery with options is built in aggregation-builder.ts
    // This just creates the JOIN structure
    return [
      {
        type: "LATERAL",
        table: targetTable,
        alias: `${relationName}_lateral`,
        condition,
        isLateral: true,
      },
    ];
  }

  /**
   * Build LATERAL JOIN for hasMany with complex options
   */
  private buildHasManyLateralJoin(
    sourceTable: string,
    relationName: string,
    relation: RelationField,
    options: unknown,
  ): JoinClause[] {
    // Same as hasOne LATERAL but with json_agg in subquery
    return this.buildHasOneLateralJoin(
      sourceTable,
      relationName,
      relation,
      options,
    );
  }

  /**
   * Build JOIN for manyToMany relation
   *
   * Requires junction table: source.id = junction.sourceFK
   *                          junction.targetFK = target.id
   *
   * Example: Post <-> Tag via post_tags
   * LEFT JOIN post_tags ON posts.id = post_tags.post_id
   * LEFT JOIN tags ON post_tags.tag_id = tags.id
   */
  private buildManyToManyJoin(
    sourceTable: string,
    relationName: string,
    relation: RelationField,
  ): JoinClause[] {
    // Get target schema
    const targetSchema = this.schemaRegistry.get(relation.model);
    if (!targetSchema) {
      throwTargetModelNotFound(relation.model, relationName, sourceTable);
    }

    const targetTable = targetSchema.tableName ?? relation.model.toLowerCase();
    const junctionTable = relation.through!;

    // Get current schema to determine FK names
    const currentModelName = this.schemaRegistry.findModelByTableName(sourceTable);
    if (!currentModelName) {
      throwModelNotFound(sourceTable);
    }

    const currentSchema = this.schemaRegistry.get(currentModelName);
    if (!currentSchema) {
      throwSchemaNotFound(currentModelName);
    }

    // Foreign key names in junction table: {ModelName}Id
    const sourceFK = `${currentSchema.name}Id`;
    const targetFK = `${relation.model}Id`;

    // Check if junction table exists
    const junctionModelName =
      this.schemaRegistry.findModelByTableName(junctionTable);
    if (!junctionModelName) {
      throwJunctionTableNotFound(junctionTable, relationName, currentSchema.name);
    }

    // Escape identifiers
    const sourceTableEsc = this.translator.escapeIdentifier(sourceTable);
    const junctionTableEsc = this.translator.escapeIdentifier(junctionTable);
    const targetTableEsc = this.translator.escapeIdentifier(targetTable);
    const sourceFKEsc = this.translator.escapeIdentifier(sourceFK);
    const targetFKEsc = this.translator.escapeIdentifier(targetFK);
    const relationAlias = this.translator.escapeIdentifier(relationName);
    const junctionAlias = `${relationName}_junction`;
    const junctionAliasEsc = this.translator.escapeIdentifier(junctionAlias);

    // Two JOINs needed
    return [
      // First: source -> junction
      {
        type: "LEFT JOIN",
        table: junctionTable,
        alias: junctionAlias,
        condition: `${sourceTableEsc}."id" = ${junctionAliasEsc}.${sourceFKEsc}`,
        isLateral: false,
      },
      // Second: junction -> target
      {
        type: "LEFT JOIN",
        table: targetTable,
        alias: relationName,
        condition: `${junctionAliasEsc}.${targetFKEsc} = ${relationAlias}."id"`,
        isLateral: false,
      },
    ];
  }

  /**
   * Build LATERAL JOIN for manyToMany with complex options
   */
  private buildManyToManyLateralJoin(
    sourceTable: string,
    relationName: string,
    relation: RelationField,
    _options: unknown,
  ): JoinClause[] {
    // Get schemas
    const targetSchema = this.schemaRegistry.get(relation.model);
    if (!targetSchema) {
      throwTargetModelNotFound(relation.model, relationName, sourceTable);
    }

    const targetTable = targetSchema.tableName ?? relation.model.toLowerCase();
    const junctionTable = relation.through!;

    const currentModelName = this.schemaRegistry.findModelByTableName(sourceTable);
    if (!currentModelName) {
      throwModelNotFound(sourceTable);
    }

    const currentSchema = this.schemaRegistry.get(currentModelName);
    if (!currentSchema) {
      throwSchemaNotFound(currentModelName);
    }

    // Check junction table exists
    const junctionModelName =
      this.schemaRegistry.findModelByTableName(junctionTable);
    if (!junctionModelName) {
      throwJunctionTableNotFound(junctionTable, relationName, currentSchema.name);
    }

    // For LATERAL, we'll use a subquery that handles the junction internally
    const sourceTableEsc = this.translator.escapeIdentifier(sourceTable);

    return [
      {
        type: "LATERAL",
        table: targetTable,
        alias: `${relationName}_lateral`,
        condition: `${sourceTableEsc}."id" IS NOT NULL`, // Placeholder, actual condition in subquery
        isLateral: true,
      },
    ];
  }

  /**
   * Check if populate options include complex features
   */
  private hasComplexOptions(options: unknown): boolean {
    if (typeof options !== "object" || options === null) {
      return false;
    }

    const opts = options as Record<string, unknown>;

    return (
      "limit" in opts ||
      "offset" in opts ||
      "where" in opts ||
      "orderBy" in opts
    );
  }

  /**
   * Generate SQL string from JOIN clauses
   */
  generateJoinSQL(joins: readonly JoinClause[]): string {
    return joins
      .map((join) => {
        const tableEsc = this.translator.escapeIdentifier(join.table);
        const aliasEsc = this.translator.escapeIdentifier(join.alias);

        if (join.isLateral) {
          // LATERAL joins handled by AggregationBuilder
          return "";
        }

        return `${join.type} ${tableEsc} AS ${aliasEsc} ON ${join.condition}`;
      })
      .filter((sql) => sql !== "")
      .join(" ");
  }
}
