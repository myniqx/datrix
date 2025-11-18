/**
 * Post Schema
 *
 * Defines the Post model with relations, validation, and lifecycle hooks.
 * Demonstrates hasMany, belongsTo relations and content management features.
 */

import { defineSchema } from 'forja';
import type { InferSchemaType } from 'forja';

/**
 * Post Schema Definition
 *
 * This schema demonstrates:
 * - Relation to User (belongsTo author)
 * - Enum types for status
 * - Content validation
 * - Slug generation
 * - Featured image handling
 * - Automatic timestamps
 * - Soft delete
 */
export const postSchema = defineSchema({
  /**
   * Schema name
   */
  name: 'Post',

  /**
   * Table name
   */
  tableName: 'posts',

  /**
   * Field definitions
   */
  fields: {
    /**
     * Title - post title
     */
    title: {
      type: 'string',
      required: true,
      minLength: 3,
      maxLength: 200,
    },

    /**
     * Slug - URL-friendly version of title
     * Auto-generated from title in beforeCreate hook
     */
    slug: {
      type: 'string',
      required: true,
      unique: true,
      maxLength: 250,
      pattern: /^[a-z0-9-]+$/,
      errorMessage: 'Slug must contain only lowercase letters, numbers, and hyphens',
    },

    /**
     * Content - main post content
     */
    content: {
      type: 'string',
      required: true,
      minLength: 10,
    },

    /**
     * Excerpt - short summary (optional)
     */
    excerpt: {
      type: 'string',
      required: false,
      maxLength: 500,
    },

    /**
     * Status - publication status
     */
    status: {
      type: 'enum',
      values: ['draft', 'published', 'archived'] as const,
      required: true,
      default: 'draft',
    },

    /**
     * Featured Image - URL to post image
     */
    featuredImage: {
      type: 'file',
      required: false,
      allowedTypes: ['image/jpeg', 'image/png', 'image/webp'],
      maxSize: 5 * 1024 * 1024, // 5MB
    },

    /**
     * Tags - array of tags
     */
    tags: {
      type: 'array',
      items: {
        type: 'string',
        maxLength: 50,
      } as const,
      required: false,
      maxItems: 10,
    },

    /**
     * View Count - number of views
     */
    viewCount: {
      type: 'number',
      required: true,
      default: 0,
      min: 0,
      integer: true,
    },

    /**
     * Published At - when post was published
     */
    publishedAt: {
      type: 'date',
      required: false,
    },

    /**
     * Featured - whether post is featured
     */
    featured: {
      type: 'boolean',
      required: true,
      default: false,
    },

    /**
     * Metadata - additional post metadata (JSON)
     */
    metadata: {
      type: 'json',
      required: false,
    },

    /**
     * Author - relation to User
     * Many posts belong to one user
     */
    author: {
      type: 'relation',
      model: 'User',
      kind: 'belongsTo',
      foreignKey: 'authorId',
      onDelete: 'cascade', // Delete post when author is deleted
    },

    /**
     * Author ID - foreign key
     * This is automatically managed by Forja but we define it for explicit control
     */
    authorId: {
      type: 'string',
      required: true,
    },
  },

  /**
   * Indexes for performance
   */
  indexes: [
    // Unique index on slug
    { fields: ['slug'], unique: true },

    // Index for querying by status
    { fields: ['status'] },

    // Index for author's posts
    { fields: ['authorId'] },

    // Composite index for published posts sorted by date
    { fields: ['status', 'publishedAt'] },

    // Index for featured posts
    { fields: ['featured', 'publishedAt'] },

    // Index for searching by title (if using full-text search)
    { fields: ['title'] },

    // Index for sorting by view count
    { fields: ['viewCount'] },
  ],

  /**
   * Lifecycle Hooks
   */
  hooks: {
    /**
     * Before Create Hook
     *
     * - Generate slug from title if not provided
     * - Set publishedAt if status is 'published'
     */
    beforeCreate: async (data) => {
      let processedData = { ...data };

      // Generate slug if not provided
      if (!processedData.slug && processedData.title) {
        processedData.slug = generateSlug(processedData.title as string);
      }

      // Set publishedAt when publishing
      if (processedData.status === 'published' && !processedData.publishedAt) {
        processedData.publishedAt = new Date();
      }

      // Auto-generate excerpt from content if not provided
      if (!processedData.excerpt && processedData.content) {
        processedData.excerpt = generateExcerpt(processedData.content as string);
      }

      return processedData;
    },

    /**
     * After Create Hook
     *
     * Log post creation (in real app, could trigger notifications)
     */
    afterCreate: async (post) => {
      console.log(`[Post] Created: ${post.title} (${post.id})`);
      return post;
    },

    /**
     * Before Update Hook
     *
     * - Update publishedAt when changing status to 'published'
     * - Regenerate slug if title changed
     */
    beforeUpdate: async (data) => {
      let processedData = { ...data };

      // Set publishedAt when publishing
      if (processedData.status === 'published' && !processedData.publishedAt) {
        processedData.publishedAt = new Date();
      }

      // Clear publishedAt when unpublishing
      if (processedData.status === 'draft' || processedData.status === 'archived') {
        processedData.publishedAt = undefined;
      }

      // Regenerate slug if title changed
      if (processedData.title && !processedData.slug) {
        processedData.slug = generateSlug(processedData.title as string);
      }

      return processedData;
    },

    /**
     * After Update Hook
     *
     * Log post updates
     */
    afterUpdate: async (post) => {
      console.log(`[Post] Updated: ${post.title} (${post.id})`);
      return post;
    },

    /**
     * Before Find Hook
     *
     * Add default ordering (newest first) if not specified
     */
    beforeFind: async (query) => {
      // Add default sort if not present
      if (!query.orderBy || query.orderBy.length === 0) {
        return {
          ...query,
          orderBy: [{ field: 'createdAt', direction: 'desc' as const }],
        };
      }

      return query;
    },

    /**
     * After Find Hook
     *
     * Can be used to transform data before returning to client
     */
    afterFind: async (results) => {
      return results;
    },
  },

  /**
   * Enable automatic timestamps
   */
  timestamps: true,

  /**
   * Enable soft delete
   * Posts are not permanently deleted, just marked as deleted
   */
  softDelete: true,
} as const);

