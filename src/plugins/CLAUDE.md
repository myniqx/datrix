# Plugins Module - Development Guidelines

## 📖 Module Overview

The Plugins module provides optional, modular features that extend Forja's core functionality:
- **Auth**: JWT, Session, RBAC (Role-Based Access Control)
- **Upload**: File upload with S3 and local storage providers
- **Hooks**: Lifecycle hooks (beforeCreate, afterUpdate, etc.)
- **Soft Delete**: Soft delete functionality with deletedAt field

**Key Principle:** Plugins MUST be tree-shakeable. Users only pay the bundle cost for plugins they use.

---

## 🎯 Plugin Interface Contract

**ALL plugins MUST implement this interface** (defined in `src/plugins/base/types.ts`):

```typescript
interface ForjaPlugin<TOptions = Record<string, unknown>> {
  // Metadata
  readonly name: string;
  readonly version: string;
  readonly options: TOptions;

  // Lifecycle
  init(context: PluginContext): Promise<Result<void, PluginError>>;
  destroy(): Promise<Result<void, PluginError>>;

  // Optional hooks
  onSchemaLoad?(schemas: SchemaRegistry): Promise<void>;
  onBeforeQuery?(query: QueryObject): Promise<QueryObject>;
  onAfterQuery?<TResult>(result: TResult): Promise<TResult>;
}

interface PluginContext {
  readonly adapter: DatabaseAdapter;
  readonly schemas: SchemaRegistry;
  readonly config: ForjaConfig;
}
```

---

## 🔌 Plugin Implementation Requirements

### 1. Type Safety
```typescript
// Define plugin-specific options type
interface AuthPluginOptions {
  readonly jwt?: {
    readonly secret: string;
    readonly expiresIn?: string; // '1h', '7d', etc.
    readonly algorithm?: 'HS256' | 'HS512' | 'RS256';
  };
  readonly session?: {
    readonly store?: 'memory' | 'redis';
    readonly maxAge?: number;
  };
  readonly providers?: readonly AuthProvider[];
}

// Implement plugin
class AuthPlugin implements ForjaPlugin<AuthPluginOptions> {
  readonly name = 'auth' as const;
  readonly version = '0.1.0';
  readonly options: AuthPluginOptions;

  constructor(options: AuthPluginOptions) {
    this.options = options;
  }

  async init(context: PluginContext): Promise<Result<void, PluginError>> {
    // Initialize plugin
  }

  async destroy(): Promise<Result<void, PluginError>> {
    // Cleanup
  }
}
```

### 2. Error Handling
```typescript
// Use Result pattern
async init(context: PluginContext): Promise<Result<void, PluginError>> {
  try {
    // Validate options
    const validation = this.validateOptions();
    if (!validation.success) {
      return {
        success: false,
        error: new PluginError('Invalid options', { details: validation.error })
      };
    }

    // Initialize
    await this.setupJwt();

    return { success: true, data: undefined };
  } catch (error) {
    return {
      success: false,
      error: new PluginError('Initialization failed', { originalError: error })
    };
  }
}
```

### 3. Plugin Registration
```typescript
// plugins/index.ts
export { AuthPlugin } from './auth';
export { UploadPlugin } from './upload';
export { HooksPlugin } from './hooks';
export { SoftDeletePlugin } from './soft-delete';

// User usage
import { AuthPlugin } from 'forja/plugins';

const auth = new AuthPlugin({
  jwt: { secret: process.env.JWT_SECRET }
});
```

---

## 🔐 Auth Plugin

**File Structure:**
```
plugins/auth/
├── index.ts       # AuthPlugin class
├── jwt.ts         # JWT strategy
├── session.ts     # Session strategy
├── rbac.ts        # Role-based access control
├── types.ts       # Auth types
└── middleware.ts  # Auth middleware for route handlers
```

