/**
 * User API Routes - Next.js App Router
 *
 * RESTful CRUD endpoints for User resource:
 * - GET    /api/users       - List all users (with filters, pagination)
 * - GET    /api/users/:id   - Get single user
 * - POST   /api/users       - Create user
 * - PUT    /api/users/:id   - Update user
 * - DELETE /api/users/:id   - Delete user
 *
 * This example demonstrates:
 * - Next.js App Router integration
 * - Authentication with JWT
 * - RBAC permissions
 * - Request/response handling
 * - Error handling
 */

import { createHandlers } from 'forja/api';
import { buildContextFromNextApp } from 'forja/api/context';
import { userSchema } from '@/schemas/user.schema';
import config from '@/forja.config';
import type { NextRequest } from 'next/server';

/**
 * Create CRUD handlers with configuration
 *
 * This creates type-safe handlers for all HTTP methods
 */
const handlers = createHandlers({
  // Schema definition
  schema: userSchema,

  // Database adapter
  adapter: config.adapter,

  /**
   * Permissions (RBAC)
   *
   * Define who can perform each operation
   */
  permissions: {
    // Anyone can read user profiles (public data)
    read: undefined, // No restriction

    // Only admins can create users through API
    // (Normal registration should use /api/auth/register)
    create: ['admin'],

    // Users can update their own profile, admins can update any
    update: (context) => {
      const userId = context.user?.id;
      const targetUserId = context.params['id'];
      const userRole = context.user?.role;

      // Admin can update anyone
      if (userRole === 'admin') {
        return true;
      }

      // Users can update themselves
      return userId === targetUserId;
    },

    // Only admins can delete users
    delete: ['admin'],
  },

  /**
   * Middleware
   *
   * Custom middleware for additional processing
   */
  middleware: [
    // Authentication middleware - extract user from JWT
    async (context, next) => {
      const authHeader = context.headers['authorization'];

      if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.substring(7);

        // Verify JWT token (simplified - use auth plugin in production)
        try {
          // In production, use: const user = await authPlugin.verifyToken(token);
          const decoded = await verifyJWT(token);
          context.user = decoded;
        } catch (error) {
          // Invalid token - continue without user (will fail permission check if needed)
          console.warn('Invalid JWT token:', error);
        }
      }

      return await next();
    },

    // Logging middleware
    async (context, next) => {
      const start = Date.now();
      console.log(`[API] ${context.method} ${context.params['id'] ? `/api/users/${context.params['id']}` : '/api/users'}`);

      const response = await next();

      const duration = Date.now() - start;
      console.log(`[API] ${response.status} (${duration}ms)`);

      return response;
    },
  ],

  /**
   * Lifecycle Hooks
   *
   * Additional hooks on top of schema hooks
   */
  hooks: {
    // Before find - filter out sensitive data
    beforeFind: async (context, query) => {
      // Regular users shouldn't see other users' email verification status
      if (context.user?.role !== 'admin') {
        // Remove sensitive fields from selection
        if (query.select && Array.isArray(query.select)) {
          query.select = query.select.filter(
            (field) => !['emailVerified', 'lastLogin'].includes(field)
          );
        }
      }

      return query;
    },

    // After find - additional data sanitization
    afterFind: async (context, data) => {
      // Schema hooks already remove password
      // Add any additional sanitization here
      return data;
    },

    // Before update - prevent role changes by non-admins
    beforeUpdate: async (context, id, data) => {
      // Only admins can change roles
      if (data['role'] && context.user?.role !== 'admin') {
        delete data['role'];
      }

      // Users can't verify their own email
      if (data['emailVerified'] && context.user?.role !== 'admin') {
        delete data['emailVerified'];
      }

      return data;
    },

    // After delete - cleanup related data
    afterDelete: async (context, id) => {
      // In production, you might want to:
      // - Delete user's uploaded files
      // - Send notification
      // - Log audit trail
      console.log(`[Audit] User ${id} deleted by ${context.user?.id}`);
    },
  },

  /**
   * API Options
   */
  options: {
    maxPageSize: 100,
    defaultPageSize: 25,
    maxPopulateDepth: 3,
  },
});