/**
 * Infer TypeScript type from schema
 */
export type Post = InferSchemaType<typeof postSchema>;

/**
 * Post with populated author
 */
export type PostWithAuthor = Post & {
  author: {
    id: string;
    name: string;
    email: string;
    avatar?: string;
  };
};

/**
 * Helper Functions
 */

/**
 * Generate URL-friendly slug from title
 *
 * @param title - Post title
 * @returns URL-friendly slug
 *
 * @example
 * generateSlug('Hello World!') // 'hello-world'
 * generateSlug('TypeScript & React') // 'typescript-react'
 */
function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .trim()
    // Replace special characters with spaces
    .replace(/[^\w\s-]/g, '')
    // Replace multiple spaces/hyphens with single hyphen
    .replace(/[\s_-]+/g, '-')
    // Remove leading/trailing hyphens
    .replace(/^-+|-+$/g, '')
    // Add timestamp to ensure uniqueness
    .concat(`-${Date.now().toString(36)}`);
}

/**
 * Generate excerpt from content
 *
 * @param content - Full post content
 * @param maxLength - Maximum excerpt length (default: 200)
 * @returns Generated excerpt
 */
function generateExcerpt(content: string, maxLength: number = 200): string {
  // Remove HTML tags if present
  const plainText = content.replace(/<[^>]*>/g, '');

  // Truncate to maxLength
  if (plainText.length <= maxLength) {
    return plainText;
  }

  // Find last complete word before maxLength
  const truncated = plainText.substring(0, maxLength);
  const lastSpace = truncated.lastIndexOf(' ');

  return lastSpace > 0
    ? truncated.substring(0, lastSpace) + '...'
    : truncated + '...';
}

/**
 * Type Guards
 */

/**
 * Check if value is a valid post status
 */
export function isValidStatus(value: unknown): value is Post['status'] {
  return (
    typeof value === 'string' &&
    ['draft', 'published', 'archived'].includes(value)
  );
}

/**
 * Check if value is a valid Post object
 */
export function isPost(value: unknown): value is Post {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;

  return (
    typeof obj['title'] === 'string' &&
    typeof obj['content'] === 'string' &&
    typeof obj['authorId'] === 'string' &&
    isValidStatus(obj['status'])
  );
}

/**
 * Validation Helpers
 */

/**
 * Validate post data before creation
 */
export function validatePostData(data: unknown): data is Partial<Post> {
  if (typeof data !== 'object' || data === null) {
    return false;
  }

  const obj = data as Record<string, unknown>;

  // Title validation
  if ('title' in obj) {
    if (typeof obj['title'] !== 'string' || obj['title'].length < 3) {
      return false;
    }
  }

  // Content validation
  if ('content' in obj) {
    if (typeof obj['content'] !== 'string' || obj['content'].length < 10) {
      return false;
    }
  }

  // Status validation
  if ('status' in obj) {
    if (!isValidStatus(obj['status'])) {
      return false;
    }
  }

  return true;
}

/**
 * Example Usage:
 *
 * ```typescript
 * import { postSchema, type Post, type PostWithAuthor } from '@/schemas/post.schema';
 *
 * // Create a post
 * const post: Partial<Post> = {
 *   title: 'My First Post',
 *   content: 'This is the content of my first post!',
 *   status: 'draft',
 *   authorId: userId,
 * };
 *
 * // Query with populated author
 * const posts = await forja.findMany<PostWithAuthor>('Post', {
 *   where: { status: 'published' },
 *   populate: {
 *     author: {
 *       select: ['id', 'name', 'email', 'avatar']
 *     }
 *   },
 *   sort: ['-publishedAt']
 * });
 *
 * // Type guard
 * if (isPost(data)) {
 *   console.log(data.title);
 * }
 * ```
 */
