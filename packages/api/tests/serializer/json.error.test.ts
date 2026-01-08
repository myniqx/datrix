/**
 * API Serializer - JSON Tests (Error Path)
 *
 * Tests error handling for serialization
 */

import { describe, it, expect } from 'vitest';
import { serializeRecord, serializeCollection } from '../../src/serializer/json';
import { SerializerOptions } from '../../../types/src/api/serializer';
import { SchemaDefinition } from '../../../types/src/core/schema';
import { parserTestData } from '../../../types/src/test/fixtures';
import { expectFailureError } from '../../../types/src/test/helpers';

const mockSchema: SchemaDefinition = {
  name: 'User',
  fields: {
    id: { type: 'number', primary: true },
    name: { type: 'string' },
    createdAt: { type: 'date' },
    data: { type: 'json' },
  }
};

const defaultOptions: SerializerOptions = {
  schema: mockSchema,
  select: '*'
};

describe('JSON Serializer - Error Path', () => {
  describe('serializeRecord - Invalid input', () => {
    it('should reject non-object data', () => {
      const notAnObject = parserTestData.invalidSerializerData.notAnObject;

      const error = expectFailureError(serializeRecord(notAnObject, defaultOptions));

      expect(error.code).toBe('INVALID_DATA');
      expect(error.message).toContain('object');
    });

    it('should reject null as data', () => {
      const nullData = null;

      const error = expectFailureError(serializeRecord(nullData, defaultOptions));

      expect(error.code).toBe('INVALID_DATA');
    });

    it('should reject undefined as data', () => {
      const undefinedData = undefined;

      const error = expectFailureError(serializeRecord(undefinedData, defaultOptions));

      expect(error.code).toBe('INVALID_DATA');
    });

    it('should reject array as single record', () => {
      const arrayAsRecord = [{ id: 1 }];

      const error = expectFailureError(serializeRecord(arrayAsRecord, defaultOptions));

      expect(error.code).toBe('INVALID_DATA');
    });

    it('should reject primitive values', () => {
      const primitiveValues = [123, 'string', true];

      for (const primitive of primitiveValues) {
        const error = expectFailureError(serializeRecord(primitive, defaultOptions));
        expect(error.code).toBe('INVALID_DATA');
      }
    });
  });

  describe('serializeCollection - Invalid input', () => {
    it('should reject non-array data', () => {
      const notAnArray = parserTestData.invalidSerializerData.notAnArray;

      const error = expectFailureError(serializeCollection(notAnArray as any, defaultOptions));

      expect(error.code).toBe('INVALID_DATA');
      expect(error.message).toContain('array');
    });

    it('should reject null as collection', () => {
      const nullCollection = null;

      const error = expectFailureError(serializeCollection(nullCollection as any, defaultOptions));

      expect(error.code).toBe('INVALID_DATA');
    });

    it('should reject undefined as collection', () => {
      const undefinedCollection = undefined;

      const error = expectFailureError(serializeCollection(undefinedCollection as any, defaultOptions));

      expect(error.code).toBe('INVALID_DATA');
    });

    it('should reject object as collection', () => {
      const objectAsCollection = { id: 1, name: 'John' };

      const error = expectFailureError(serializeCollection(objectAsCollection as any, defaultOptions));

      expect(error.code).toBe('INVALID_DATA');
    });
  });

  describe('Date serialization errors', () => {
    it('should return null for invalid date strings', () => {
      const invalidDate = parserTestData.invalidSerializerData.invalidDate;

      const error = expectFailureError(serializeRecord(invalidDate, defaultOptions));

      expect(error.code).toBe('INVALID_DATA');
    });

    it('should handle NaN timestamps', () => {
      const nanTimestamp = {
        id: 1,
        createdAt: NaN
      };

      const error = expectFailureError(serializeRecord(nanTimestamp, defaultOptions));

      expect(error.code).toBe('INVALID_DATA');
    });

    it('should handle Infinity as timestamp', () => {
      const infinityTimestamp = {
        id: 1,
        createdAt: Infinity
      };

      const error = expectFailureError(serializeRecord(infinityTimestamp, defaultOptions));

      expect(error.code).toBe('INVALID_DATA');
    });
  });

  describe('JSON parsing errors', () => {
    it('should handle malformed JSON gracefully', () => {
      const invalidJson = parserTestData.invalidSerializerData.invalidJson;

      const error = expectFailureError(serializeRecord(invalidJson, defaultOptions));

      expect(error.code).toBe('INVALID_DATA');
    });

    it('should handle unclosed JSON objects', () => {
      const unclosedJson = {
        id: 1,
        data: '{"key": "value"'
      };

      const error = expectFailureError(serializeRecord(unclosedJson, defaultOptions));

      expect(error.code).toBe('INVALID_DATA');
    });

    it('should handle invalid JSON syntax', () => {
      const invalidSyntax = {
        id: 1,
        data: '{key: value}'  // missing quotes
      };

      const error = expectFailureError(serializeRecord(invalidSyntax, defaultOptions));

      expect(error.code).toBe('INVALID_DATA');
    });
  });

  describe('Circular reference handling', () => {
    it('should detect circular references', () => {
      const circularData = parserTestData.invalidSerializerData.circularReference;

      const error = expectFailureError(serializeRecord(circularData, defaultOptions));

      expect(error.code).toBe('CIRCULAR_REFERENCE');
    });

    it('should detect deep circular references', () => {
      const obj: any = { id: 1, nested: { data: {} } };
      obj.nested.data.ref = obj;

      const error = expectFailureError(serializeRecord(obj, defaultOptions));

      expect(error.code).toBe('CIRCULAR_REFERENCE');
    });
  });

  describe('Collection errors', () => {
    it('should fail if any record in collection is invalid', () => {
      const mixedCollection = [
        { id: 1, name: 'John' },
        'invalid record',
        { id: 3, name: 'Bob' }
      ];

      const error = expectFailureError(serializeCollection(mixedCollection, defaultOptions));

      expect(error.code).toBe('INVALID_DATA');
    });

    it('should fail on first invalid record', () => {
      const collectionWithNull = [
        { id: 1, name: 'John' },
        null,
        { id: 3, name: 'Bob' }
      ];

      const error = expectFailureError(serializeCollection(collectionWithNull as any, defaultOptions));

      expect(error.code).toBe('INVALID_DATA');
    });
  });

  describe('Explicit Failure Messages', () => {
    it('should return consistent error structure', () => {
      const invalidData = parserTestData.invalidSerializerData.notAnObject;

      const error = expectFailureError(serializeRecord(invalidData, defaultOptions));

      expect(error).toHaveProperty('code');
      expect(error).toHaveProperty('message');
      expect(typeof error.code).toBe('string');
      expect(typeof error.message).toBe('string');
      expect(error.message.length).toBeGreaterThan(0);
    });

    it('should provide helpful error messages', () => {
      const notAnArray = { not: 'array' };

      const error = expectFailureError(serializeCollection(notAnArray as any, defaultOptions));

      expect(error.message).toContain('array');
    });
  });

  describe('State Isolation', () => {
    it('should not affect subsequent calls after error', () => {
      const invalidData = parserTestData.invalidSerializerData.notAnObject;
      const validData = { id: 1, name: 'John' };

      expectFailureError(serializeRecord(invalidData, defaultOptions));
      expectFailureError(serializeRecord(invalidData, defaultOptions));
      expectFailureError(serializeRecord(invalidData, defaultOptions));

      const error = expectFailureError(serializeRecord(invalidData, defaultOptions));
      expect(error.code).toBe('INVALID_DATA');
    });
  });
});