/**
 * GET Handler
 *
 * Handles:
 * - GET /api/users       (list all users)
 * - GET /api/users/:id   (get single user)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { forja?: string[] } }
): Promise<Response> {
  // Build request context from Next.js request
  const context = await buildContextFromNextApp(request, params);

  // Execute handler
  const response = await handlers.GET(context);

  // Return Next.js Response
  return new Response(JSON.stringify(response.body), {
    status: response.status,
    headers: {
      'Content-Type': 'application/json',
      // CORS headers (configure based on your needs)
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

/**
 * POST Handler
 *
 * Handles:
 * - POST /api/users (create user)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { forja?: string[] } }
): Promise<Response> {
  const context = await buildContextFromNextApp(request, params);
  const response = await handlers.POST(context);

  return new Response(JSON.stringify(response.body), {
    status: response.status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

/**
 * PUT Handler
 *
 * Handles:
 * - PUT /api/users/:id (update user)
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { forja?: string[] } }
): Promise<Response> {
  const context = await buildContextFromNextApp(request, params);
  const response = await handlers.PUT(context);

  return new Response(JSON.stringify(response.body), {
    status: response.status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

/**
 * PATCH Handler
 *
 * Handles:
 * - PATCH /api/users/:id (partial update)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { forja?: string[] } }
): Promise<Response> {
  const context = await buildContextFromNextApp(request, params);
  const response = await handlers.PATCH(context);

  return new Response(JSON.stringify(response.body), {
    status: response.status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

/**
 * DELETE Handler
 *
 * Handles:
 * - DELETE /api/users/:id (delete user)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { forja?: string[] } }
): Promise<Response> {
  const context = await buildContextFromNextApp(request, params);
  const response = await handlers.DELETE(context);

  return new Response(JSON.stringify(response.body), {
    status: response.status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

/**
 * OPTIONS Handler
 *
 * CORS preflight request
 */
export async function OPTIONS(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400', // 24 hours
    },
  });
}

/**
 * Helper Functions
 */

/**
 * Verify JWT token
 *
 * In production, use the auth plugin:
 * ```typescript
 * import { authPlugin } from '@/forja.config';
 * const user = await authPlugin.verifyToken(token);
 * ```
 */
async function verifyJWT(token: string): Promise<{
  id: string;
  email: string;
  role: string;
}> {
  // Simplified JWT verification
  // In production, use proper JWT library or auth plugin

  try {
    // Decode JWT (basic implementation)
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid token format');
    }

    const payload = JSON.parse(
      Buffer.from(parts[1] ?? '', 'base64').toString('utf-8')
    );

    // Verify expiration
    if (payload.exp && payload.exp < Date.now() / 1000) {
      throw new Error('Token expired');
    }

    // Verify signature (simplified - use crypto.verify in production)
    const secret = process.env.JWT_SECRET!;
    // TODO: Verify signature with HMAC

    return {
      id: payload.userId,
      email: payload.email,
      role: payload.role,
    };
  } catch (error) {
    throw new Error('Invalid token');
  }
}

/**
 * Example Requests:
 *
 * 1. List all users (paginated)
 * GET /api/users?page=1&pageSize=25
 *
 * 2. Get user with populated posts
 * GET /api/users/123?populate[posts][fields][0]=title&populate[posts][fields][1]=status
 *
 * 3. Search users by role
 * GET /api/users?where[role]=admin
 *
 * 4. Create user (admin only)
 * POST /api/users
 * Headers: { Authorization: "Bearer <admin_token>" }
 * Body: { email, password, name, role }
 *
 * 5. Update user
 * PUT /api/users/123
 * Headers: { Authorization: "Bearer <user_token>" }
 * Body: { name, bio, avatar }
 *
 * 6. Delete user (admin only)
 * DELETE /api/users/123
 * Headers: { Authorization: "Bearer <admin_token>" }
 */
