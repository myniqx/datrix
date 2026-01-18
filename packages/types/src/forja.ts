import { DatabaseAdapter } from "./adapter";
import { ParsedQuery } from "./api/parser";
import { DevConfig, ForjaConfig, MigrationConfig } from "./config";
import { WhereClause } from "./core/query-builder";
import { SchemaRegistry } from "./core/schema";
import { ForjaPlugin } from "./plugin";
import { ForjaError, Result } from "./utils";

/**
 * Raw CRUD operations interface (bypasses plugin hooks)
 */
export interface IRawCrud {
  findOne<T>(
    model: string,
    where: WhereClause,
    options?: Pick<ParsedQuery, "select" | "populate">,
  ): Promise<T | null>;
  findById<T>(
    model: string,
    id: string | number,
    options?: Pick<ParsedQuery, "select" | "populate">,
  ): Promise<T | null>;
  findMany<T>(
    model: string,
    options?: Pick<
      ParsedQuery,
      "where" | "select" | "populate" | "orderBy" | "limit" | "offset"
    >,
  ): Promise<T[]>;
  count(model: string, where?: WhereClause): Promise<number>;
  create<T>(model: string, data: Record<string, unknown>): Promise<T>;
  update<T>(
    model: string,
    id: string | number,
    data: Record<string, unknown>,
  ): Promise<T>;
  updateMany(
    model: string,
    where: WhereClause,
    data: Record<string, unknown>,
  ): Promise<number>;
  delete(model: string, id: string | number): Promise<boolean>;
  deleteMany(model: string, where: WhereClause): Promise<number>;
}

/**
 * Forja Main Singleton Class
 */
export interface IForja {
  shutdown(): Promise<Result<void, ForjaError>>;
  getConfig(): ForjaConfig;
  getAdapter<T extends DatabaseAdapter = DatabaseAdapter>(): T;
  getPlugins(): readonly ForjaPlugin[];
  getPlugin(name: string): ForjaPlugin | null;
  hasPlugin(name: string): boolean;
  getSchemas(): SchemaRegistry;
  getMigrationConfig(): Required<MigrationConfig>;
  getDevConfig(): Required<DevConfig>;
  isInitialized(): boolean;
  findOne<T>(
    model: string,
    where: WhereClause,
    options?: Pick<ParsedQuery, "select" | "populate">,
  ): Promise<T | null>;
  findById<T>(
    model: string,
    id: string | number,
    options?: Pick<ParsedQuery, "select" | "populate">,
  ): Promise<T | null>;
  findMany<T>(
    model: string,
    options?: Pick<
      ParsedQuery,
      "where" | "select" | "populate" | "orderBy" | "limit" | "offset"
    >,
  ): Promise<T[]>;
  create<T>(
    model: string,
    data: object,
    options?: Pick<ParsedQuery, "select" | "populate">,
  ): Promise<T>;
  update<T>(
    model: string,
    id: string | number,
    data: object,
    options?: Pick<ParsedQuery, "select" | "populate">,
  ): Promise<T | null>;
  delete(
    model: string,
    id: string | number,
    options?: Pick<ParsedQuery, "select" | "populate">,
  ): Promise<boolean>;
  count(
    model: string,
    where?: WhereClause,
    options?: Pick<ParsedQuery, "where">,
  ): Promise<number>;

  /**
   * Raw CRUD operations (bypasses plugin hooks)
   *
   * Use this when you need direct database access without
   * triggering onBeforeQuery/onAfterQuery plugin hooks.
   */
  readonly raw: IRawCrud;
}
