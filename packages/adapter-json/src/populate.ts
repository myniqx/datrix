import { QueryObject, getRelationMetadata } from 'forja-types/core/query-builder';
import type { JsonAdapter } from './adapter';

export class JsonPopulator {
  constructor(private adapter: JsonAdapter) { }

  async populate(rows: Record<string, unknown>[], query: QueryObject): Promise<Record<string, unknown>[]> {
    if (!query.populate || rows.length === 0) {
      return rows;
    }

    const result = [...rows];

    for (const [relationName, _options] of Object.entries(query.populate)) {
      const meta = getRelationMetadata(query, relationName);
      if (!meta) continue;

      const targetTable = meta.targetTable;
      const resultFk = meta.foreignKey;
      const kind = meta.kind;

      // Load target table using adapter's cache
      const tableData = await this.adapter.getCachedTable(targetTable);
      if (!tableData) continue;

      const relatedData = tableData.data as Record<string, unknown>[];

      // Map data based on relation type
      if (kind === 'belongsTo') {
        // Source has FK (e.g. Post.authorId -> User.id)
        const ids = new Set(
          result
            .map(r => r[resultFk])
            .filter((id): id is string | number => id !== null && id !== undefined)
        );

        const relatedMap = new Map<string | number, Record<string, unknown>>();
        if (ids.size > 0) {
          for (const item of relatedData) {
            const itemId = item['id'] as string | number;
            if (ids.has(itemId)) {
              relatedMap.set(itemId, item);
            }
          }
        }

        for (const row of result) {
          const fkValue = row[resultFk] as string | number | null | undefined;
          if (fkValue !== null && fkValue !== undefined) {
            row[relationName] = relatedMap.get(fkValue) ?? null;
          } else {
            row[relationName] = null;
          }
        }

      } else if (kind === 'hasMany' || kind === 'hasOne') {
        // Target has FK (e.g. User.id <- Post.authorId)
        const sourceIds = new Set(
          result
            .map(r => r['id'])
            .filter((id): id is string | number => id !== null && id !== undefined)
        );

        // Group related items by FK
        const grouped = new Map<string | number, Record<string, unknown>[]>();
        for (const item of relatedData) {
          const fkValue = item[resultFk] as string | number | null | undefined;
          if (fkValue !== null && fkValue !== undefined && sourceIds.has(fkValue)) {
            const group = grouped.get(fkValue) ?? [];
            group.push(item);
            grouped.set(fkValue, group);
          }
        }

        for (const row of result) {
          const rowId = row['id'] as string | number;
          const group = grouped.get(rowId) ?? [];
          if (kind === 'hasOne') {
            row[relationName] = group[0] ?? null;
          } else {
            row[relationName] = group;
          }
        }
      }

      // Nested populate (recursion)
      if (typeof _options === 'object' && _options.populate) {
        const nextRows: Record<string, unknown>[] = [];
        for (const row of result) {
          const val = row[relationName];
          if (!val) continue;
          if (Array.isArray(val)) {
            nextRows.push(...(val as Record<string, unknown>[]));
          } else {
            nextRows.push(val as Record<string, unknown>);
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
