/**
 * API Serializer - JSON Tests
 *
 * Tests the serialization of database results:
 * - Date to ISO string conversion
 * - JSON string to object conversion
 * - Field selection (select: ['field1', 'field2'])
 * - Collection serialization with meta
 */

import { describe, it, expect } from 'vitest';
import { serializeRecord, serializeCollection } from '@api/serializer/json';
import type { SerializerOptions } from '@api/serializer/types';
import type { SchemaDefinition } from '@core/schema/types';

describe('API Serializer - JSON', () => {
  const mockSchema: SchemaDefinition = {
    name: 'User',
    fields: {
      id: { type: 'number', primary: true },
      name: { type: 'string' },
      createdAt: { type: 'date' },
      profile: { type: 'json' },
      tags: { type: 'array', items: { type: 'string' } }
    }
  };

  const defaultOptions: SerializerOptions = {
    schema: mockSchema,
    select: '*'
  };

  describe('serializeRecord', () => {
    it('should convert Date objects to ISO strings', () => {
      const date = new Date('2024-01-01T12:00:00Z');
      const data = { id: 1, createdAt: date };

      const result = serializeRecord(data, defaultOptions);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data['createdAt']).toBe(date.toISOString());
      }
    });

    it('should parse JSON strings if field type is json', () => {
      const profile = { bio: 'Hello', city: 'London' };
      const data = { id: 1, profile: JSON.stringify(profile) };

      const result = serializeRecord(data, defaultOptions);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data['profile']).toEqual(profile);
      }
    });

    it('should respect field selection', () => {
      const data = { id: 1, name: 'John', email: 'john@example.com' };
      const options: SerializerOptions = {
        ...defaultOptions,
        select: ['id', 'name']
      };

      const result = serializeRecord(data, options);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ id: 1, name: 'John' });
        expect(result.data).not.toHaveProperty('email');
      }
    });

    it('should handle null and undefined values', () => {
      const data = { id: 1, name: null, profile: undefined };
      const result = serializeRecord(data, defaultOptions);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data['name']).toBeNull();
        expect(result.data['profile']).toBeUndefined();
      }
    });
  });

  describe('serializeCollection', () => {
    it('should serialize multiple records with metadata', () => {
      const data = [
        { id: 1, name: 'John' },
        { id: 2, name: 'Jane' }
      ];
      const meta = {
        pagination: {
          page: 1,
          pageSize: 10,
          pageCount: 1,
          total: 2
        }
      };

      const result = serializeCollection(data, defaultOptions, meta);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.data).toHaveLength(2);
        expect(result.data.meta).toEqual(meta);
      }
    });
  });
});
