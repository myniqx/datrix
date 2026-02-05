/**
 * Populate Parser
 *
 * Parses Strapi-style populate syntax into PopulateClause.
 * Examples:
 *   ?populate=*                                    -> populate all relations
 *   ?populate[profile]=*                           -> populate profile with all fields
 *   ?populate[profile][fields][0]=name             -> populate profile with specific fields
 *   ?populate[posts][populate][comments]=*         -> nested populate
 */

import type { RawQueryParams } from "forja-types/api/parser";
import { PopulateOptions } from "forja-types/core/query-builder";
import { validateFieldName } from "forja-types/core/constants";
import { populateError } from "./errors";

/**
 * Default max populate depth
 */
const DEFAULT_MAX_DEPTH = 5;

/**
 * Parse populate parameter
 * Throws ParserError on validation failure
 *
 * @param params - Raw query parameters
 * @param maxDepth - Maximum nesting depth (default: 5)
 * @returns PopulateClause or undefined
 * @throws {ParserError} When validation fails
 */
export function parsePopulate(
  params: RawQueryParams,
  maxDepth: number = DEFAULT_MAX_DEPTH,
): Record<string, PopulateOptions | "*"> | "*" | true | undefined {
  // Validate maxDepth
  if (maxDepth <= 0) {
    populateError.maxDepthExceeded(maxDepth, maxDepth, ["config"], {
      maxDepth,
    });
  }

  // Build populate clause
  const populateClause: Record<string, PopulateOptions | "*"> | true = {};

  // Check for simple populate parameter (string)
  const mainPopulate = params["populate"];
  if (mainPopulate !== undefined) {
    if (mainPopulate === "*") {
      return '*';
    }

    if (mainPopulate === 'true') {
      return true;
    }

    if (typeof mainPopulate === "string") {
      // Handle empty or whitespace-only string
      const trimmed = mainPopulate.trim();
      if (trimmed === "") {
        populateError.emptyValue([]);
      }

      // Handle comma-separated: populate=author,comments
      const relations = mainPopulate
        .split(",")
        .map((r) => r.trim())
        .filter(Boolean);
      for (const rel of relations) {
        // Validate relation name
        const validation = validateFieldName(rel);
        if (!validation.valid) {
          populateError.invalidRelation(rel, [rel], {
            fieldValidationReason: validation.reason,
          });
        }
        populateClause[rel] = "*";
      }
    } else if (Array.isArray(mainPopulate)) {
      // Handle array: populate[]=author&populate[]=comments
      for (const rel of mainPopulate) {
        if (rel && typeof rel === "string") {
          const trimmed = rel.trim();
          // Validate relation name
          const validation = validateFieldName(trimmed);
          if (!validation.valid) {
            populateError.invalidRelation(trimmed, [trimmed], {
              fieldValidationReason: validation.reason,
            });
          }
          populateClause[trimmed] = "*";
        }
      }
    } else {
      // Invalid type (number, object, etc.)
      populateError.invalidType(typeof mainPopulate, []);
    }
  }

  // Extract all populate parameters
  const populateParams = extractPopulateParams(params);

  // Parse each relation
  for (const [relation, relationParams] of Object.entries(populateParams)) {
    const parseResult = parseRelation(relation, relationParams, 1, maxDepth);
    populateClause[relation] = parseResult;
  }

  // If no populate parameters found at all, return undefined
  if (Object.keys(populateClause).length === 0) {
    return undefined;
  }

  return populateClause;
}

/**
 * Relation parameters extracted from query
 */
interface RelationParams {
  readonly fields?: readonly string[];
  readonly populate?: Record<string, RelationParams>;
  readonly isWildcard?: boolean;
}

/**
 * Extract populate parameters grouped by relation
 */
function extractPopulateParams(
  params: RawQueryParams,
): Record<string, RelationParams> {
  const relations: Record<string, Record<string, unknown>> = {};

  for (const [key, value] of Object.entries(params)) {
    if (!key.startsWith("populate[")) {
      continue;
    }

    // Parse: populate[relation][...][...]
    const parts = key.match(/populate\[([^\]]+)\](.*)$/);
    if (!parts) {
      continue;
    }

    const relation = parts[1];
    const rest = parts[2];

    if (!relation) {
      continue;
    }

    // Initialize relation if not exists
    if (relations[relation] === undefined) {
      relations[relation] = {};
    }

    // Check if this is a wildcard: populate[relation]=*
    if (rest === "" && value === "*") {
      relations[relation]["isWildcard"] = true;
      continue;
    }

    // Parse remaining path: [fields][0], [populate][comments], etc.
    if (rest !== undefined) {
      parseRelationPath(relations[relation], rest, value);
    }
  }

  return relations;
}

/**
 * Parse the path within a relation
 * Examples:
 *   [fields][0] -> add to fields array
 *   [populate][comments] -> nested populate
 */
