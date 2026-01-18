/**
 * Auth Module
 *
 * Exports authentication functionality.
 * Note: Permission/RBAC is now schema-based (see middleware/permission.ts)
 */

// Manager
export {
  AuthManager,
  AuthError,
  type AuthUser,
  type AuthContext,
  type LoginResult,
} from "./manager";

// Password utilities
export {
  PasswordManager,
  PasswordError,
  createPasswordManager,
  type PasswordHash,
  type PasswordConfig,
} from "./password";

// JWT utilities
export { JwtStrategy, createJwtStrategy } from "./jwt";

// Session utilities
export {
  SessionStrategy,
  MemorySessionStore,
  createSessionStrategy,
} from "./session";

// Permission types (re-exported from forja-types)
export type { PermissionAction } from "forja-types/core/permission";
