import { describe, it, expect } from 'vitest';
import { validateQueryObject } from '@utils/query';

describe('Query Validation Utility', () => {
  it('should pass for a valid QueryObject', () => {
    const query = {
      type: 'select',
      table: 'users',
      select: ['id', 'name'],
      where: { id: 1 }
    };

    const result = validateQueryObject(query);
    expect(result.success).toBe(true);
  });

  it('should pass for a QueryObject with meta field', () => {
    const query = {
      type: 'select',
      table: 'users',
      meta: { cache: true, pluginData: { x: 1 } }
    };

    const result = validateQueryObject(query as any);
    expect(result.success).toBe(true);
  });

  it('should fail if required fields are missing', () => {
    const query = {
      table: 'users'
    };

    const result = validateQueryObject(query as any);
    expect(result.success).toBe(false);
    expect(result.error.message).toContain('missing required field: type');
  });

  it('should fail if invalid keys are present (e.g., "fields" instead of "select")', () => {
    const query = {
      type: 'select',
      table: 'users',
      fields: ['id', 'name'] // SHOULD BE 'select'
    };

    const result = validateQueryObject(query as any);
    expect(result.success).toBe(false);
    expect(result.error.message).toContain("Invalid keys found in QueryObject: 'fields'");
    expect(result.error.message).toContain("did you mean 'select'?");
  });

  it('should fail if multiple invalid keys are present', () => {
    const query = {
      type: 'select',
      table: 'users',
      unknownKey: 1,
      anotherBadKey: true
    };

    const result = validateQueryObject(query as any);
    expect(result.success).toBe(false);
    expect(result.error.message).toContain("'unknownKey'");
    expect(result.error.message).toContain("'anotherBadKey'");
  });
});
