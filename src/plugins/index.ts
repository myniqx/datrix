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

// Hooks plugin
export {
  HooksPlugin,
  createHooksPlugin,
  HooksManager,
  createHooksManager,
  HookError,
  HookRegistrationError,
} from './hooks';

export type {
  HooksPluginOptions,
  HookName,
  HookRegistration,
} from './hooks';

// Soft delete plugin
export {
  SoftDeletePlugin,
  createSoftDeletePlugin,
  SoftDeleteInterceptor,
  createSoftDeleteInterceptor,
  SoftDeleteError,
} from './soft-delete';

export type {
  SoftDeleteOptions,
  SoftDeleteQueryOptions,
  SoftDeleteMode,
  SoftDeleteInterceptorInterface,
} from './soft-delete';

// Upload plugin
export {
  UploadPlugin,
  createUploadPlugin,
  LocalStorageProvider,
  createLocalStorageProvider,
  S3StorageProvider,
  createS3StorageProvider,
  UploadError,
  FileValidationError,
  isStorageProvider,
  isUploadFile,
  validateUploadFile,
  generateUniqueFilename,
  sanitizeFilename,
  getFileExtension,
} from './upload';

export type {
  UploadPluginOptions,
  UploadFile,
  UploadResult,
  StorageProvider,
  FileValidationOptions,
  LocalProviderOptions,
  S3ProviderOptions,
} from './upload';