### JWT Strategy
```typescript
interface JwtPayload {
  readonly userId: string;
  readonly role: string;
  readonly iat: number;
  readonly exp: number;
}

class JwtStrategy {
  private readonly secret: string;
  private readonly expiresIn: string;

  constructor(options: { secret: string; expiresIn?: string }) {
    this.secret = options.secret;
    this.expiresIn = options.expiresIn ?? '1h';
  }

  async sign(payload: Omit<JwtPayload, 'iat' | 'exp'>): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const exp = now + this.parseExpiry(this.expiresIn);

    const fullPayload: JwtPayload = {
      ...payload,
      iat: now,
      exp
    };

    // Implement JWT signing (custom implementation to avoid jose/jsonwebtoken dependency)
    return this.createToken(fullPayload);
  }

  async verify(token: string): Promise<Result<JwtPayload, AuthError>> {
    try {
      const payload = await this.decodeToken(token);

      // Check expiry
      const now = Math.floor(Date.now() / 1000);
      if (payload.exp < now) {
        return {
          success: false,
          error: new AuthError('Token expired')
        };
      }

      return { success: true, data: payload };
    } catch (error) {
      return {
        success: false,
        error: new AuthError('Invalid token', { originalError: error })
      };
    }
  }

  // Custom JWT implementation using crypto
  private async createToken(payload: JwtPayload): Promise<string> {
    const header = { alg: 'HS256', typ: 'JWT' };
    const encodedHeader = this.base64UrlEncode(JSON.stringify(header));
    const encodedPayload = this.base64UrlEncode(JSON.stringify(payload));

    const signature = await this.sign256(`${encodedHeader}.${encodedPayload}`);

    return `${encodedHeader}.${encodedPayload}.${signature}`;
  }

  private async sign256(data: string): Promise<string> {
    const crypto = await import('crypto');
    const hmac = crypto.createHmac('sha256', this.secret);
    hmac.update(data);
    return this.base64UrlEncode(hmac.digest('base64'));
  }

  private base64UrlEncode(str: string): string {
    return Buffer.from(str)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  }

  private parseExpiry(expiry: string): number {
    const match = expiry.match(/^(\d+)([smhd])$/);
    if (!match) return 3600; // default 1 hour

    const [, num, unit] = match;
    const value = parseInt(num ?? '1', 10);

    const multipliers = { s: 1, m: 60, h: 3600, d: 86400 };
    return value * (multipliers[unit as keyof typeof multipliers] ?? 3600);
  }
}
```

### RBAC (Role-Based Access Control)
```typescript
interface Permission {
  readonly resource: string;
  readonly action: 'create' | 'read' | 'update' | 'delete';
}

interface Role {
  readonly name: string;
  readonly permissions: readonly Permission[];
}

class RBACManager {
  private readonly roles: Map<string, Role> = new Map();

  defineRole(role: Role): void {
    this.roles.set(role.name, role);
  }

  hasPermission(
    roleName: string,
    resource: string,
    action: Permission['action']
  ): boolean {
    const role = this.roles.get(roleName);
    if (!role) return false;

    return role.permissions.some(
      p => p.resource === resource && p.action === action
    );
  }

  checkPermission(
    userRoles: readonly string[],
    resource: string,
    action: Permission['action']
  ): boolean {
    return userRoles.some(role => this.hasPermission(role, resource, action));
  }
}

// Usage
const rbac = new RBACManager();

rbac.defineRole({
  name: 'admin',
  permissions: [
    { resource: '*', action: 'create' },
    { resource: '*', action: 'read' },
    { resource: '*', action: 'update' },
    { resource: '*', action: 'delete' }
  ]
});

rbac.defineRole({
  name: 'user',
  permissions: [
    { resource: 'posts', action: 'create' },
    { resource: 'posts', action: 'read' },
    { resource: 'posts', action: 'update' } // own posts only
  ]
});

// Check permission
const canDelete = rbac.checkPermission(['user'], 'posts', 'delete'); // false
```

---

## 📤 Upload Plugin

**File Structure:**
```
plugins/upload/
├── index.ts              # UploadPlugin class
├── types.ts              # Upload types
├── providers/
│   ├── base.ts           # StorageProvider interface
│   ├── local.ts          # Local filesystem provider
│   └── s3.ts             # AWS S3 provider
```

