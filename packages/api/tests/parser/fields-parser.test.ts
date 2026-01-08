/**
 * API Parser - Fields Parser Tests (Happy Path)
 *
 * Tests successful parsing of fields query parameters
 */

import { describe, it, expect } from 'vitest';
import { parseFields } from '../../src/parser/fields-parser';
import { RawQueryParams } from '../../../types/src/api/parser';
import { parserTestData } from '../../../types/src/test/fixtures';
import { expectSuccessData } from '../../../types/src/test/helpers';

describe('FieldsParser - Happy Path', () => {
  describe('Wildcard', () => {
    it('should return wildcard when no fields parameter is provided', () => {
      const emptyParams: RawQueryParams = {};

      const parsedFields = expectSuccessData(parseFields(emptyParams));

      expect(parsedFields).toBe('*');
    });

    it('should return wildcard when fields is explicitly set to "*"', () => {
      const wildcardParams: RawQueryParams = { fields: '*' };

      const parsedFields = expectSuccessData(parseFields(wildcardParams));

      expect(parsedFields).toBe('*');
    });
  });

  describe('Comma-separated strings', () => {
    it('should parse simple comma-separated field list', () => {
      const commaSeparatedParams: RawQueryParams = {
        fields: parserTestData.commaSeparatedFields.simple
      };

      const parsedFields = expectSuccessData(parseFields(commaSeparatedParams));

      expect(parsedFields).toEqual(['id', 'name', 'email']);
    });

    it('should trim whitespace from field names', () => {
      const fieldsWithWhitespace: RawQueryParams = {
        fields: parserTestData.commaSeparatedFields.withWhitespace
      };

      const parsedFields = expectSuccessData(parseFields(fieldsWithWhitespace));

      expect(parsedFields).toEqual(['id', 'name', 'email']);
    });

    it('should ignore empty fields in comma-separated list', () => {
      const fieldsWithEmptyValues: RawQueryParams = {
        fields: parserTestData.commaSeparatedFields.withEmptyFields
      };

      const parsedFields = expectSuccessData(parseFields(fieldsWithEmptyValues));

      expect(parsedFields).toEqual(['id', 'name']);
    });

    it('should parse single field', () => {
      const singleFieldParams: RawQueryParams = {
        fields: parserTestData.commaSeparatedFields.single
      };

      const parsedFields = expectSuccessData(parseFields(singleFieldParams));

      expect(parsedFields).toEqual(['id']);
    });

    it('should parse complex field list with dots', () => {
      const complexFieldParams: RawQueryParams = {
        fields: parserTestData.commaSeparatedFields.complex
      };

      const parsedFields = expectSuccessData(parseFields(complexFieldParams));

      expect(parsedFields).toEqual([
        'id',
        'name',
        'email',
        'createdAt',
        'updatedAt',
        'profile.avatar'
      ]);
    });
  });

  describe('Array-style parameters (indexed)', () => {
    it('should parse indexed array format', () => {
      const indexedArrayParams: RawQueryParams = parserTestData.indexedArrayFields.simple;

      const parsedFields = expectSuccessData(parseFields(indexedArrayParams));

      expect(parsedFields).toEqual(['id', 'name']);
    });

    it('should stop parsing at first missing index', () => {
      const arrayWithGaps: RawQueryParams = parserTestData.indexedArrayFields.withGaps;

      const parsedFields = expectSuccessData(parseFields(arrayWithGaps));

      expect(parsedFields).toEqual(['id']);
    });

    it('should parse single indexed field', () => {
      const singleIndexedField: RawQueryParams = parserTestData.indexedArrayFields.singleItem;

      const parsedFields = expectSuccessData(parseFields(singleIndexedField));

      expect(parsedFields).toEqual(['id']);
    });
  });

  describe('Framework-parsed arrays', () => {
    it('should handle fields parameter as pre-parsed array', () => {
      const frameworkParsedArray: RawQueryParams = {
        fields: parserTestData.validFieldNames
      };

      const parsedFields = expectSuccessData(parseFields(frameworkParsedArray));

      expect(parsedFields).toEqual(parserTestData.validFieldNames);
    });

    it('should handle array with underscore fields', () => {
      const underscoreFields: RawQueryParams = {
        fields: parserTestData.validFieldNamesWithUnderscore
      };

      const parsedFields = expectSuccessData(parseFields(underscoreFields));

      expect(parsedFields).toEqual(parserTestData.validFieldNamesWithUnderscore);
    });

    it('should handle array with dot notation fields', () => {
      const dotNotationFields: RawQueryParams = {
        fields: parserTestData.validFieldNamesWithDots
      };

      const parsedFields = expectSuccessData(parseFields(dotNotationFields));

      expect(parsedFields).toEqual(parserTestData.validFieldNamesWithDots);
    });
  });

  describe('Valid field name patterns', () => {
    it('should accept fields with underscores', () => {
      const underscoreFields: RawQueryParams = { fields: '_id,_internal,__typename' };

      const parsedFields = expectSuccessData(parseFields(underscoreFields));

      expect(parsedFields).toEqual(['_id', '_internal', '__typename']);
    });

    it('should accept fields with dots (relation paths)', () => {
      const dotNotationFields: RawQueryParams = { fields: 'user.name,profile.avatar' };

      const parsedFields = expectSuccessData(parseFields(dotNotationFields));

      expect(parsedFields).toEqual(['user.name', 'profile.avatar']);
    });

    it('should accept mixed valid patterns', () => {
      const mixedFields: RawQueryParams = {
        fields: parserTestData.validFieldNamesMixed.join(',')
      };

      const parsedFields = expectSuccessData(parseFields(mixedFields));

      expect(parsedFields).toEqual(parserTestData.validFieldNamesMixed);
    });
  });

  describe('Determinism', () => {
    it('should return same result for identical input', () => {
      const identicalParams: RawQueryParams = { fields: 'id,name,email' };

      const firstParse = expectSuccessData(parseFields(identicalParams));
      const secondParse = expectSuccessData(parseFields(identicalParams));

      expect(firstParse).toEqual(secondParse);
    });

    it('should return same result regardless of input object mutation', () => {
      const mutableParams: RawQueryParams = { fields: 'id,name' };
      const firstParse = expectSuccessData(parseFields(mutableParams));

      mutableParams.fields = 'email';
      const secondParse = expectSuccessData(parseFields({ fields: 'id,name' }));

      expect(firstParse).toEqual(secondParse);
    });
  });

  describe('Input Immutability', () => {
    it('should not mutate input object', () => {
      const originalParams: RawQueryParams = { fields: 'id,name,email' };
      const paramsCopy = JSON.parse(JSON.stringify(originalParams));

      expectSuccessData(parseFields(originalParams));

      expect(originalParams).toEqual(paramsCopy);
    });

    it('should not mutate input array', () => {
      const originalArray = ['id', 'name', 'email'];
      const arrayCopy = [...originalArray];
      const arrayParams: RawQueryParams = { fields: originalArray };

      expectSuccessData(parseFields(arrayParams));

      expect(originalArray).toEqual(arrayCopy);
    });
  });
});
