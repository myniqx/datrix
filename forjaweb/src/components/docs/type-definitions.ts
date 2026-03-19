/**
 * Type definitions for hover tooltips in docs.
 * Each key is a type name (with or without generics), value is the popup content.
 */

export interface TypeDefinition {
  signature: string;
  description?: string;
  /** Link to the full docs page, e.g. "/docs/core/types#whereclause" */
  docsPath?: string;
}

export const TYPE_DEFINITIONS: Record<string, TypeDefinition> = {
  // Primitives
  string: {
    signature: "string",
    description: "A JavaScript string value.",
  },
  number: {
    signature: "number",
    description: "A JavaScript number value (integer or float).",
  },
  boolean: {
    signature: "boolean",
    description: "true or false.",
  },

  // Forja core types
  "ForjaEntry": {
    signature: `interface ForjaEntry {\n  id:        number\n  createdAt: Date\n  updatedAt: Date\n}`,
    description: "Base type every record extends. Fields are injected automatically and cannot be written manually.",
    docsPath: "/docs/core/types#forjaentry",
  },
  "RawCrudOptions": {
    signature: `interface RawCrudOptions<T> {\n  select?:   SelectClause<T>\n  populate?: PopulateClause<T>\n}`,
    description: "Options for single-record operations (findOne, findById, create, update, delete).",
    docsPath: "/docs/core/types#rawcrudoptions",
  },
  "RawFindManyOptions": {
    signature: `interface RawFindManyOptions<T> extends RawCrudOptions<T> {\n  where?:   WhereClause<T>\n  orderBy?: OrderByClause<T>\n  limit?:   number\n  offset?:  number\n}`,
    description: "Options for findMany. Extends RawCrudOptions with filtering and pagination.",
    docsPath: "/docs/core/types#rawfindmanyoptions",
  },
  "WhereClause": {
    signature: `type WhereClause<T> =\n  | { [K in keyof T]?: FieldFilter | T[K] }\n  | { $and: WhereClause<T>[] }\n  | { $or:  WhereClause<T>[] }\n  | { $not: WhereClause<T> }`,
    description: "Filter expression. Supports direct values, comparison operators ($eq, $gt, $in…), logical operators ($and, $or, $not), and nested relation conditions.",
    docsPath: "/docs/core/types#whereclause",
  },
  "SelectClause": {
    signature: `type SelectClause<T> =\n  | (keyof T)[]\n  | keyof T\n  | "*"`,
    description: 'Fields to return. Use "*" for all fields. Relation fields cannot appear here — use populate instead.',
    docsPath: "/docs/core/types#selectclause",
  },
  "PopulateClause": {
    signature: `type PopulateClause<T> =\n  | true\n  | "*"\n  | (string)[]\n  | { [relation: string]: true | PopulateOptions }`,
    description: "Relations to load alongside the main record. Supports true, \"*\", array of names, or object with per-relation options.",
    docsPath: "/docs/core/types#populateclause",
  },
  "OrderByClause": {
    signature: `type OrderByClause<T> =\n  | { field: keyof T; direction: "asc" | "desc"; nulls?: "first" | "last" }[]\n  | { [K in keyof T]?: "asc" | "desc" }\n  | string[]`,
    description: 'Sort order. Three formats: full object array, shorthand object, or string array ("-field" for desc).',
    docsPath: "/docs/core/types#orderbyclause",
  },
  "FallbackInput": {
    signature: `type FallbackInput = {\n  [key: string]: string | number | boolean | Date | null | AnyRelationInput\n}`,
    description: "Default input type when no generic is provided. Allows any scalar or relation value.",
    docsPath: "/docs/core/types#fallbackinput",
  },
};

/**
 * Normalize a type token to look up in TYPE_DEFINITIONS.
 * Strips generic parameters: "RawCrudOptions<T>" → "RawCrudOptions"
 */
export function normalizeTypeName(token: string): string {
  return token.replace(/<.*>/, "").trim();
}
