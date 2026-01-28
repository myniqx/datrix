/**
 * Query Serializer
 *
 * Converts ParsedQuery objects into Strapi-style query strings (RawQueryParams).
 */

import { ForjaEntry, ForjaRecord } from 'forja-types';
import { ParsedQuery, RawQueryParams } from 'forja-types/api/parser';
import { WhereClause, PopulateClause, PopulateOptions, QueryPrimitive } from 'forja-types/core/query-builder';

export function queryToParams<T extends ForjaEntry = ForjaRecord>(query: ParsedQuery<T> | undefined): string {
  if (!query) return '';

  const serialized = serializeQuery(query);

  const params = new URLSearchParams();
  Object.entries(serialized).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((v) => params.append(key, v));
    } else if (value !== undefined) {
      params.append(key, value as string);
    }
  });

  return params.toString();
}

/**
 * Serialize ParsedQuery into RawQueryParams (Strapi-style)
 * 
 * @param query - The parsed query object to serialize
 * @returns Records of query parameters
 */
export function serializeQuery<T extends ForjaEntry = ForjaEntry>(query: ParsedQuery<T>): RawQueryParams {
  const params: Record<string, string | string[]> = {};

  // 1. Fields (select)
  if (query.select) {
    if (query.select === '*') {
      params['fields'] = '*';
    } else if (Array.isArray(query.select)) {
      params['fields'] = query.select.join(',');
    }
  }

  // 2. Where
  if (query.where) {
    serializeWhere(query.where, 'where', params);
  }

  // 3. Populate
  if (query.populate) {
    serializePopulate(query.populate, 'populate', params);
  }

  // 4. OrderBy (sort)
  if (query.orderBy && Array.isArray(query.orderBy)) {
    const sortStrings = query.orderBy.map(item => {
      return item.direction === 'desc' ? `-${item.field}` : item.field;
    });
    if (sortStrings.length > 0) {
      params['sort'] = sortStrings.join(',');
    }
  }

  // 5. Pagination
  if (query.limit !== undefined) params['limit'] = String(query.limit);
  if (query.offset !== undefined) params['offset'] = String(query.offset);
  if (query.page !== undefined) params['page'] = String(query.page);
  if (query.pageSize !== undefined) params['pageSize'] = String(query.pageSize);

  return params;
}

/**
 * Recursive helper to serialize where clause
 */
function serializeWhere<T extends ForjaEntry>(where: WhereClause<T> | QueryPrimitive | readonly WhereClause<T>[], prefix: string, params: Record<string, string | string[]>) {
  if (where === null || typeof where !== 'object') {
    params[prefix] = String(where);
    return;
  }

  for (const [key, value] of Object.entries(where)) {
    const newPrefix = `${prefix}[${key}]`;

    if (Array.isArray(value)) {
      // Handle logical operators like $or, $and, $not which take arrays of conditions
      if (['$or', '$and', '$not'].includes(key)) {
        value.forEach((item, index) => {
          serializeWhere(item, `${newPrefix}[${index}]`, params);
        });
      } else {
        // Handle $in, $nin which take arrays of values
        value.forEach((item, index) => {
          params[`${newPrefix}[${index}]`] = String(item);
        });
      }
    } else if (value !== null && typeof value === 'object') {
      serializeWhere(value, newPrefix, params);
    } else {
      params[newPrefix] = String(value);
    }
  }
}

/**
 * Recursive helper to serialize populate clause
 */
function serializePopulate(populate: PopulateClause | '*', prefix: string, params: Record<string, string | string[]>) {
  if (populate === '*') {
    params[prefix] = '*';
    return;
  }

  if (typeof populate !== 'object') return;

  for (const [relation, options] of Object.entries(populate)) {
    const relPrefix = `${prefix}[${relation}]`;

    if (options === '*' || options === true) {
      params[relPrefix] = '*';
    } else if (typeof options === 'object') {
      const opts = options as PopulateOptions;

      // select fields in populate
      if (opts.select) {
        if (opts.select === '*') {
          params[`${relPrefix}[fields]`] = '*';
        } else if (Array.isArray(opts.select)) {
          opts.select.forEach((field: string, index: number) => {
            params[`${relPrefix}[fields][${index}]`] = field;
          });
        }
      }

      // nested populate
      if (opts.populate) {
        serializePopulate(opts.populate, `${relPrefix}[populate]`, params);
      }
    }
  }
}