function parseRelationPath(
  relationData: Record<string, unknown>,
  path: string,
  value: string | readonly string[] | undefined,
): void {
  if (path === "") {
    return;
  }

  // Match [key][...rest]
  const match = path.match(/^\[([^\]]+)\](.*)$/);
  if (!match) {
    return;
  }

  const key = match[1];
  const rest = match[2];

  if (key === "fields") {
    // Handle fields array
    if (relationData["fields"] === undefined) {
      relationData["fields"] = [];
    }

    const fieldsArray =
      Array.isArray(relationData["fields"]) ? relationData["fields"] : [];

    if (rest === "") {
      // populate[relation][fields]=* or comma-separated
      if (value === "*") {
        relationData["fields"] = "*";
      } else if (typeof value === "string") {
        const fields = value.split(",").map((f) => f.trim());
        // Validate each field
        for (const field of fields) {
          const validation = validateFieldName(field);
          if (!validation.valid) {
            populateError.invalidFieldName(field, ["fields"], {
              fieldValidationReason: validation.reason,
            });
          }
        }
        fieldsArray.push(...fields);
      }
    } else if (rest !== undefined) {
      // populate[relation][fields][0]=name
      const indexMatch = rest.match(/^\[(\d+)\]$/);
      if (indexMatch && typeof value === "string") {
        const field = value.trim();
        // Validate field name
        const validation = validateFieldName(field);
        if (!validation.valid) {
          populateError.invalidFieldName(field, ["fields"], {
            fieldValidationReason: validation.reason,
          });
        }
        fieldsArray.push(field);
      }
    }
  } else if (key === "populate") {
    // Handle nested populate
    if (relationData["populate"] === undefined) {
      relationData["populate"] = {};
    }

    const populateObj =
      (
        typeof relationData["populate"] === "object" &&
        !Array.isArray(relationData["populate"])
      ) ?
        (relationData["populate"] as Record<string, Record<string, unknown>>)
        : {};

    relationData["populate"] = populateObj;

    // Handle instructions for the current relation's populates
    if (rest === "") {
      if (value === "*") {
        // populate[relation][populate]=*
        relationData["isWildcard"] = true;
      } else if (typeof value === "string") {
        // populate[relation][populate]=profile,comments
        const relations = value
          .split(",")
          .map((r) => r.trim())
          .filter(Boolean);
        for (const rel of relations) {
          if (rel === "*") {
            relationData["isWildcard"] = true;
          } else if (populateObj[rel] === undefined) {
            populateObj[rel] = { isWildcard: true };
          }
        }
      }
    } else if (rest !== undefined) {
      // populate[relation][populate][nestedRelation]...
      const nestedMatch = rest.match(/^\[([^\]]+)\](.*)$/);
      if (nestedMatch) {
        const nestedRelation = nestedMatch[1];
        const nestedRest = nestedMatch[2];

        if (nestedRelation) {
          if (populateObj[nestedRelation] === undefined) {
            populateObj[nestedRelation] = {};
          }

          if (nestedRest === "" && value === "*") {
            populateObj[nestedRelation]["isWildcard"] = true;
          } else if (nestedRest !== undefined) {
            parseRelationPath(populateObj[nestedRelation], nestedRest, value);
          }
        }
      }
    }
  }
}

/**
 * Parse a single relation into PopulateOptions
 */
function parseRelation(
  relation: string,
  params: RelationParams,
  currentDepth: number,
  maxDepth: number,
  path: string[] = [],
): PopulateOptions | "*" {
  // Validate relation name
  const validation = validateFieldName(relation);
  if (!validation.valid) {
    populateError.invalidRelation(relation, [...path, relation], {
      relationPath: [...path, relation].join("."),
      fieldValidationReason: validation.reason,
    });
  }

  // Check depth
  if (currentDepth > maxDepth) {
    populateError.maxDepthExceeded(currentDepth, maxDepth, [...path, relation], {
      relation,
      relationPath: [...path, relation].join("."),
      currentDepth,
      nestedRelations: [...path, relation],
    });
  }

  // Handle wildcard
  if (params.isWildcard) {
    return "*";
  }

  const options: Record<string, unknown> = {};

  // Add fields if specified
  if (params.fields !== undefined) {
    if (typeof params.fields === "string" && params.fields === "*") {
      options["select"] = "*";
    } else if (Array.isArray(params.fields) && params.fields.length > 0) {
      options["select"] = params.fields;
    }
  }

  // Add nested populates
  if (params.populate !== undefined) {
    const nestedPopulate: Record<string, PopulateOptions | "*"> = {};

    for (const [nestedRelation, nestedParams] of Object.entries(
      params.populate,
    )) {
      nestedPopulate[nestedRelation] = parseRelation(
        nestedRelation,
        nestedParams,
        currentDepth + 1,
        maxDepth,
        [...path, relation],
      );
    }

    if (Object.keys(nestedPopulate).length > 0) {
      options["populate"] = nestedPopulate;
    }
  }

  // If no options specified, return wildcard
  if (Object.keys(options).length === 0) {
    return "*";
  }

  return options as PopulateOptions;
}
