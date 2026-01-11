import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { JsonAdapter } from '../src/adapter';
import { QueryObject } from 'forja-types/core/query-builder';
import { expectSuccessData } from 'forja-types/test/helpers';

describe('JsonAdapter Populate - Happy Path', () => {
  const root = path.join(__dirname, 'tmp_populate_test');
  let adapter: JsonAdapter;

  beforeEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
    adapter = new JsonAdapter({ root });
    await adapter.connect();

    // Setup tables
    await adapter.createTable({ name: 'users', fields: { name: { type: 'string', required: true } } });
    await adapter.createTable({
      name: 'posts', fields: {
        title: { type: 'string', required: true },
        authorId: { type: 'number', required: false }
      }
    });
    await adapter.createTable({
      name: 'profiles', fields: {
        bio: { type: 'string', required: true },
        userId: { type: 'number', required: true }
      }
    });
    await adapter.createTable({
      name: 'comments', fields: {
        text: { type: 'string', required: true },
        postId: { type: 'number', required: true },
        authorId: { type: 'number', required: true }
      }
    });
    await adapter.createTable({
      name: 'categories', fields: {
        name: { type: 'string', required: true }
      }
    });
  });

  afterEach(async () => {
    await adapter.disconnect();
    await fs.rm(root, { recursive: true, force: true });
  });

  describe('belongsTo Relations', () => {
    it('should populate single belongsTo relation', async () => {
      // Insert User
      await adapter.executeQuery({
        type: 'insert',
        table: 'users',
        data: { name: 'Burak' }
      });

      // Insert Posts
      await adapter.executeQuery({
        type: 'insert',
        table: 'posts',
        data: { title: 'Post 1', authorId: 1 }
      });
      await adapter.executeQuery({
        type: 'insert',
        table: 'posts',
        data: { title: 'Post 2', authorId: 1 }
      });

      // Select with Populate
      const query: QueryObject = {
        type: 'select',
        table: 'posts',
        populate: { author: {} },
        // @ts-ignore - internal property
        meta: {
          relations: {
            author: {
              kind: 'belongsTo',
              model: 'User',
              targetTable: 'users',
              foreignKey: 'authorId'
            }
          }
        }
      };

      const result = expectSuccessData(await adapter.executeQuery(query));

      expect(result.rows).toHaveLength(2);

      const row1 = result.rows[0] as any;
      expect(row1.title).toBe('Post 1');
      expect(row1.author).toBeDefined();
      expect(row1.author.id).toBe(1);
      expect(row1.author.name).toBe('Burak');
    });

    it('should handle missing relation gracefully', async () => {
      // Insert Post without User
      await adapter.executeQuery({
        type: 'insert',
        table: 'posts',
        data: { title: 'Orphan Post', authorId: 999 }
      });

      const query: QueryObject = {
        type: 'select',
        table: 'posts',
        populate: { author: {} },
        // @ts-ignore
        meta: {
          relations: {
            author: {
              kind: 'belongsTo',
              model: 'User',
              targetTable: 'users',
              foreignKey: 'authorId'
            }
          }
        }
      };

      const result = expectSuccessData(await adapter.executeQuery(query));
      const row = result.rows[0] as any;

      expect(row.author).toBeNull();
    });

    it('should handle null foreign key', async () => {
      await adapter.executeQuery({
        type: 'insert',
        table: 'posts',
        data: { title: 'Post without author', authorId: null }
      });

      const query: QueryObject = {
        type: 'select',
        table: 'posts',
        populate: { author: {} },
        // @ts-ignore
        meta: {
          relations: {
            author: {
              kind: 'belongsTo',
              model: 'User',
              targetTable: 'users',
              foreignKey: 'authorId'
            }
          }
        }
      };

      const result = expectSuccessData(await adapter.executeQuery(query));
      const row = result.rows[0] as any;

      expect(row.author).toBeNull();
    });

    it('should populate multiple belongsTo relations', async () => {
      // Create users and category
      await adapter.executeQuery({ type: 'insert', table: 'users', data: { name: 'Alice' } });
      await adapter.executeQuery({ type: 'insert', table: 'users', data: { name: 'Bob' } });
      await adapter.executeQuery({ type: 'insert', table: 'categories', data: { name: 'Tech' } });

      // Create post with author
      await adapter.executeQuery({
        type: 'insert',
        table: 'posts',
        data: { title: 'Tech Post', authorId: 1 }
      });

      // Create comment referencing both post and author
      await adapter.executeQuery({
        type: 'insert',
        table: 'comments',
        data: { text: 'Great post!', postId: 1, authorId: 2 }
      });

      const query: QueryObject = {
        type: 'select',
        table: 'comments',
        populate: { post: {}, author: {} },
        // @ts-ignore
        meta: {
          relations: {
            post: {
              kind: 'belongsTo',
              model: 'Post',
              targetTable: 'posts',
              foreignKey: 'postId'
            },
            author: {
              kind: 'belongsTo',
              model: 'User',
              targetTable: 'users',
              foreignKey: 'authorId'
            }
          }
        }
      };

      const result = expectSuccessData(await adapter.executeQuery(query));
      const comment = result.rows[0] as any;

      expect(comment.post).toBeDefined();
      expect(comment.post.title).toBe('Tech Post');
      expect(comment.author).toBeDefined();
      expect(comment.author.name).toBe('Bob');
    });
  });

  describe('hasMany Relations', () => {
    it('should populate hasMany as array', async () => {
      // Create user
      await adapter.executeQuery({ type: 'insert', table: 'users', data: { name: 'Alice' } });

      // Create multiple posts
      await adapter.executeQuery({ type: 'insert', table: 'posts', data: { title: 'Post 1', authorId: 1 } });
      await adapter.executeQuery({ type: 'insert', table: 'posts', data: { title: 'Post 2', authorId: 1 } });
      await adapter.executeQuery({ type: 'insert', table: 'posts', data: { title: 'Post 3', authorId: 1 } });

      const query: QueryObject = {
        type: 'select',
        table: 'users',
        populate: { posts: {} },
        // @ts-ignore
        meta: {
          relations: {
            posts: {
              kind: 'hasMany',
              model: 'Post',
              targetTable: 'posts',
              foreignKey: 'authorId'
            }
          }
        }
      };

      const result = expectSuccessData(await adapter.executeQuery(query));
      const user = result.rows[0] as any;

      expect(user.posts).toBeDefined();
      expect(Array.isArray(user.posts)).toBe(true);
      expect(user.posts).toHaveLength(3);
      expect(user.posts[0].title).toBe('Post 1');
    });

    it('should return empty array when no matches', async () => {
      // Create user without posts
      await adapter.executeQuery({ type: 'insert', table: 'users', data: { name: 'Lonely User' } });

      const query: QueryObject = {
        type: 'select',
        table: 'users',
        populate: { posts: {} },
        // @ts-ignore
        meta: {
          relations: {
            posts: {
              kind: 'hasMany',
              model: 'Post',
              targetTable: 'posts',
              foreignKey: 'authorId'
            }
          }
        }
      };

      const result = expectSuccessData(await adapter.executeQuery(query));
      const user = result.rows[0] as any;

      expect(user.posts).toBeDefined();
      expect(Array.isArray(user.posts)).toBe(true);
      expect(user.posts).toHaveLength(0);
    });

    it('should handle multiple users with different post counts', async () => {
      // Create users
      await adapter.executeQuery({ type: 'insert', table: 'users', data: { name: 'Alice' } });
      await adapter.executeQuery({ type: 'insert', table: 'users', data: { name: 'Bob' } });
      await adapter.executeQuery({ type: 'insert', table: 'users', data: { name: 'Charlie' } });

      // Alice has 2 posts
      await adapter.executeQuery({ type: 'insert', table: 'posts', data: { title: 'Alice Post 1', authorId: 1 } });
      await adapter.executeQuery({ type: 'insert', table: 'posts', data: { title: 'Alice Post 2', authorId: 1 } });

      // Bob has 1 post
      await adapter.executeQuery({ type: 'insert', table: 'posts', data: { title: 'Bob Post', authorId: 2 } });

      // Charlie has 0 posts

      const query: QueryObject = {
        type: 'select',
        table: 'users',
        populate: { posts: {} },
        // @ts-ignore
        meta: {
          relations: {
            posts: {
              kind: 'hasMany',
              model: 'Post',
              targetTable: 'posts',
              foreignKey: 'authorId'
            }
          }
        }
      };

      const result = expectSuccessData(await adapter.executeQuery(query));

      const alice = result.rows[0] as any;
      const bob = result.rows[1] as any;
      const charlie = result.rows[2] as any;

      expect(alice.posts).toHaveLength(2);
      expect(bob.posts).toHaveLength(1);
      expect(charlie.posts).toHaveLength(0);
    });
  });

  describe('hasOne Relations', () => {
    it('should populate hasOne as single object', async () => {
      // Create user with profile
      await adapter.executeQuery({ type: 'insert', table: 'users', data: { name: 'Alice' } });
      await adapter.executeQuery({ type: 'insert', table: 'profiles', data: { bio: 'Developer', userId: 1 } });

      const query: QueryObject = {
        type: 'select',
        table: 'users',
        populate: { profile: {} },
        // @ts-ignore
        meta: {
          relations: {
            profile: {
              kind: 'hasOne',
              model: 'Profile',
              targetTable: 'profiles',
              foreignKey: 'userId'
            }
          }
        }
      };

      const result = expectSuccessData(await adapter.executeQuery(query));
      const user = result.rows[0] as any;

      expect(user.profile).toBeDefined();
      expect(user.profile).not.toBeNull();
      expect(user.profile.bio).toBe('Developer');
      expect(Array.isArray(user.profile)).toBe(false);
    });

    it('should return null when no hasOne match', async () => {
      // Create user without profile
      await adapter.executeQuery({ type: 'insert', table: 'users', data: { name: 'ProfilelessUser' } });

      const query: QueryObject = {
        type: 'select',
        table: 'users',
        populate: { profile: {} },
        // @ts-ignore
        meta: {
          relations: {
            profile: {
              kind: 'hasOne',
              model: 'Profile',
              targetTable: 'profiles',
              foreignKey: 'userId'
            }
          }
        }
      };

      const result = expectSuccessData(await adapter.executeQuery(query));
      const user = result.rows[0] as any;

      expect(user.profile).toBeNull();
    });
  });

  describe('Nested Populate', () => {
    it('should populate 2 levels deep (belongsTo -> hasOne)', async () => {
      // Create user with profile
      await adapter.executeQuery({ type: 'insert', table: 'users', data: { name: 'Alice' } });
      await adapter.executeQuery({ type: 'insert', table: 'profiles', data: { bio: 'Developer', userId: 1 } });

      // Create post by this user
      await adapter.executeQuery({ type: 'insert', table: 'posts', data: { title: 'My Post', authorId: 1 } });

      const query: QueryObject = {
        type: 'select',
        table: 'posts',
        populate: {
          author: {
            populate: {
              profile: {}
            }
          }
        },
        // @ts-ignore
        meta: {
          relations: {
            author: {
              kind: 'belongsTo',
              model: 'User',
              targetTable: 'users',
              foreignKey: 'authorId'
            },
            profile: {
              kind: 'hasOne',
              model: 'Profile',
              targetTable: 'profiles',
              foreignKey: 'userId'
            }
          }
        }
      };

      const result = expectSuccessData(await adapter.executeQuery(query));
      const post = result.rows[0] as any;

      expect(post.author).toBeDefined();
      expect(post.author.name).toBe('Alice');
      expect(post.author.profile).toBeDefined();
      expect(post.author.profile.bio).toBe('Developer');
    });

    it('should populate 2 levels deep (belongsTo -> hasMany)', async () => {
      // Create user with posts
      await adapter.executeQuery({ type: 'insert', table: 'users', data: { name: 'Alice' } });
      await adapter.executeQuery({ type: 'insert', table: 'posts', data: { title: 'Alice Post 1', authorId: 1 } });
      await adapter.executeQuery({ type: 'insert', table: 'posts', data: { title: 'Alice Post 2', authorId: 1 } });

      // Create comment on first post
      await adapter.executeQuery({ type: 'insert', table: 'comments', data: { text: 'Great!', postId: 1, authorId: 1 } });

      const query: QueryObject = {
        type: 'select',
        table: 'comments',
        populate: {
          author: {
            populate: {
              posts: {}
            }
          }
        },
        // @ts-ignore
        meta: {
          relations: {
            author: {
              kind: 'belongsTo',
              model: 'User',
              targetTable: 'users',
              foreignKey: 'authorId'
            },
            posts: {
              kind: 'hasMany',
              model: 'Post',
              targetTable: 'posts',
              foreignKey: 'authorId'
            }
          }
        }
      };

      const result = expectSuccessData(await adapter.executeQuery(query));
      const comment = result.rows[0] as any;

      expect(comment.author).toBeDefined();
      expect(comment.author.name).toBe('Alice');
      expect(comment.author.posts).toBeDefined();
      expect(comment.author.posts).toHaveLength(2);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty result set', async () => {
      const query: QueryObject = {
        type: 'select',
        table: 'posts',
        where: { id: 999 },
        populate: { author: {} },
        // @ts-ignore
        meta: {
          relations: {
            author: {
              kind: 'belongsTo',
              model: 'User',
              targetTable: 'users',
              foreignKey: 'authorId'
            }
          }
        }
      };

      const result = expectSuccessData(await adapter.executeQuery(query));
      expect(result.rows).toHaveLength(0);
    });

    it('should work with query filters and populate', async () => {
      await adapter.executeQuery({ type: 'insert', table: 'users', data: { name: 'Alice' } });
      await adapter.executeQuery({ type: 'insert', table: 'users', data: { name: 'Bob' } });
      await adapter.executeQuery({ type: 'insert', table: 'posts', data: { title: 'Alice Post', authorId: 1 } });
      await adapter.executeQuery({ type: 'insert', table: 'posts', data: { title: 'Bob Post', authorId: 2 } });

      const query: QueryObject = {
        type: 'select',
        table: 'posts',
        where: { title: 'Alice Post' },
        populate: { author: {} },
        // @ts-ignore
        meta: {
          relations: {
            author: {
              kind: 'belongsTo',
              model: 'User',
              targetTable: 'users',
              foreignKey: 'authorId'
            }
          }
        }
      };

      const result = expectSuccessData(await adapter.executeQuery(query));

      expect(result.rows).toHaveLength(1);
      const post = result.rows[0] as any;
      expect(post.title).toBe('Alice Post');
      expect(post.author.name).toBe('Alice');
    });

    it('should handle 0 as valid foreign key', async () => {
      await adapter.executeQuery({ type: 'insert', table: 'users', data: { name: 'System' } });

      // Manually set id to 0 by updating the JSON file
      const usersPath = path.join(root, 'users.json');
      const content = JSON.parse(await fs.readFile(usersPath, 'utf-8'));
      content.data[0].id = 0;
      await fs.writeFile(usersPath, JSON.stringify(content, null, 2));

      await adapter.executeQuery({ type: 'insert', table: 'posts', data: { title: 'System Post', authorId: 0 } });

      const query: QueryObject = {
        type: 'select',
        table: 'posts',
        populate: { author: {} },
        // @ts-ignore
        meta: {
          relations: {
            author: {
              kind: 'belongsTo',
              model: 'User',
              targetTable: 'users',
              foreignKey: 'authorId'
            }
          }
        }
      };

      const result = expectSuccessData(await adapter.executeQuery(query));
      const post = result.rows[0] as any;

      expect(post.author).toBeDefined();
      expect(post.author.id).toBe(0);
      expect(post.author.name).toBe('System');
    });
  });
});
