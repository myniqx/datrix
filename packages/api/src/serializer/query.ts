/**
 * Query Serializer
 *
 * Converts ParsedQuery objects into Strapi-style query strings (RawQueryParams).
 */

import { ParsedQuery, RawQueryParams } from 'forja-types/api/parser';

/**
 * Serialize ParsedQuery into RawQueryParams (Strapi-style)
 * 
 * @param query - The parsed query object to serialize
 * @returns Records of query parameters
 */
export function serializeQuery(query: ParsedQuery): RawQueryParams {
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
function serializeWhere(where: any, prefix: string, params: Record<string, any>) {
  if (where === null || typeof where !== 'object') {
    params[prefix] = String(where);
    return;
  }

  for (const [key, value] of Object.entries(where)) {
    const newPrefix = `${prefix}[${key}]`;

    if (Array.isArray(value)) {
      // Handle logical operators like $or, $and which take arrays
      if (['$or', '$and'].includes(key)) {
        value.forEach((item, index) => {
          serializeWhere(item, `${newPrefix}[${index}]`, params);
        });
      } else {
        // Handle $in, $nin which take arrays
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
function serializePopulate(populate: any, prefix: string, params: Record<string, any>) {
  if (populate === '*') {
    params[prefix] = '*';
    return;
  }

  if (typeof populate !== 'object') return;

  for (const [relation, options] of Object.entries(populate)) {
    const relPrefix = `${prefix}[${relation}]`;

    if (options === '*') {
      params[relPrefix] = '*';
    } else if (typeof options === 'object') {
      const opts = options as any;

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
