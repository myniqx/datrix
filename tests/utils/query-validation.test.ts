/**
 * Query Validation Utility Tests - Happy Path
 *
 * Tests successful query validation:
 * - Valid QueryObject structure
 * - Meta field support
 */

import { describe, it, expect } from 'vitest';
import { validateQueryObject } from '../../packages/utils/src/query';
import { expectSuccessData } from '../../packages/types/src/test/helpers';

describe('Query Validation Utility - Happy Path', () => {
  describe('Valid QueryObject', () => {
    it('should pass for a valid QueryObject', () => {
      const validQuery = {
        type: 'select',
        table: 'users',
        select: ['id', 'name'],
        where: { id: 1 }
      };

      const validationResult = validateQueryObject(validQuery);
      expectSuccessData(validationResult);
    });

    it('should pass for a QueryObject with meta field', () => {
      const queryWithMeta = {
        type: 'select',
        table: 'users',
        meta: { cache: true, pluginData: { x: 1 } }
      };

      const validationResult = validateQueryObject(queryWithMeta as any);
      expectSuccessData(validationResult);
    });
  });
});
