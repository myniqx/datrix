/**
 * API Serializer - JSON Tests (Happy Path)
 *
 * Tests successful serialization of database results
 */

import { describe, it, expect } from 'vitest';
import { serializeRecord, serializeCollection, serialize } from '../../src/serializer/json';
import { SerializerOptions } from '../../../types/src/api/serializer';
import { SchemaDefinition } from '../../../types/src/core/schema';
import { parserTestData } from '../../../types/src/test/fixtures';
import { expectSuccessData } from '../../../types/src/test/helpers';

const mockSchema: SchemaDefinition = {
  name: 'User',
  fields: {
    id: { type: 'number', primary: true },
    name: { type: 'string' },
    email: { type: 'string' },
    age: { type: 'number' },
    createdAt: { type: 'date' },
    updatedAt: { type: 'date' },
    profile: { type: 'json' },
    metadata: { type: 'json' },
    tags: { type: 'array', items: { type: 'string' } },
    roles: { type: 'array', items: { type: 'string' } },
    deletedAt: { type: 'date' },
    phone: { type: 'string' },
  }
};

const defaultOptions: SerializerOptions = {
  schema: mockSchema,
  select: '*'
};

describe('JSON Serializer - Happy Path', () => {
  describe('serializeRecord - Basic', () => {
    it('should serialize simple record', () => {
      const simpleRecord = parserTestData.serializerData.simpleRecord;

      const serializedData = expectSuccessData(serializeRecord(simpleRecord, defaultOptions));

      expect(serializedData).toEqual(simpleRecord);
    });

    it('should preserve all primitive types', () => {
      const mixedTypes = {
        id: 1,
        name: 'John',
        age: 30,
        active: true,
        score: 95.5,
      };

      const serializedData = expectSuccessData(serializeRecord(mixedTypes, defaultOptions));

      expect(serializedData.id).toBe(1);
      expect(serializedData.name).toBe('John');
      expect(serializedData.age).toBe(30);
      expect(serializedData.active).toBe(true);
      expect(serializedData.score).toBe(95.5);
    });
  });

  describe('serializeRecord - Date conversion', () => {
    it('should convert Date objects to ISO strings', () => {
      const recordWithDate = parserTestData.serializerData.recordWithDate;

      const serializedData = expectSuccessData(serializeRecord(recordWithDate, defaultOptions));

      expect(serializedData.createdAt).toBe('2024-01-01T12:00:00.000Z');
      expect(serializedData.updatedAt).toBe('2024-06-15T08:30:00.000Z');
      expect(typeof serializedData.createdAt).toBe('string');
    });

    it('should convert date strings to ISO format', () => {
      const dateAsString = {
        id: 1,
        createdAt: '2024-01-01T12:00:00Z'
      };

      const serializedData = expectSuccessData(serializeRecord(dateAsString, defaultOptions));

      expect(serializedData.createdAt).toBe('2024-01-01T12:00:00.000Z');
    });

    it('should convert timestamp numbers to ISO strings', () => {
      const timestamp = new Date('2024-01-01T12:00:00Z').getTime();
      const dateAsTimestamp = {
        id: 1,
        createdAt: timestamp
      };

      const serializedData = expectSuccessData(serializeRecord(dateAsTimestamp, defaultOptions));

      expect(serializedData.createdAt).toBe('2024-01-01T12:00:00.000Z');
    });

    it('should handle multiple date fields', () => {
      const multipleDates = {
        id: 1,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-06-01'),
        deletedAt: new Date('2024-12-01')
      };

      const serializedData = expectSuccessData(serializeRecord(multipleDates, defaultOptions));

      expect(typeof serializedData.createdAt).toBe('string');
      expect(typeof serializedData.updatedAt).toBe('string');
      expect(typeof serializedData.deletedAt).toBe('string');
    });
  });

  describe('serializeRecord - JSON parsing', () => {
    it('should parse JSON strings to objects', () => {
      const recordWithJson = parserTestData.serializerData.recordWithJson;

      const serializedData = expectSuccessData(serializeRecord(recordWithJson, defaultOptions));

      expect(serializedData.profile).toEqual({ bio: 'Hello World', city: 'London', age: 30 });
      expect(serializedData.metadata).toEqual({ tags: ['tech', 'design'], verified: true });
      expect(typeof serializedData.profile).toBe('object');
    });

    it('should keep already-parsed JSON objects as-is', () => {
      const alreadyParsed = {
        id: 1,
        profile: { bio: 'Developer', city: 'NYC' }
      };

      const serializedData = expectSuccessData(serializeRecord(alreadyParsed, defaultOptions));

      expect(serializedData.profile).toEqual({ bio: 'Developer', city: 'NYC' });
    });

    it('should handle nested JSON structures', () => {
      const nestedJson = {
        id: 1,
        profile: JSON.stringify({
          personal: { name: 'John', age: 30 },
          work: { company: 'Tech Corp', role: 'Developer' }
        })
      };

      const serializedData = expectSuccessData(serializeRecord(nestedJson, defaultOptions));

      expect(serializedData.profile).toEqual({
        personal: { name: 'John', age: 30 },
        work: { company: 'Tech Corp', role: 'Developer' }
      });
    });
  });

  describe('serializeRecord - Array handling', () => {
    it('should preserve string arrays', () => {
      const recordWithArray = parserTestData.serializerData.recordWithArray;

      const serializedData = expectSuccessData(serializeRecord(recordWithArray, defaultOptions));

      expect(serializedData.tags).toEqual(['javascript', 'typescript', 'react']);
      expect(serializedData.roles).toEqual(['admin', 'user']);
      expect(Array.isArray(serializedData.tags)).toBe(true);
    });

    it('should handle empty arrays', () => {
      const emptyArrays = {
        id: 1,
        tags: [],
        roles: []
      };

      const serializedData = expectSuccessData(serializeRecord(emptyArrays, defaultOptions));

      expect(serializedData.tags).toEqual([]);
      expect(serializedData.roles).toEqual([]);
    });

    it('should handle arrays with mixed types', () => {
      const mixedArray = {
        id: 1,
        values: [1, 'two', true, null]
      };

      const serializedData = expectSuccessData(serializeRecord(mixedArray, defaultOptions));

      expect(serializedData.values).toEqual([1, 'two', true, null]);
    });
  });

  describe('serializeRecord - Null and undefined handling', () => {
    it('should preserve null values', () => {
      const recordWithNull = parserTestData.serializerData.recordWithNullUndefined;

      const serializedData = expectSuccessData(serializeRecord(recordWithNull, defaultOptions));

      expect(serializedData.email).toBeNull();
      expect(serializedData.deletedAt).toBeNull();
    });

    it('should preserve undefined values', () => {
      const recordWithUndefined = parserTestData.serializerData.recordWithNullUndefined;

      const serializedData = expectSuccessData(serializeRecord(recordWithUndefined, defaultOptions));

      expect(serializedData.phone).toBeUndefined();
    });

    it('should handle fields with all falsy values', () => {
      const falsyValues = {
        id: 0,
        name: '',
        active: false,
        deleted: null,
        optional: undefined
      };

      const serializedData = expectSuccessData(serializeRecord(falsyValues, defaultOptions));

      expect(serializedData.id).toBe(0);
      expect(serializedData.name).toBe('');
      expect(serializedData.active).toBe(false);
      expect(serializedData.deleted).toBeNull();
    });
  });

  describe('serializeRecord - Field selection', () => {
    it('should respect field selection', () => {
      const fullRecord = parserTestData.serializerData.simpleRecord;
      const selectOptions: SerializerOptions = {
        schema: mockSchema,
        select: ['id', 'name']
      };

      const serializedData = expectSuccessData(serializeRecord(fullRecord, selectOptions));

      expect(serializedData).toEqual({ id: 1, name: 'John Doe' });
      expect(serializedData).not.toHaveProperty('email');
      expect(serializedData).not.toHaveProperty('age');
    });

    it('should handle single field selection', () => {
      const record = { id: 1, name: 'John', email: 'john@example.com' };
      const singleFieldOptions: SerializerOptions = {
        schema: mockSchema,
        select: ['name']
      };

      const serializedData = expectSuccessData(serializeRecord(record, singleFieldOptions));

      expect(serializedData).toEqual({ name: 'John' });
    });

    it('should include all fields when select is "*"', () => {
      const record = parserTestData.serializerData.simpleRecord;
      const wildcardOptions: SerializerOptions = {
        schema: mockSchema,
        select: '*'
      };

      const serializedData = expectSuccessData(serializeRecord(record, wildcardOptions));

      expect(serializedData).toEqual(record);
      expect(Object.keys(serializedData).length).toBe(4);
    });
  });

  describe('serializeCollection', () => {
    it('should serialize array of records', () => {
      const collection = parserTestData.serializerData.collection;

      const serializedData = expectSuccessData(serializeCollection(collection, defaultOptions));

      expect(serializedData.data).toHaveLength(3);
      expect(serializedData.data[0]).toEqual({ id: 1, name: 'John', age: 30 });
      expect(serializedData.data[1]).toEqual({ id: 2, name: 'Jane', age: 25 });
      expect(serializedData.data[2]).toEqual({ id: 3, name: 'Bob', age: 35 });
    });

    it('should include pagination metadata', () => {
      const collection = parserTestData.serializerData.collection;
      const meta = parserTestData.serializerData.paginationMeta;

      const serializedData = expectSuccessData(serializeCollection(collection, defaultOptions, meta));

      expect(serializedData.meta).toEqual(meta);
      expect(serializedData.meta?.pagination.page).toBe(1);
      expect(serializedData.meta?.pagination.total).toBe(100);
    });

    it('should handle empty collection', () => {
      const emptyCollection = parserTestData.serializerData.emptyCollection;

      const serializedData = expectSuccessData(serializeCollection(emptyCollection, defaultOptions));

      expect(serializedData.data).toEqual([]);
      expect(serializedData.data).toHaveLength(0);
    });

    it('should serialize each record with field selection', () => {
      const collection = parserTestData.serializerData.collection;
      const selectOptions: SerializerOptions = {
        schema: mockSchema,
        select: ['id', 'name']
      };

      const serializedData = expectSuccessData(serializeCollection(collection, selectOptions));

      expect(serializedData.data[0]).toEqual({ id: 1, name: 'John' });
      expect(serializedData.data[0]).not.toHaveProperty('age');
    });

    it('should work without metadata', () => {
      const collection = parserTestData.serializerData.collection;

      const serializedData = expectSuccessData(serializeCollection(collection, defaultOptions));

      expect(serializedData).toHaveProperty('data');
      expect(serializedData).not.toHaveProperty('meta');
    });
  });

  describe('serialize - Auto-detect', () => {
    it('should auto-detect single record', () => {
      const record = parserTestData.serializerData.simpleRecord;

      const serializedData = expectSuccessData(serialize(record, defaultOptions));

      expect(serializedData).toEqual(record);
      expect(serializedData).not.toHaveProperty('data'); // Not wrapped
    });

    it('should auto-detect collection', () => {
      const collection = parserTestData.serializerData.collection;

      const serializedData = expectSuccessData(serialize(collection, defaultOptions));

      expect(serializedData).toHaveProperty('data');
      expect(Array.isArray((serializedData as any).data)).toBe(true);
    });
  });

  describe('Determinism', () => {
    it('should return same result for identical input', () => {
      const record = parserTestData.serializerData.simpleRecord;

      const firstSerialization = expectSuccessData(serializeRecord(record, defaultOptions));
      const secondSerialization = expectSuccessData(serializeRecord(record, defaultOptions));

      expect(firstSerialization).toEqual(secondSerialization);
    });
  });

  describe('Input Immutability', () => {
    it('should not mutate input object', () => {
      const originalRecord = { ...parserTestData.serializerData.simpleRecord };
      const recordCopy = JSON.parse(JSON.stringify(originalRecord));

      expectSuccessData(serializeRecord(originalRecord, defaultOptions));

      expect(originalRecord).toEqual(recordCopy);
    });

    it('should not mutate input array', () => {
      const originalCollection = [...parserTestData.serializerData.collection];
      const collectionCopy = JSON.parse(JSON.stringify(originalCollection));

      expectSuccessData(serializeCollection(originalCollection, defaultOptions));

      expect(originalCollection).toEqual(collectionCopy);
    });
  });
});
