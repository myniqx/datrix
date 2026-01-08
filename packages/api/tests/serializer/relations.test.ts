/**
 * API Serializer - Relations Tests (Happy Path)
 *
 * Tests successful serialization of populated relations
 */

import { describe, it, expect } from 'vitest';
import { serializeRelations } from '../../src/serializer/relations';
import { RelationSerializerOptions } from '../../../types/src/api/serializer';
import { SchemaDefinition } from '../../../types/src/core/schema';
import { parserTestData } from '../../../types/src/test/fixtures';
import { expectSuccessData } from '../../../types/src/test/helpers';

describe('Relations Serializer - Happy Path', () => {
  const postSchema: SchemaDefinition = {
    name: 'Post',
    fields: {
      id: { type: 'number', primary: true },
      title: { type: 'string' },
      author: { type: 'relation', kind: 'belongsTo', model: 'User', foreignKey: 'authorId' },
      comments: { type: 'relation', kind: 'hasMany', model: 'Comment', foreignKey: 'postId' },
      tags: { type: 'relation', kind: 'manyToMany', model: 'Tag', foreignKey: 'postId' }
    }
  };

  const userSchema: SchemaDefinition = {
    name: 'User',
    fields: {
      id: { type: 'number', primary: true },
      name: { type: 'string' },
      email: { type: 'string' },
      profile: { type: 'relation', kind: 'hasOne', model: 'Profile', foreignKey: 'userId' },
      posts: { type: 'relation', kind: 'hasMany', model: 'Post', foreignKey: 'authorId' }
    }
  };

  describe('Simple relations', () => {
    it('should serialize belongsTo relation', () => {
      const postWithAuthor = parserTestData.relationsData.postWithAuthor;
      const options: RelationSerializerOptions = {
        schema: postSchema,
        populate: { author: '*' }
      };

      const serializedData = expectSuccessData(serializeRelations(postWithAuthor, options));

      expect(serializedData.author).toEqual({ id: 10, name: 'John Doe', email: 'john@example.com' });
    });

    it('should serialize hasMany relation', () => {
      const postWithComments = parserTestData.relationsData.postWithComments;
      const options: RelationSerializerOptions = {
        schema: postSchema,
        populate: { comments: '*' }
      };

      const serializedData = expectSuccessData(serializeRelations(postWithComments, options));

      expect(Array.isArray(serializedData.comments)).toBe(true);
      expect((serializedData.comments as any[]).length).toBe(2);
      expect((serializedData.comments as any[])[0]).toHaveProperty('id', 101);
      expect((serializedData.comments as any[])[0]).toHaveProperty('text', 'Nice post!');
    });

    it('should convert dates in relations', () => {
      const postWithComments = parserTestData.relationsData.postWithComments;
      const options: RelationSerializerOptions = {
        schema: postSchema,
        populate: { comments: '*' }
      };

      const serializedData = expectSuccessData(serializeRelations(postWithComments, options));

      const firstComment = (serializedData.comments as any[])[0];
      expect(firstComment.createdAt).toBe('2024-01-01T00:00:00.000Z');
      expect(typeof firstComment.createdAt).toBe('string');
    });

    it('should handle manyToMany relations', () => {
      const postWithTags = parserTestData.relationsData.postWithMultipleRelations;
      const options: RelationSerializerOptions = {
        schema: postSchema,
        populate: { tags: '*' }
      };

      const serializedData = expectSuccessData(serializeRelations(postWithTags, options));

      expect(Array.isArray(serializedData.tags)).toBe(true);
      expect((serializedData.tags as any[]).length).toBe(2);
      expect((serializedData.tags as any[])[0]).toEqual({ id: 201, name: 'javascript' });
      expect((serializedData.tags as any[])[1]).toEqual({ id: 202, name: 'typescript' });
    });
  });

  describe('Field selection in relations', () => {
    it('should respect field selection in belongsTo relation', () => {
      const postWithAuthor = parserTestData.relationsData.postWithAuthor;
      const options: RelationSerializerOptions = {
        schema: postSchema,
        populate: {
          author: { select: ['id', 'name'] }
        }
      };

      const serializedData = expectSuccessData(serializeRelations(postWithAuthor, options));

      expect(serializedData.author).toEqual({ id: 10, name: 'John Doe' });
      expect(serializedData.author).not.toHaveProperty('email');
    });

    it('should respect field selection in hasMany relation', () => {
      const postWithComments = parserTestData.relationsData.postWithComments;
      const options: RelationSerializerOptions = {
        schema: postSchema,
        populate: {
          comments: { select: ['id', 'text'] }
        }
      };

      const serializedData = expectSuccessData(serializeRelations(postWithComments, options));

      const firstComment = (serializedData.comments as any[])[0];
      expect(firstComment).toEqual({ id: 101, text: 'Nice post!' });
      expect(firstComment).not.toHaveProperty('createdAt');
    });

    it('should handle wildcard with field selection', () => {
      const postWithAuthor = parserTestData.relationsData.postWithAuthor;
      const options: RelationSerializerOptions = {
        schema: postSchema,
        populate: { author: '*' }
      };

      const serializedData = expectSuccessData(serializeRelations(postWithAuthor, options));

      expect(serializedData.author).toHaveProperty('id');
      expect(serializedData.author).toHaveProperty('name');
      expect(serializedData.author).toHaveProperty('email');
    });
  });

  describe('Nested relations', () => {
    it('should serialize 2-level nested relations', () => {
      const postWithNested = parserTestData.relationsData.postWithNestedAuthor;
      const options: RelationSerializerOptions = {
        schema: postSchema,
        populate: {
          author: {
            populate: {
              profile: '*'
            }
          }
        }
      };

      const serializedData = expectSuccessData(serializeRelations(postWithNested, options));

      expect(serializedData.author).toHaveProperty('profile');
      expect((serializedData.author as any).profile).toEqual({ id: 20, bio: 'Developer', avatar: 'avatar.jpg' });
    });

    it('should serialize 3-level nested relations', () => {
      const postWithDeep = parserTestData.relationsData.postWithDeepNested;
      const options: RelationSerializerOptions = {
        schema: postSchema,
        populate: {
          author: {
            populate: {
              profile: {
                populate: {
                  settings: '*'
                }
              }
            }
          }
        }
      };

      const serializedData = expectSuccessData(serializeRelations(postWithDeep, options));

      const author = serializedData.author as any;
      expect(author.profile.settings).toEqual({ id: 30, theme: 'dark', notifications: true });
    });

    it('should combine field selection with nested populates', () => {
      const postWithNested = parserTestData.relationsData.postWithNestedAuthor;
      const options: RelationSerializerOptions = {
        schema: postSchema,
        populate: {
          author: {
            select: ['id', 'name'],
            populate: {
              profile: { select: ['bio'] }
            }
          }
        }
      };

      const serializedData = expectSuccessData(serializeRelations(postWithNested, options));

      expect(serializedData.author).toEqual({
        id: 10,
        name: 'John Doe',
        profile: { bio: 'Developer' }
      });
    });

    it('should handle nested relations in arrays', () => {
      const postWithMultiple = parserTestData.relationsData.postWithMultipleRelations;
      const options: RelationSerializerOptions = {
        schema: postSchema,
        populate: {
          comments: {
            populate: {
              user: '*'
            }
          }
        }
      };

      const serializedData = expectSuccessData(serializeRelations(postWithMultiple, options));

      const comments = serializedData.comments as any[];
      expect(comments[0].user).toEqual({ id: 11, name: 'Alice' });
      expect(comments[1].user).toEqual({ id: 12, name: 'Bob' });
    });
  });

  describe('Multiple relations', () => {
    it('should serialize multiple relations at once', () => {
      const postWithMultiple = parserTestData.relationsData.postWithMultipleRelations;
      const options: RelationSerializerOptions = {
        schema: postSchema,
        populate: {
          author: '*',
          comments: '*',
          tags: '*'
        }
      };

      const serializedData = expectSuccessData(serializeRelations(postWithMultiple, options));

      expect(serializedData.author).toEqual({ id: 10, name: 'John' });
      expect(Array.isArray(serializedData.comments)).toBe(true);
      expect(Array.isArray(serializedData.tags)).toBe(true);
      expect((serializedData.comments as any[]).length).toBe(2);
      expect((serializedData.tags as any[]).length).toBe(2);
    });

    it('should handle different populate options for each relation', () => {
      const postWithMultiple = parserTestData.relationsData.postWithMultipleRelations;
      const options: RelationSerializerOptions = {
        schema: postSchema,
        populate: {
          author: { select: ['name'] },
          comments: { select: ['text'], populate: { user: '*' } },
          tags: '*'
        }
      };

      const serializedData = expectSuccessData(serializeRelations(postWithMultiple, options));

      expect(serializedData.author).toEqual({ name: 'John' });
      expect((serializedData.comments as any[])[0]).toHaveProperty('text');
      expect((serializedData.comments as any[])[0]).toHaveProperty('user');
      expect((serializedData.tags as any[])[0]).toHaveProperty('id');
      expect((serializedData.tags as any[])[0]).toHaveProperty('name');
    });
  });

  describe('Circular reference detection', () => {
    it('should detect and break circular references', () => {
      const { author } = parserTestData.relationsData.circularAuthorPost;
      const options: RelationSerializerOptions = {
        schema: userSchema,
        populate: {
          posts: {
            populate: {
              author: '*'
            }
          }
        }
      };

      const serializedData = expectSuccessData(serializeRelations(author, options));

      const firstPost = (serializedData.posts as any[])[0];
      expect(firstPost.id).toBe(10);
      expect(firstPost.title).toBe('Hello');
      // Circular author should be collapsed to just ID
      expect(firstPost.author).toEqual({ id: 1 });
    });

    it('should handle self-referential circular references', () => {
      const user: any = { id: 1, name: 'John', manager: null };
      user.manager = { id: 2, name: 'Boss', manager: user };

      const managerSchema: SchemaDefinition = {
        name: 'User',
        fields: {
          id: { type: 'number', primary: true },
          name: { type: 'string' },
          manager: { type: 'relation', kind: 'belongsTo', model: 'User', foreignKey: 'managerId' }
        }
      };

      const options: RelationSerializerOptions = {
        schema: managerSchema,
        populate: {
          manager: {
            populate: {
              manager: '*'
            }
          }
        }
      };

      const serializedData = expectSuccessData(serializeRelations(user, options));

      expect((serializedData.manager as any).id).toBe(2);
      expect((serializedData.manager as any).name).toBe('Boss');
      // Circular back to user should be just ID
      expect((serializedData.manager as any).manager).toEqual({ id: 1 });
    });
  });

  describe('Null and undefined handling', () => {
    it('should handle null relations', () => {
      const postWithNull = parserTestData.relationsData.postWithNullAuthor;
      const options: RelationSerializerOptions = {
        schema: postSchema,
        populate: { author: '*' }
      };

      const serializedData = expectSuccessData(serializeRelations(postWithNull, options));

      expect(serializedData.author).toBeNull();
    });

    it('should handle undefined relations', () => {
      const postWithUndefined = parserTestData.relationsData.postWithUndefinedComments;
      const options: RelationSerializerOptions = {
        schema: postSchema,
        populate: { comments: '*' }
      };

      const serializedData = expectSuccessData(serializeRelations(postWithUndefined, options));

      expect(serializedData.comments).toBeNull();
    });

    it('should handle empty array relations', () => {
      const postWithEmpty = parserTestData.relationsData.postWithEmptyComments;
      const options: RelationSerializerOptions = {
        schema: postSchema,
        populate: { comments: '*' }
      };

      const serializedData = expectSuccessData(serializeRelations(postWithEmpty, options));

      expect(serializedData.comments).toEqual([]);
      expect(Array.isArray(serializedData.comments)).toBe(true);
    });
  });

  describe('Internal field filtering', () => {
    it('should exclude internal fields (starting with _)', () => {
      const postWithInternal = parserTestData.relationsData.postWithInternalFields;
      const options: RelationSerializerOptions = {
        schema: postSchema,
        populate: { author: '*' }
      };

      const serializedData = expectSuccessData(serializeRelations(postWithInternal, options));

      expect(serializedData.author).not.toHaveProperty('_password');
      expect(serializedData.author).not.toHaveProperty('_internal');
      expect(serializedData.author).toHaveProperty('id');
      expect(serializedData.author).toHaveProperty('name');
      expect(serializedData.author).toHaveProperty('email');
    });
  });

  describe('Max depth enforcement', () => {
    it('should respect default max depth', () => {
      const deepData: any = {
        id: 1,
        a: { id: 2, b: { id: 3, c: { id: 4, d: { id: 5, e: 'too deep' } } } }
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
                      d: '*'
                    }
                  }
                }
              }
            }
          }
        }
      };

      const serializedData = expectSuccessData(serializeRelations(deepData, options));

      // Should serialize up to depth 4 (within default limit of 5)
      expect(serializedData.a).toBeDefined();
    });

    it('should handle shallow nesting within limits', () => {
      const postWithNested = parserTestData.relationsData.postWithNestedAuthor;
      const options: RelationSerializerOptions = {
        schema: postSchema,
        populate: {
          author: { populate: { profile: '*' } }
        },
        maxDepth: 2
      };

      const serializedData = expectSuccessData(serializeRelations(postWithNested, options));

      expect(serializedData.author).toHaveProperty('profile');
    });
  });

  describe('Determinism', () => {
    it('should return same result for identical input', () => {
      const postWithAuthor = parserTestData.relationsData.postWithAuthor;
      const options: RelationSerializerOptions = {
        schema: postSchema,
        populate: { author: { select: ['id', 'name'] } }
      };

      const firstSerialization = expectSuccessData(serializeRelations(postWithAuthor, options));
      const secondSerialization = expectSuccessData(serializeRelations(postWithAuthor, options));

      expect(firstSerialization).toEqual(secondSerialization);
    });
  });

  describe('Input Immutability', () => {
    it('should not mutate input object', () => {
      const postWithAuthor = { ...parserTestData.relationsData.postWithAuthor };
      const originalCopy = JSON.parse(JSON.stringify(postWithAuthor));
      const options: RelationSerializerOptions = {
        schema: postSchema,
        populate: { author: '*' }
      };

      expectSuccessData(serializeRelations(postWithAuthor, options));

      expect(postWithAuthor).toEqual(originalCopy);
    });
  });
});