### Storage Provider Interface
```typescript
interface StorageProvider {
  readonly name: string;

  upload(file: UploadFile): Promise<Result<UploadResult, UploadError>>;
  delete(key: string): Promise<Result<void, UploadError>>;
  getUrl(key: string): Promise<string>;
  exists(key: string): Promise<boolean>;
}

interface UploadFile {
  readonly filename: string;
  readonly mimetype: string;
  readonly buffer: Buffer;
  readonly size: number;
}

interface UploadResult {
  readonly key: string;
  readonly url: string;
  readonly size: number;
}
```

### Local Storage Provider
```typescript
class LocalStorageProvider implements StorageProvider {
  readonly name = 'local' as const;
  private readonly basePath: string;
  private readonly baseUrl: string;

  constructor(options: { basePath: string; baseUrl: string }) {
    this.basePath = options.basePath;
    this.baseUrl = options.baseUrl;
  }

  async upload(file: UploadFile): Promise<Result<UploadResult, UploadError>> {
    try {
      const fs = await import('fs/promises');
      const path = await import('path');

      // Generate unique filename
      const key = this.generateKey(file.filename);
      const filePath = path.join(this.basePath, key);

      // Ensure directory exists
      await fs.mkdir(path.dirname(filePath), { recursive: true });

      // Write file
      await fs.writeFile(filePath, file.buffer);

      return {
        success: true,
        data: {
          key,
          url: `${this.baseUrl}/${key}`,
          size: file.size
        }
      };
    } catch (error) {
      return {
        success: false,
        error: new UploadError('Upload failed', { originalError: error })
      };
    }
  }

  async delete(key: string): Promise<Result<void, UploadError>> {
    try {
      const fs = await import('fs/promises');
      const path = await import('path');
      const filePath = path.join(this.basePath, key);
      await fs.unlink(filePath);
      return { success: true, data: undefined };
    } catch (error) {
      return {
        success: false,
        error: new UploadError('Delete failed', { originalError: error })
      };
    }
  }

  async getUrl(key: string): Promise<string> {
    return `${this.baseUrl}/${key}`;
  }

  async exists(key: string): Promise<boolean> {
    try {
      const fs = await import('fs/promises');
      const path = await import('path');
      const filePath = path.join(this.basePath, key);
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private generateKey(filename: string): string {
    const ext = filename.split('.').pop() ?? '';
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 15);
    return `${timestamp}-${random}.${ext}`;
  }
}
```

### S3 Storage Provider
```typescript
// Minimal S3 implementation without AWS SDK dependency
class S3StorageProvider implements StorageProvider {
  readonly name = 's3' as const;
  private readonly bucket: string;
  private readonly region: string;
  private readonly accessKeyId: string;
  private readonly secretAccessKey: string;

  constructor(options: {
    bucket: string;
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
  }) {
    this.bucket = options.bucket;
    this.region = options.region;
    this.accessKeyId = options.accessKeyId;
    this.secretAccessKey = options.secretAccessKey;
  }

  async upload(file: UploadFile): Promise<Result<UploadResult, UploadError>> {
    try {
      const key = this.generateKey(file.filename);

      // Implement S3 upload using fetch and AWS Signature V4
      await this.putObject(key, file.buffer, file.mimetype);

      return {
        success: true,
        data: {
          key,
          url: `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`,
          size: file.size
        }
      };
    } catch (error) {
      return {
        success: false,
        error: new UploadError('S3 upload failed', { originalError: error })
      };
    }
  }

  // Implement AWS Signature V4 signing
  private async putObject(
    key: string,
    buffer: Buffer,
    contentType: string
  ): Promise<void> {
    // Implementation using fetch + AWS Signature V4
    // This avoids dependency on aws-sdk
  }

  private generateKey(filename: string): string {
    const ext = filename.split('.').pop() ?? '';
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 15);
    return `uploads/${timestamp}-${random}.${ext}`;
  }

  async delete(key: string): Promise<Result<void, UploadError>> {
    // Implement DELETE object
  }

  async getUrl(key: string): Promise<string> {
    return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`;
  }

  async exists(key: string): Promise<boolean> {
    // Implement HEAD object
  }
}
```

---

## 🪝 Hooks Plugin

**File Structure:**
```
plugins/hooks/
├── index.ts       # HooksPlugin class
├── manager.ts     # Hook execution manager
├── types.ts       # Hook types
└── lifecycle.ts   # Lifecycle hook definitions
```

### Hook Types
```typescript
type HookHandler<TData = unknown, TResult = TData> = (
  data: TData,
  context: HookContext
) => Promise<TResult>;

