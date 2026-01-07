/**
 * API Serializer - Relations Tests
 *
 * Tests the serialization of populated relations:
 * - Simple relations (one-to-one, one-to-many)
 * - Nested relations (3 levels deep)
 * - Circular reference detection
 * - Max depth enforcement
 */

import { describe, it, expect } from 'vitest';
import { serializeRelations } from '@api/serializer/relations';
import type { RelationSerializerOptions } from '@api/serializer/types';
import type { SchemaDefinition } from '@core/schema/types';

describe('API Serializer - Relations', () => {
  const mockSchema: SchemaDefinition = {
    name: 'Post',
    fields: {
      id: { type: 'number', primary: true },
      title: { type: 'string' },
      author: { type: 'relation', kind: 'belongsTo', model: 'User' },
      comments: { type: 'relation', kind: 'hasMany', model: 'Comment' }
    }
  };

  describe('serializeRelations', () => {
    it('should serialize simple belongsTo relation', () => {
      const data = {
        id: 1,
        title: 'Hello',
        author: { id: 10, name: 'John' }
      };

      const options: RelationSerializerOptions = {
        schema: mockSchema,
        populate: { author: '*' }
      };

      const result = serializeRelations(data, options);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data['author']).toEqual({ id: 10, name: 'John' });
      }
    });

    it('should serialize hasMany relation', () => {
      const data = {
        id: 1,
        comments: [
          { id: 101, text: 'Nice' },
          { id: 102, text: 'Cool' }
        ]
      };

      const options: RelationSerializerOptions = {
        schema: mockSchema,
        populate: { comments: '*' }
      };

      const result = serializeRelations(data, options);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data['comments']).toHaveLength(2);
        expect(result.data['comments'][0]).toEqual({ id: 101, text: 'Nice' });
      }
    });

    it('should handle field selection in relations', () => {
      const data = {
        author: { id: 10, name: 'John', email: 'john@example.com' }
      };

      const options: RelationSerializerOptions = {
        schema: mockSchema,
        populate: {
          author: { select: ['id', 'name'] }
        }
      };

      const result = serializeRelations(data, options);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data['author']).toEqual({ id: 10, name: 'John' });
        expect(result.data['author']).not.toHaveProperty('email');
      }
    });

    it('should handle nested relations', () => {
      const data = {
        author: {
          id: 10,
          name: 'John',
          profile: { id: 20, bio: 'Dev' }
        }
      };

      const options: RelationSerializerOptions = {
        schema: mockSchema,
        populate: {
          author: {
            populate: {
              profile: '*'
            }
          }
        }
      };

      const result = serializeRelations(data, options);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data['author']).toHaveProperty('profile');
        expect((result.data['author'] as any).profile.bio).toBe('Dev');
      }
    });

    it('should detect and break circular references', () => {
      const user: any = { id: 1, name: 'John' };
      const post: any = { id: 10, title: 'Hello', author: user };
      user.posts = [post]; // Circular

      const userSchema: SchemaDefinition = {
        name: 'User',
        fields: {
          id: { type: 'number', primary: true },
          posts: { type: 'relation', kind: 'hasMany', model: 'Post' }
        }
      };

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

      const result = serializeRelations(user, options);

      expect(result.success).toBe(true);
      if (result.success) {
        const firstPost = (result.data['posts'] as any[])[0];
        expect(firstPost.id).toBe(10);
        // The circular author should be collapsed to just ID
        expect(firstPost.author).toEqual({ id: 1 });
      }
    });

    it('should enforce max depth', () => {
      const data: any = { a: { b: { c: { d: 'deep' } } } };

      const schema: SchemaDefinition = {
        name: 'A',
        fields: { a: { type: 'relation', model: 'B', kind: 'hasOne' } }
      };

      const options: RelationSerializerOptions = {
        schema,
        populate: {
          a: { populate: { b: { populate: { c: '*' } } } }
        },
        maxDepth: 2
      };

      const result = serializeRelations(data, options);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('Maximum relation depth (2) exceeded');
      }
    });
  });
});
