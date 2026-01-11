/**
 * Forja Configuration - Next.js Example
 */

import { defineConfig } from 'forja-core';
import { JsonAdapter } from 'forja-adapter-json';
import { AuthPlugin } from 'forja-plugin-auth';
import { UploadPlugin, LocalStorageProvider } from 'forja-plugin-upload';
import { HooksPlugin } from 'forja-plugin-hooks';

// Import schema definitions
import { userSchema } from './src/schemas/user.schema';
import { topicSchema } from './src/schemas/topic.schema';
import { commentSchema } from './src/schemas/comment.schema';
import { likeSchema } from './src/schemas/like.schema';

export default defineConfig(() => ({
  adapter: new JsonAdapter({
    root: './data',
  }),

  /**
 * Authentication Plugin Configuration
 *
 * Enables JWT-based authentication with RBAC (Role-Based Access Control)
 */
const authPlugin = new AuthPlugin({
  // JWT configuration
  jwt: {
    secret: process.env.JWT_SECRET!,
    expiresIn: '7d', // Token expires in 7 days
    algorithm: 'HS256',
    issuer: 'forja-nextjs-app',
    audience: 'forja-api',
  },

  // RBAC configuration
  rbac: {
    roles: [
      // Admin role - full access
      {
        name: 'admin',
        permissions: [
          { resource: 'users', action: 'create' },
          { resource: 'users', action: 'read' },
          { resource: 'users', action: 'update' },
          { resource: 'users', action: 'delete' },
          { resource: 'topics', action: 'create' },
          { resource: 'topics', action: 'read' },
          { resource: 'topics', action: 'update' },
          { resource: 'topics', action: 'delete' },
          { resource: 'comments', action: 'create' },
          { resource: 'comments', action: 'read' },
          { resource: 'comments', action: 'update' },
          { resource: 'comments', action: 'delete' },
          { resource: 'likes', action: 'create' },
          { resource: 'likes', action: 'read' },
          { resource: 'likes', action: 'delete' },
        ],
      },

      // Moderator role - can moderate content
      {
        name: 'moderator',
        permissions: [
          { resource: 'users', action: 'read' },
          { resource: 'topics', action: 'read' },
          { resource: 'topics', action: 'update' },
          { resource: 'topics', action: 'delete' },
          { resource: 'comments', action: 'read' },
          { resource: 'comments', action: 'delete' },
        ],
      },

      // User role - basic access
      {
        name: 'user',
        permissions: [
          { resource: 'users', action: 'read' },
          { resource: 'topics', action: 'create' },
          { resource: 'topics', action: 'read' },
          { resource: 'topics', action: 'update' },
          { resource: 'comments', action: 'create' },
          { resource: 'comments', action: 'read' },
          { resource: 'comments', action: 'update' },
          { resource: 'comments', action: 'delete' },
          { resource: 'likes', action: 'create' },
          { resource: 'likes', action: 'read' },
          { resource: 'likes', action: 'delete' },
        ],
      },
    ],
    defaultRole: 'user', // New users get 'user' role by default
  },

  // Password hashing settings
  passwordHashIterations: 100000, // PBKDF2 iterations
  passwordHashKeyLength: 64, // Hash length in bytes
});

/**
 * Upload Plugin Configuration
 *
 * Enables file uploads with local storage (use S3 in production)
 */
const uploadPlugin = new UploadPlugin({
  provider: new LocalStorageProvider({
    basePath: process.env.UPLOAD_DIR || './public/uploads',
    baseUrl: process.env.UPLOAD_URL || 'http://localhost:3000/uploads',
    ensureDirectory: true, // Create directory if it doesn't exist
  }),

  validation: {
    maxSize: 5 * 1024 * 1024, // 5MB max file size
    minSize: 1024, // 1KB minimum
    allowedMimeTypes: [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/svg+xml',
      'application/pdf',
    ],
    allowedExtensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'pdf'],
  },

  enableLogging: process.env.NODE_ENV === 'development',
});

/**
 * Hooks Plugin Configuration
 *
 * Enables lifecycle hooks for all schemas
 */
const hooksPlugin = new HooksPlugin();

  schemas: [
    userSchema,
    topicSchema,
    commentSchema,
    likeSchema,
  ],

  plugins: [
    hooksPlugin, // Initialize hooks first (other plugins may use hooks)
    authPlugin,
    uploadPlugin,
  ],

  api: {
    prefix: '/api', // All API routes start with /api
    defaultPageSize: 25, // Default pagination size
    maxPageSize: 100, // Maximum allowed page size
    maxPopulateDepth: 5, // Maximum depth for nested relations
  },

  /**
   * Migration configuration
   */
  migration: {
    auto: process.env.NODE_ENV === 'development', // Auto-run migrations in dev
    directory: './migrations', // Where to store migration files
  },

  /**
   * Development options
   */
  dev: {
    // Enable detailed logging in development
    logging: process.env.NODE_ENV === 'development',

    // Validate all queries in development
    validateQueries: process.env.NODE_ENV === 'development',

    // Pretty print errors in development
    prettyErrors: process.env.NODE_ENV === 'development',
  },
}));
