/**
 * Forja Configuration - Next.js Example
 *
 * This file configures the Forja framework for a Next.js application.
 * All types are inferred automatically - no manual type annotations needed.
 */

import { PostgresAdapter } from 'forja/adapters';
import { AuthPlugin, UploadPlugin, HooksPlugin } from 'forja/plugins';
import { LocalStorageProvider } from 'forja/plugins/upload';

/**
 * Database Adapter Configuration
 */
const adapter = new PostgresAdapter({
  connectionString: process.env.DATABASE_URL!,
  // Connection pool settings (recommended for production)
  max: 20, // Maximum number of connections in pool
  idleTimeoutMillis: 30000, // Close idle connections after 30s
  connectionTimeoutMillis: 10000, // Timeout after 10s if no connection available
});

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
          { resource: 'posts', action: 'create' },
          { resource: 'posts', action: 'read' },
          { resource: 'posts', action: 'update' },
          { resource: 'posts', action: 'delete' },
        ],
      },

      // Moderator role - can moderate content
      {
        name: 'moderator',
        permissions: [
          { resource: 'users', action: 'read' },
          { resource: 'posts', action: 'read' },
          { resource: 'posts', action: 'update' },
          { resource: 'posts', action: 'delete' },
        ],
      },

      // User role - basic access
      {
        name: 'user',
        permissions: [
          { resource: 'users', action: 'read' },
          { resource: 'posts', action: 'create' },
          { resource: 'posts', action: 'read' },
          { resource: 'posts', action: 'update' }, // Own posts only (enforced in handler)
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

/**
 * Main Forja Configuration
 */
export default {
  /**
   * Database adapter
   */
  adapter,

  /**
   * Schema location
   * Glob pattern to find schema files
   */
  schemas: {
    path: './schemas/**/*.schema.ts',
  },

  /**
   * Plugins
   * Order matters - plugins are initialized in order
   */
  plugins: [
    hooksPlugin, // Initialize hooks first (other plugins may use hooks)
    authPlugin,
    uploadPlugin,
  ],

  /**
   * API configuration
   */
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
} as const;

/**
 * Type Exports
 *
 * Export types for use in your application
 */
export type ForjaConfig = typeof import('./forja.config').default;

/**
 * Environment Variable Validation
 *
 * Ensure all required environment variables are set
 */
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  throw new Error(
    'JWT_SECRET environment variable is required and must be at least 32 characters long'
  );
}

// Warn about missing optional variables
if (!process.env.UPLOAD_DIR) {
  console.warn(
    'UPLOAD_DIR not set, using default: ./public/uploads'
  );
}

if (!process.env.UPLOAD_URL) {
  console.warn(
    'UPLOAD_URL not set, using default: http://localhost:3000/uploads'
  );
}

/**
 * Production Checklist:
 *
 * [ ] Set strong JWT_SECRET (64+ characters)
 * [ ] Use connection pooling (max: 20)
 * [ ] Enable SSL for database connection
 * [ ] Use S3 or CloudFlare R2 for file uploads
 * [ ] Set up database backups
 * [ ] Configure monitoring and logging
 * [ ] Enable rate limiting
 * [ ] Set up CORS properly
 * [ ] Use environment-specific configs
 * [ ] Set NODE_ENV=production
 */
