import fs from 'node:fs/promises';
import path from 'node:path';
import { QueryObject, getRelationMetadata } from 'forja-types/core/query-builder';
import { JsonTableFile } from './types';

export class JsonPopulator {
  constructor(private root: string) { }

  async populate(rows: any[], query: QueryObject): Promise<any[]> {
    if (!query.populate || rows.length === 0) {
      return rows;
    }

    const result = [...rows];

    for (const [relationName, _options] of Object.entries(query.populate)) {
      const meta = getRelationMetadata(query, relationName);
      if (!meta) continue;

      // Currently only supports belongsTo (source has FK)
      // Todo: Support hasMany/hasOne by checking relation type (if available in meta)
      // The meta object from getRelationMetadata usually has: sourceTable, targetTable, foreignKey, type...
      // Let's assume belongsTo logic: source[foreignKey] -> target.id

      const targetTable = meta.targetTable;
      const resultFk = meta.foreignKey; // e.g. 'authorId'
      const kind = meta.kind;

      // 1. Load Target Table (Optimization: Load once per target table)
      let relatedData: any[] = [];
      try {
        const content = await fs.readFile(path.join(this.root, `${targetTable}.json`), 'utf-8');
        const json: JsonTableFile = JSON.parse(content);
        relatedData = json.data;
      } catch {
        continue;
      }

      // 2. Map Data based on Relation Type
      if (kind === 'belongsTo') {
        // Source has FK (e.g. Post.authorId -> User.id)
        const ids = new Set(result.map(r => r[resultFk]).filter(id => id !== null && id !== undefined));
        if (ids.size === 0) continue;

        const relatedMap = new Map<string | number, any>();
        relatedData.forEach(item => {
          if (ids.has(item.id)) {
            relatedMap.set(item.id, item);
          }
        });

        for (const row of result) {
          const fkValue = row[resultFk];
          row[relationName] = (fkValue !== null && fkValue !== undefined) ? (relatedMap.get(fkValue) || null) : null;
        }

      } else if (kind === 'hasMany' || kind === 'hasOne') {
        // Target has FK (e.g. User.id <- Post.authorId)
        // We need to find items in relatedData where item[resultFk] matches row.id

        const sourceIds = new Set(result.map(r => r.id));

        // Group related items by FK
        const grouped = new Map<string | number, any[]>();
        relatedData.forEach(item => {
          const fkValue = item[resultFk];
          if (fkValue !== null && fkValue !== undefined && sourceIds.has(fkValue)) {
            const group = grouped.get(fkValue) || [];
            group.push(item);
            grouped.set(fkValue, group);
          }
        });

        for (const row of result) {
          const group = grouped.get(row.id) || [];
          if (kind === 'hasOne') {
            row[relationName] = group[0] || null;
          } else {
            row[relationName] = group;
          }
        }
      }

      // 3. Nested Populate (Recursion)
      // _options is the PopulateOptions object
      if (typeof _options === 'object' && _options.populate) {
        // Collect the newly populated items to recurse on
        let nextRows: any[] = [];
        for (const row of result) {
          const val = row[relationName];
          if (!val) continue;
          if (Array.isArray(val)) {
            nextRows.push(...val);
          } else {
            nextRows.push(val);
          }
        }

        if (nextRows.length > 0) {
          await this.populate(nextRows, {
            type: 'select',
            table: targetTable,
            populate: _options.populate,
            meta: query.meta
          });
        }
      }
    }

    return result;
  }
}
