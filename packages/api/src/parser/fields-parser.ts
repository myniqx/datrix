/**
 * Fields Parser
 *
 * Parses Strapi-style fields syntax into SelectClause.
 * Examples:
 *   ?fields[0]=name&fields[1]=email
 *   ?fields=name,email
 */

import type { RawQueryParams, FieldsParserResult } from 'forja-types/api/parser';
import { ParserError } from 'forja-types/api/parser';

/**
 * Parse fields parameter
 *
 * @param params - Raw query parameters
 * @returns Result with SelectClause or ParserError
 */
export function parseFields(params: RawQueryParams): FieldsParserResult {
  // Handle array format: fields[0]=name&fields[1]=email
  const arrayFields = extractArrayFields(params);
  if (arrayFields.length > 0) {
    return validateAndReturn(arrayFields);
  }

  // Check for fields parameter
  const fieldsParam = params['fields'];

  if (fieldsParam === undefined) {
    // No fields specified, return success with undefined (will select all)
    return { success: true, data: '*' };
  }

  // Handle wildcard
  if (fieldsParam === '*') {
    return { success: true, data: '*' };
  }

  // Handle comma-separated format: fields=name,email
  if (typeof fieldsParam === 'string') {
    const fields = fieldsParam.split(',').map((f) => f.trim()).filter(Boolean);
    return validateAndReturn(fields);
  }

  // Handle array (from frameworks that parse query strings into arrays)
  if (Array.isArray(fieldsParam)) {
    const fields = fieldsParam.map((f) => String(f).trim()).filter(Boolean);
    return validateAndReturn(fields);
  }

  // Invalid format
  return {
    success: false,
    error: new ParserError('Invalid fields format', {
      code: 'INVALID_SYNTAX',
      field: 'fields'
    })
  };
}

/**
 * Extract fields from array-style parameters
 * Handles: fields[0]=name&fields[1]=email
 */
function extractArrayFields(params: RawQueryParams): string[] {
  const fields: string[] = [];
  let index = 0;

  while (true) {
    const key = `fields[${index}]`;
    const value = params[key];

    if (value === undefined) {
      break;
    }

    if (typeof value === 'string') {
      fields.push(value.trim());
    } else if (Array.isArray(value)) {
      // Should not happen, but handle it
      fields.push(...value.map((v) => String(v).trim()));
    }

    index++;
  }

  return fields;
}

/**
 * Validate field names and return result
 */
function validateAndReturn(fields: readonly string[]): FieldsParserResult {
  if (fields.length === 0) {
    return { success: true, data: '*' };
  }

  // Validate field names (alphanumeric, underscores, dots for nested fields)
  const invalidFields = fields.filter((field) => !isValidFieldName(field));

  if (invalidFields.length > 0) {
    return {
      success: false,
      error: new ParserError(`Invalid field names: ${invalidFields.join(', ')}`, {
        code: 'INVALID_SYNTAX',
        field: 'fields',
        details: { invalidFields }
      })
    };
  }

  return { success: true, data: fields };
}

/**
 * Check if field name is valid
 * Allows: alphanumeric, underscores, dots (for nested fields)
 */
function isValidFieldName(field: string): boolean {
  if (!field || field.trim() === '') {
    return false;
  }

  // Allow alphanumeric, underscores, and dots
  // Must start with letter or underscore
  const pattern = /^[a-zA-Z_][a-zA-Z0-9_.]*$/;
  return pattern.test(field);
}

