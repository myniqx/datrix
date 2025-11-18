/**
 * Base Plugin Module
 *
 * Exports base plugin types and abstract class
 */

export type {
  ForjaPlugin,
  PluginContext,
  PluginConfig,
  PluginError,
  ForjaConfig,
  HookContext,
  HookHandler,
  LifecycleHooks,
  JwtPayload,
  SessionData,
  AuthUser,
  AuthError,
  Permission,
  Role,
  UploadFile,
  UploadResult,
  UploadError,
  StorageProvider,
  SoftDeleteOptions,
  SoftDeleteInterceptor,
  HookRegistration,
  HooksManager,
  ValidationRule,
  FieldValidation,
  ValidationResult,
  ValidationErrorDetail,
  Middleware,
  PluginFactory,
  OptionsValidator,
} from './types';

export {
  PluginRegistry,
  isForjaPlugin,
  createOptionsValidator,
} from './types';

export { BasePlugin } from './plugin';
