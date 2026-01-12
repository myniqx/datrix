/**
 * Next.js API Route - Forja Handler
 *
 * ✨ ULTRA-MINIMAL IMPLEMENTATION - Single line handler!
 *
 * This route handles ALL API requests:
 * - Authentication (JWT/Session)
 * - Authorization (RBAC)
 * - CRUD operations (findMany, findOne, create, update, delete)
 * - Query parsing (where, populate, fields, sort, pagination)
 *
 * Examples:
 * - GET    /api/user              -> List users
 * - GET    /api/user/123          -> Get user by ID
 * - POST   /api/user              -> Create user
 * - PATCH  /api/user/123          -> Update user
 * - DELETE /api/user/123          -> Delete user
 * - GET    /api/user?where[role]=admin&populate[topics]=*
 *
 * Auth endpoints (automatically handled):
 * - POST /api/auth/register      -> Register new user
 * - POST /api/auth/login         -> Login user
 * - POST /api/auth/logout        -> Logout user
 * - GET  /api/auth/me            -> Get current user
 */

import { getForja } from 'forja-core';
import { handleRequest } from 'forja-api';
import '../../../../../forja.config';

/**
 * Unified request handler
 *
 * All logic handled by handleRequest helper:
 * - Config validation
 * - API enabled check
 * - Initialization
 * - Auth routing
 * - CRUD routing
 * - Error handling
 */
async function handler(request: Request): Promise<Response> {
  return handleRequest(await getForja(), request);
}

// Export for all HTTP methods
export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const PUT = handler;
export const DELETE = handler;
