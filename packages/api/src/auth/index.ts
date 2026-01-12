/**
 * Auth Module
 *
 * Exports authentication and authorization functionality
 */

// Manager
export {
  AuthManager,
  AuthError,
  createAuthManager,
  type AuthUser,
  type AuthContext,
  type LoginResult,
  type PermissionAction,
} from './manager';

// Password utilities
export {
  PasswordManager,
  PasswordError,
  createPasswordManager,
  type PasswordHash,
  type PasswordConfig,
} from './password';

// JWT utilities
export { JwtStrategy, createJwtStrategy } from './jwt';

// Session utilities
export {
  SessionStrategy,
  MemorySessionStore,
  createSessionStrategy,
} from './session';

// RBAC utilities
export { RbacManager, PredefinedRoles, createRbacManager } from './rbac';
