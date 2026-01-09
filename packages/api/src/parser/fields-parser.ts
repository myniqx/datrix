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
import {
  MAX_FIELD_NAME_LENGTH,
  MAX_ARRAY_INDEX,
  isValidFieldName,
} from 'forja-types/core/constants';

/**
 * Parse fields parameter
 *
 * @param params - Raw query parameters
 * @returns Result with SelectClause or ParserError
 */
export function parseFields(params: RawQueryParams): FieldsParserResult {
  // Check for suspicious parameters (fields[extra], fields_injection, etc.)
  const suspiciousParams = Object.keys(params).filter(
    (key) =>
      key.startsWith('fields') &&
      key !== 'fields' &&
      !key.match(/^fields\[\d+\]$/) // Allow fields[0], fields[1], etc.
  );

  if (suspiciousParams.length > 0) {
    return {
      success: false,
      error: new ParserError(`Unknown fields parameters: ${suspiciousParams.join(', ')}`, {
        code: 'INVALID_SYNTAX',
        field: 'fields',
        details: { suspiciousParams }
      })
    };
  }

  // Handle array format: fields[0]=name&fields[2]=email (sparse arrays allowed)
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

    // Reject if all fields are empty after trimming
    if (fields.length === 0) {
      return {
        success: false,
        error: new ParserError('Fields parameter is empty or contains only whitespace', {
          code: 'INVALID_SYNTAX',
          field: 'fields'
        })
      };
    }

    return validateAndReturn(fields);
  }

  // Handle array (from frameworks that parse query strings into arrays)
  if (Array.isArray(fieldsParam)) {
    const fields = fieldsParam.map((f) => String(f).trim()).filter(Boolean);

    // Reject if all fields are empty after trimming
    if (fields.length === 0) {
      return {
        success: false,
        error: new ParserError('Fields parameter is empty or contains only whitespace', {
          code: 'INVALID_SYNTAX',
          field: 'fields'
        })
      };
    }

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
 * Handles sparse arrays: fields[0]=name&fields[2]=email (fields[1] can be missing)
 *
 * This allows UI checkboxes where users select specific fields,
 * resulting in non-sequential indices.
 */
function extractArrayFields(params: RawQueryParams): string[] {
  const fields: string[] = [];

  // Find all fields[N] parameters
  for (const key in params) {
    const match = key.match(/^fields\[(\d+)\]$/);
    if (!match) continue;

    const index = parseInt(match[1], 10);

    // Prevent DoS attacks with extremely large indices
    if (index >= MAX_ARRAY_INDEX) {
      continue; // Skip invalid indices
    }

    const value = params[key];
    if (typeof value === 'string') {
      fields.push(value.trim());
    } else if (Array.isArray(value)) {
      // Framework might parse duplicate params as array
      fields.push(...value.map((v) => String(v).trim()));
    }
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

// Field validation is now centralized in forja-types/core/constants
// isValidFieldName() is imported from there

