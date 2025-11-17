/**
 * Plugins Module
 *
 * Exports all available plugins and base plugin infrastructure
 */

// Base plugin infrastructure
export type {
  ForjaPlugin,
  PluginContext,
  PluginConfig,
  PluginError,
  HookContext,
  HookHandler,
  LifecycleHooks,
} from './base/types';

export { BasePlugin } from './base/plugin';
export { PluginRegistry, isForjaPlugin } from './base/types';

// Auth plugin
export {
  AuthPlugin,
  createAuthPlugin,
  JwtStrategy,
  createJwtStrategy,
  SessionStrategy,
  MemorySessionStore,
  createSessionStrategy,
  RbacManager,
  PredefinedRoles,
  createRbacManager,
} from './auth';

export type {
  AuthPluginOptions,
  AuthUser,
  LoginCredentials,
  LoginResult,
  PasswordHash,
  AuthContext,
  JwtPayload,
  SessionData,
  SessionStore,
  Permission,
  Role,
  PermissionAction,
  JwtConfig,
  SessionConfig,
  RbacConfig,
  PermissionCheckResult,
} from './auth';
