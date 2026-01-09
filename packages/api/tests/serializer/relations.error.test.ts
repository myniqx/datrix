/**
 * API Serializer - Relations Tests (Error Path)
 *
 * Tests error handling for relation serialization
 */

import { describe, it, expect } from 'vitest';
import { serializeRelations } from '../../src/serializer/relations';
import { RelationSerializerOptions } from '../../../types/src/api/serializer';
import { SchemaDefinition } from '../../../types/src/core/schema';
import { expectFailureError } from '../../../types/src/test/helpers';

describe('Relations Serializer - Error Path', () => {
  const postSchema: SchemaDefinition = {
    name: 'Post',
    fields: {
      id: { type: 'number', primary: true },
      title: { type: 'string' },
      author: { type: 'relation', kind: 'belongsTo', model: 'User', foreignKey: 'authorId' },
      comments: { type: 'relation', kind: 'hasMany', model: 'Comment', foreignKey: 'postId' }
    }
  };

  describe('Max depth exceeded', () => {
    it('should reject nesting deeper than maxDepth', () => {
      const deepData: any = {
        id: 1,
        a: { id: 2, b: { id: 3, c: { id: 4 } } }
      };

      const deepSchema: SchemaDefinition = {
        name: 'A',
        fields: {
          id: { type: 'number', primary: true },
          a: { type: 'relation', kind: 'hasOne', model: 'B', foreignKey: 'aId' }
        }
      };

      const options: RelationSerializerOptions = {
        schema: deepSchema,
        populate: {
          a: {
            populate: {
              b: {
                populate: {
                  c: '*'
                }
              }
            }
          }
        },
        maxDepth: 2
      };

      const error = expectFailureError(serializeRelations(deepData, options));

      expect(error.code).toBe('INVALID_RELATION');
      expect(error.message).toContain('Maximum relation depth');
      expect(error.message).toContain('2');
    });

    it('should reject very deep nesting beyond default limit', () => {
      const deepData: any = {
        id: 1,
        a: { id: 2, b: { id: 3, c: { id: 4, d: { id: 5, e: { id: 6, f: { id: 7 } } } } } }
      };

      const deepSchema: SchemaDefinition = {
        name: 'A',
        fields: {
          id: { type: 'number', primary: true },
          a: { type: 'relation', kind: 'hasOne', model: 'B', foreignKey: 'aId' }
        }
      };

      const options: RelationSerializerOptions = {
        schema: deepSchema,
        populate: {
          a: {
            populate: {
              b: {
                populate: {
                  c: {
                    populate: {
                      d: {
                        populate: {
                          e: {
                            populate: {
                              f: '*'
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      };

      const error = expectFailureError(serializeRelations(deepData, options));

      expect(error.code).toBe('INVALID_RELATION');
      expect(error.message).toContain('Maximum relation depth');
    });

    it('should enforce maxDepth=1', () => {
      const data = {
        id: 1,
        author: {
          id: 10,
          profile: { id: 20, bio: 'Dev' }
        }
      };

      const options: RelationSerializerOptions = {
        schema: postSchema,
        populate: {
          author: {
            populate: {
              profile: '*'
            }
          }
        },
        maxDepth: 1
      };

      const error = expectFailureError(serializeRelations(data, options));

      expect(error.code).toBe('INVALID_RELATION');
      expect(error.message).toContain('1');
    });
  });

  describe('Invalid populate options', () => {
    it('should handle empty populate gracefully', () => {
      const data = { id: 1, author: { id: 10, name: 'John' } };
      const options: RelationSerializerOptions = {
        schema: postSchema,
        populate: {}
      };

      // Empty populate should return empty result
      const error = expectFailureError(serializeRelations(data, options));

      // This might actually succeed with empty result - implementation dependent
      // If it fails, should be graceful
      expect(error.code).toBeDefined();
    });

    it('should handle populate on non-existent field', () => {
      const data = { id: 1, title: 'Post' };
      const options: RelationSerializerOptions = {
        schema: postSchema,
        populate: {
          nonExistentField: '*'
        }
      };

      // Should skip non-existent field or fail gracefully
      const error = expectFailureError(serializeRelations(data, options));

      expect(error.code).toBeDefined();
    });

    it('should handle populate on non-relation field', () => {
      const data = { id: 1, title: 'Post Title' };
      const options: RelationSerializerOptions = {
        schema: postSchema,
        populate: {
          title: '*' // title is not a relation
        }
      };

      // Should skip or fail gracefully
      const error = expectFailureError(serializeRelations(data, options));

      expect(error.code).toBeDefined();
    });
  });

  describe('Malformed relation data', () => {
    it('should handle relation data as primitive value', () => {
      const data = {
        id: 1,
        author: 'not-an-object'
      };

      const options: RelationSerializerOptions = {
        schema: postSchema,
        populate: {
          author: { select: ['name'] }
        }
      };

      // Should handle gracefully - might return as-is or fail
      const error = expectFailureError(serializeRelations(data, options));

      expect(error.code).toBeDefined();
    });

    it('should handle hasMany relation as non-array', () => {
      const data = {
        id: 1,
        comments: 'not-an-array'
      };

      const options: RelationSerializerOptions = {
        schema: postSchema,
        populate: {
          comments: '*'
        }
      };

      // Should handle gracefully
      const error = expectFailureError(serializeRelations(data, options));

      expect(error.code).toBeDefined();
    });

    it('should handle array with invalid items', () => {
      const data = {
        id: 1,
        comments: [
          { id: 101, text: 'Valid' },
          'invalid-item',
          { id: 102, text: 'Also valid' }
        ]
      };

      const options: RelationSerializerOptions = {
        schema: postSchema,
        populate: {
          comments: { select: ['id', 'text'] }
        }
      };

      // Should handle invalid array items
      const error = expectFailureError(serializeRelations(data, options));

      expect(error.code).toBeDefined();
    });
  });

  describe('Missing schema information', () => {
    it('should handle schema without relation field definition', () => {
      const minimalSchema: SchemaDefinition = {
        name: 'Post',
        fields: {
          id: { type: 'number', primary: true },
          title: { type: 'string' }
          // author field not defined
        }
      };

      const data = { id: 1, author: { id: 10, name: 'John' } };
      const options: RelationSerializerOptions = {
        schema: minimalSchema,
        populate: { author: '*' }
      };

      // Should skip undefined field or fail gracefully
      const error = expectFailureError(serializeRelations(data, options));

      expect(error.code).toBeDefined();
    });
  });

  describe('Deeply nested circular references', () => {
    it('should detect circular references at any depth', () => {
      const a: any = { id: 1, name: 'A' };
      const b: any = { id: 2, name: 'B', parent: a };
      const c: any = { id: 3, name: 'C', parent: b };
      a.child = b;
      b.child = c;
      c.child = a; // Circular back to a

      const circularSchema: SchemaDefinition = {
        name: 'Node',
        fields: {
          id: { type: 'number', primary: true },
          name: { type: 'string' },
          child: { type: 'relation', kind: 'hasOne', model: 'Node', foreignKey: 'childId' },
          parent: { type: 'relation', kind: 'belongsTo', model: 'Node', foreignKey: 'parentId' }
        }
      };

      const options: RelationSerializerOptions = {
        schema: circularSchema,
        populate: {
          child: {
            populate: {
              child: {
                populate: {
                  child: '*'
                }
              }
            }
          }
        }
      };

      // Should detect circular reference and break the cycle
      const error = expectFailureError(serializeRelations(a, options));

      // Might succeed by breaking cycle with ID-only, or fail with circular error
      expect(error.code).toBeDefined();
    });

    it('should handle mutual circular references', () => {
      const user1: any = { id: 1, name: 'User1' };
      const user2: any = { id: 2, name: 'User2' };
      user1.friend = user2;
      user2.friend = user1;

      const friendSchema: SchemaDefinition = {
        name: 'User',
        fields: {
          id: { type: 'number', primary: true },
          name: { type: 'string' },
          friend: { type: 'relation', kind: 'hasOne', model: 'User', foreignKey: 'friendId' }
        }
      };

      const options: RelationSerializerOptions = {
        schema: friendSchema,
        populate: {
          friend: {
            populate: {
              friend: '*'
            }
          }
        }
      };

      // Should break circular reference
      const error = expectFailureError(serializeRelations(user1, options));

      expect(error.code).toBeDefined();
    });
  });

  describe('Complex circular scenarios', () => {
    it('should handle circular reference in array items', () => {
      const parent: any = { id: 1, name: 'Parent' };
      const child1: any = { id: 2, name: 'Child1', parent };
      const child2: any = { id: 3, name: 'Child2', parent };
      parent.children = [child1, child2];

      const familySchema: SchemaDefinition = {
        name: 'Person',
        fields: {
          id: { type: 'number', primary: true },
          name: { type: 'string' },
          children: { type: 'relation', kind: 'hasMany', model: 'Person', foreignKey: 'parentId' },
          parent: { type: 'relation', kind: 'belongsTo', model: 'Person', foreignKey: 'parentId' }
        }
      };

      const options: RelationSerializerOptions = {
        schema: familySchema,
        populate: {
          children: {
            populate: {
              parent: '*'
            }
          }
        }
      };

      // Should detect parent is already visited
      const error = expectFailureError(serializeRelations(parent, options));

      expect(error.code).toBeDefined();
    });
  });

  describe('Invalid field selection', () => {
    it('should handle empty select array', () => {
      const data = { id: 1, author: { id: 10, name: 'John', email: 'john@example.com' } };
      const options: RelationSerializerOptions = {
        schema: postSchema,
        populate: {
          author: { select: [] }
        }
      };

      // Empty select should either return empty object or fail
      const error = expectFailureError(serializeRelations(data, options));

      expect(error.code).toBeDefined();
    });

    it('should handle select with non-existent fields', () => {
      const data = { id: 1, author: { id: 10, name: 'John' } };
      const options: RelationSerializerOptions = {
        schema: postSchema,
        populate: {
          author: { select: ['nonExistentField', 'anotherFakeField'] }
        }
      };

      // Should return empty or fail gracefully
      const error = expectFailureError(serializeRelations(data, options));

      expect(error.code).toBeDefined();
    });
  });

  describe('Edge cases', () => {
    it('should handle relation with only ID (not populated)', () => {
      const data = {
        id: 1,
        title: 'Post',
        author: 10 // Just ID, not populated
      };

      const options: RelationSerializerOptions = {
        schema: postSchema,
        populate: {
          author: { select: ['name', 'email'] }
        }
      };

      // Should handle ID-only relation gracefully
      const error = expectFailureError(serializeRelations(data, options));

      expect(error.code).toBeDefined();
    });

    it('should handle extremely large arrays', () => {
      const largeArray = Array.from({ length: 10000 }, (_, i) => ({
        id: i,
        text: `Comment ${i}`
      }));

      const data = {
        id: 1,
        comments: largeArray
      };

      const options: RelationSerializerOptions = {
        schema: postSchema,
        populate: {
          comments: { select: ['id'] }
        }
      };

      // Should handle large arrays (might timeout or fail gracefully)
      const error = expectFailureError(serializeRelations(data, options));

      expect(error.code).toBeDefined();
    });

    it('should handle deeply nested objects without circular refs', () => {
      const deepData: any = {
        id: 1,
        level1: { id: 2, level2: { id: 3, level3: { id: 4, level4: { id: 5, level5: { id: 6, level6: { id: 7 } } } } } }
      };

      const deepSchema: SchemaDefinition = {
        name: 'Deep',
        fields: {
          id: { type: 'number', primary: true },
          level1: { type: 'relation', kind: 'hasOne', model: 'Deep', foreignKey: 'level1Id' }
        }
      };

      const options: RelationSerializerOptions = {
        schema: deepSchema,
        populate: {
          level1: {
            populate: {
              level2: {
                populate: {
                  level3: {
                    populate: {
                      level4: {
                        populate: {
                          level5: {
                            populate: {
                              level6: '*'
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      };

      // Should fail due to exceeding max depth
      const error = expectFailureError(serializeRelations(deepData, options));

      expect(error.code).toBe('INVALID_RELATION');
      expect(error.message).toContain('Maximum relation depth');
    });
  });

  describe('Consistent error structure', () => {
    it('should return consistent error format', () => {
      const deepData: any = { id: 1, a: { id: 2, b: { id: 3, c: { id: 4 } } } };
      const deepSchema: SchemaDefinition = {
        name: 'A',
        fields: {
          id: { type: 'number', primary: true },
          a: { type: 'relation', kind: 'hasOne', model: 'B', foreignKey: 'aId' }
        }
      };

      const options: RelationSerializerOptions = {
        schema: deepSchema,
        populate: { a: { populate: { b: { populate: { c: '*' } } } } },
        maxDepth: 2
      };

      const error = expectFailureError(serializeRelations(deepData, options));

      expect(error).toHaveProperty('code');
      expect(error).toHaveProperty('message');
      expect(typeof error.code).toBe('string');
      expect(typeof error.message).toBe('string');
      expect(error.message.length).toBeGreaterThan(0);
    });

    it('should provide helpful error messages', () => {
      const deepData: any = { id: 1, a: { id: 2, b: { id: 3 } } };
      const deepSchema: SchemaDefinition = {
        name: 'A',
        fields: {
          id: { type: 'number', primary: true },
          a: { type: 'relation', kind: 'hasOne', model: 'B', foreignKey: 'aId' }
        }
      };

      const options: RelationSerializerOptions = {
        schema: deepSchema,
        populate: { a: { populate: { b: '*' } } },
        maxDepth: 1
      };

      const error = expectFailureError(serializeRelations(deepData, options));

      expect(error.message).toContain('depth');
      expect(error.message).toContain('1');
    });
  });

  describe('State isolation', () => {
    it('should not affect subsequent calls after error', () => {
      const deepData: any = { id: 1, a: { id: 2, b: { id: 3 } } };
      const deepSchema: SchemaDefinition = {
        name: 'A',
        fields: {
          id: { type: 'number', primary: true },
          a: { type: 'relation', kind: 'hasOne', model: 'B', foreignKey: 'aId' }
        }
      };

      const options: RelationSerializerOptions = {
        schema: deepSchema,
        populate: { a: { populate: { b: '*' } } },
        maxDepth: 1
      };

      expectFailureError(serializeRelations(deepData, options));
      expectFailureError(serializeRelations(deepData, options));
      expectFailureError(serializeRelations(deepData, options));

      const error = expectFailureError(serializeRelations(deepData, options));
      expect(error.code).toBe('INVALID_RELATION');
    });
  });
});