interface HookContext {
  readonly modelName: string;
  readonly operation: 'create' | 'update' | 'delete' | 'find';
  readonly user?: { id: string; role: string };
}

type LifecycleHooks = {
  beforeCreate?: HookHandler;
  afterCreate?: HookHandler;
  beforeUpdate?: HookHandler;
  afterUpdate?: HookHandler;
  beforeDelete?: HookHandler;
  afterDelete?: HookHandler;
  beforeFind?: HookHandler;
  afterFind?: HookHandler;
};
```

### Hooks Manager
```typescript
class HooksManager {
  private readonly hooks: Map<string, LifecycleHooks> = new Map();

  registerHooks(modelName: string, hooks: LifecycleHooks): void {
    this.hooks.set(modelName, hooks);
  }

  async executeHook<TData, TResult = TData>(
    modelName: string,
    hookName: keyof LifecycleHooks,
    data: TData,
    context: HookContext
  ): Promise<TResult> {
    const modelHooks = this.hooks.get(modelName);
    if (!modelHooks) return data as unknown as TResult;

    const hook = modelHooks[hookName];
    if (!hook) return data as unknown as TResult;

    return await hook(data, context) as TResult;
  }
}

// Usage in query execution
async function createRecord(model: string, data: Record<string, unknown>) {
  // Before create hook
  const processedData = await hooksManager.executeHook(
    model,
    'beforeCreate',
    data,
    { modelName: model, operation: 'create' }
  );

  // Execute query
  const result = await adapter.executeQuery({
    type: 'insert',
    table: model,
    data: processedData
  });

  if (!result.success) return result;

  // After create hook
  const finalResult = await hooksManager.executeHook(
    model,
    'afterCreate',
    result.data,
    { modelName: model, operation: 'create' }
  );

  return { success: true, data: finalResult };
}
```

---

## 🗑️ Soft Delete Plugin

**File Structure:**
```
plugins/soft-delete/
├── index.ts        # SoftDeletePlugin class
├── interceptor.ts  # Query interceptor
└── types.ts        # Soft delete types
```

### Query Interceptor
```typescript
class SoftDeleteInterceptor {
  onBeforeQuery(query: QueryObject): QueryObject {
    // Automatically add deletedAt filter to SELECT queries
    if (query.type === 'select') {
      return {
        ...query,
        where: {
          ...query.where,
          deletedAt: null // Only fetch non-deleted records
        }
      };
    }

    // Convert DELETE to UPDATE with deletedAt
    if (query.type === 'delete') {
      return {
        type: 'update',
        table: query.table,
        where: query.where,
        data: {
          deletedAt: new Date()
        }
      };
    }

    return query;
  }

  // Method to bypass soft delete (hard delete)
  hardDelete(query: QueryObject): QueryObject {
    return query; // Return unmodified query
  }

  // Method to find deleted records
  findDeleted(query: QueryObject): QueryObject {
    if (query.type === 'select') {
      return {
        ...query,
        where: {
          ...query.where,
          deletedAt: { $ne: null }
        }
      };
    }
    return query;
  }
}
```

---

## ✅ Testing Requirements

### Tests Required For Each Plugin:
1. Plugin initialization
2. Options validation
3. Core functionality
4. Integration with core system
5. Error handling
6. Cleanup/destroy

---

## 🎯 Implementation Priority

1. **Hooks Plugin** (Foundation for others)
2. **Soft Delete Plugin** (Simple, useful)
3. **Auth Plugin** (Critical feature)
4. **Upload Plugin** (Complex, can be later)

---

## 🔑 Key Principles

1. **Interface Compliance** - MUST implement ForjaPlugin
2. **Tree-shakeable** - Users only import what they need
3. **Zero Required Dependencies** - Between plugins
4. **Type Safety** - No `any`, no assertions
5. **Result Pattern** - Never throw
6. **Minimal External Deps** - Custom implementations preferred

**Remember:** Plugins extend core functionality while maintaining modularity and type safety.
