/**
 * Forja Configuration - Next.js Example
 *
 * Updated to use new integrated auth system (no more auth plugin!)
 */

import { defineConfig } from 'forja-core';
import { JsonAdapter } from 'forja-adapter-json';
import { ForjaApi } from 'forja-api';
import { UploadPlugin, LocalStorageProvider } from 'forja-plugin-upload';
import { HooksPlugin } from 'forja-plugin-hooks';

// Import schema definitions
import { userSchema } from './src/schemas/user.schema';
import { topicSchema } from './src/schemas/topic.schema';
import { commentSchema } from './src/schemas/comment.schema';
import { likeSchema } from './src/schemas/like.schema';
import { ForjaConfig } from 'forja-types';

export default defineConfig(() => {
  const config: ForjaConfig = {
    adapter: new JsonAdapter({
      root: './data',
    }),

    schemas: [
      userSchema,
      topicSchema,
      commentSchema,
      likeSchema,
    ],

    plugins: [
      new HooksPlugin(), // Initialize hooks first
      new UploadPlugin({
        provider: new LocalStorageProvider({
          basePath: process.env.UPLOAD_DIR || './public/uploads',
          baseUrl: process.env.UPLOAD_URL || 'http://localhost:3000/uploads',
          ensureDirectory: true,
        }),
        validation: {
          maxSize: 5 * 1024 * 1024, // 5MB
          minSize: 1024, // 1KB
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
      }),
    ],

    /**
     * API Configuration with ForjaApi Class
     *
     * ✨ NEW: Use ForjaApi class instance instead of plain config object
     */
    api: new ForjaApi({
      enabled: true,
      prefix: '/api',
      defaultPageSize: 25,
      maxPageSize: 100,
      maxPopulateDepth: 5,

      // Integrated authentication system
      auth: {
        enabled: true,

        // User schema configuration
        // API will automatically extend the existing 'user' schema with auth fields
        userSchema: {
          name: 'user', // Use existing user schema
          fields: {
            email: 'email', // Field already exists in schema
            password: 'password', // Will be auto-added (internal)
            role: 'role', // Field already exists in schema
          },
          // Extra fields to add to user schema (optional)
          extraFields: [
            // { name: 'firstName', type: 'string', required: true },
            // { name: 'lastName', type: 'string', required: true },
          ],
        },

        // JWT configuration
        jwt: {
          secret: process.env.JWT_SECRET || 'your-super-secret-jwt-key-min-32-chars-long',
          expiresIn: '7d', // Token expires in 7 days
          algorithm: 'HS256',
          issuer: 'forja-nextjs-app',
          audience: 'forja-api',
        },

        // Session configuration (optional, can use JWT only)
        session: {
          store: 'memory', // Use 'redis' or 'database' in production
          maxAge: 86400, // 24 hours
          checkPeriod: 3600, // Cleanup every hour
          prefix: 'forja:session:',
        },

        // RBAC (Role-Based Access Control)
        rbac: {
          roles: [
            // Admin role - full access
            {
              name: 'admin',
              permissions: [
                { resource: 'user', action: 'create' },
                { resource: 'user', action: 'read' },
                { resource: 'user', action: 'update' },
                { resource: 'user', action: 'delete' },
                { resource: 'topic', action: 'create' },
                { resource: 'topic', action: 'read' },
                { resource: 'topic', action: 'update' },
                { resource: 'topic', action: 'delete' },
                { resource: 'comment', action: 'create' },
                { resource: 'comment', action: 'read' },
                { resource: 'comment', action: 'update' },
                { resource: 'comment', action: 'delete' },
                { resource: 'like', action: 'create' },
                { resource: 'like', action: 'read' },
                { resource: 'like', action: 'delete' },
              ],
            },

            // Moderator role - can moderate content
            {
              name: 'moderator',
              permissions: [
                { resource: 'user', action: 'read' },
                { resource: 'topic', action: 'read' },
                { resource: 'topic', action: 'update' },
                { resource: 'topic', action: 'delete' },
                { resource: 'comment', action: 'read' },
                { resource: 'comment', action: 'delete' },
              ],
            },

            // User role - basic access
            {
              name: 'user',
              permissions: [
                { resource: 'user', action: 'read' },
                { resource: 'topic', action: 'create' },
                { resource: 'topic', action: 'read' },
                { resource: 'topic', action: 'update' }, // Own topics only (enforced by hooks)
                { resource: 'comment', action: 'create' },
                { resource: 'comment', action: 'read' },
                { resource: 'comment', action: 'update' }, // Own comments only
                { resource: 'comment', action: 'delete' }, // Own comments only
                { resource: 'like', action: 'create' },
                { resource: 'like', action: 'read' },
                { resource: 'like', action: 'delete' }, // Own likes only
              ],
            },
          ],
          defaultRole: 'user', // New users get 'user' role by default
        },

        // Password hashing configuration
        password: {
          iterations: 100000, // PBKDF2 iterations
          keyLength: 64, // Hash length in bytes
          minLength: 8, // Minimum password length
        },

        // Auth endpoints configuration (optional, use defaults)
        endpoints: {
          login: '/auth/login', // POST /api/auth/login
          register: '/auth/register', // POST /api/auth/register
          logout: '/auth/logout', // POST /api/auth/logout
          me: '/auth/me', // GET /api/auth/me
          disableRegister: false, // Allow public registration
        },
      },

      // Auto-generate CRUD routes for schemas
      autoRoutes: true,

      // Exclude schemas from auto-generated routes (auth is always reserved)
      excludeSchemas: [], // e.g., ['internal', 'system']
    }),

    /**
     * Migration configuration
     */
    migration: {
      auto: process.env.NODE_ENV === 'development',
      directory: './migrations',
    },

    /**
     * Development options
     */
    dev: {
      logging: process.env.NODE_ENV === 'development',
      validateQueries: process.env.NODE_ENV === 'development',
      prettyErrors: process.env.NODE_ENV === 'development',
    },
  }
  return config
}
);
