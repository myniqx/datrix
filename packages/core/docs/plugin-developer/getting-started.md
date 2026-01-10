# Plugin Development - Getting Started

> Overview of Forja plugin architecture and development workflow.

---

## Overview

Forja plugins extend core functionality through lifecycle hooks and query interception. Plugins can modify schemas, intercept queries, and add custom behavior without modifying core code.

---

## Plugin Architecture

```typescript
abstract class BasePlugin<TOptions> implements ForjaPlugin<TOptions> {
  abstract readonly name: string
  abstract readonly version: string
  readonly options: TOptions

  abstract init(context: PluginContext): Promise<Result<void, PluginError>>
  abstract destroy(): Promise<Result<void, PluginError>>

  async onSchemaLoad(schemas: SchemaRegistry): Promise<void>
  async onBeforeQuery(query: QueryObject): Promise<QueryObject>
  async onAfterQuery<TResult>(result: TResult): Promise<TResult>
}
```

---

## Plugin Lifecycle

1. **Initialization** - `init(context)`
   - Plugin setup
   - Resource allocation
   - Configuration validation

2. **Schema Load** - `onSchemaLoad(schemas)`
   - Access to all registered schemas
   - Schema modification (if needed)

3. **Runtime** - `onBeforeQuery()`, `onAfterQuery()`
   - Query interception
   - Result transformation

4. **Shutdown** - `destroy()`
   - Cleanup
   - Resource deallocation

---

## Basic Plugin

```typescript
import { BasePlugin, PluginContext, PluginError } from 'forja-core';

interface MyPluginOptions {
  enabled: boolean;
  config: string;
}

class MyPlugin extends BasePlugin<MyPluginOptions> {
  readonly name = 'my-plugin';
  readonly version = '1.0.0';

  async init(context: PluginContext): Promise<Result<void, PluginError>> {
    // Setup logic
    return { success: true, data: undefined };
  }

  async destroy(): Promise<Result<void, PluginError>> {
    // Cleanup logic
    return { success: true, data: undefined };
  }
}
```

---

## Plugin Options

Define typed options for plugin configuration:

```typescript
interface AuthPluginOptions {
  jwt: {
    secret: string;
    expiresIn: string;
  };
  session: {
    store: 'memory' | 'redis';
  };
}

class AuthPlugin extends BasePlugin<AuthPluginOptions> {
  async init(context: PluginContext): Promise<Result<void, PluginError>> {
    // Validate options
    const validation = this.validateOptions(
      (opts): opts is AuthPluginOptions => {
        return typeof opts === 'object' &&
               'jwt' in opts &&
               typeof opts.jwt.secret === 'string';
      },
      'Invalid auth plugin options'
    );

    if (!validation.success) {
      return validation;
    }

    // Use validated options
    const { jwt, session } = this.options;

    return { success: true, data: undefined };
  }

  async destroy(): Promise<Result<void, PluginError>> {
    return { success: true, data: undefined };
  }
}
```

---

## Plugin Context

The `PluginContext` provides access to core functionality:

```typescript
interface PluginContext {
  readonly schemas: SchemaRegistry;
  readonly adapter: DatabaseAdapter;
  readonly dispatcher: Dispatcher;
}
```

**Access in plugin:**
```typescript
async init(context: PluginContext): Promise<Result<void, PluginError>> {
  // Access schemas
  const userSchema = context.schemas.get('User');

  // Access adapter
  await context.adapter.connect();

  // Store context for later use
  this.context = context;

  return { success: true, data: undefined };
}
```

---

## Error Handling

Use `Result` pattern for all plugin methods:

```typescript
async init(context: PluginContext): Promise<Result<void, PluginError>> {
  try {
    // Setup logic
    if (someCondition) {
      return {
        success: false,
        error: this.createError(
          'Initialization failed',
          'INIT_ERROR',
          { detail: 'Some detail' }
        )
      };
    }

    return { success: true, data: undefined };
  } catch (error) {
    return {
      success: false,
      error: this.createError(
        'Unexpected error',
        'UNKNOWN_ERROR',
        error
      )
    };
  }
}
```

---

## Plugin Registration

Plugins are registered at application startup:

```typescript
import { PluginRegistry } from 'forja-core';

const registry = new PluginRegistry();

registry.register(new AuthPlugin({
  jwt: { secret: process.env.JWT_SECRET!, expiresIn: '7d' },
  session: { store: 'memory' }
}));

registry.register(new UploadPlugin({
  provider: 'local',
  uploadDir: './uploads'
}));
```

---

## Plugin Examples

**Built-in plugins:**
- Auth Plugin - JWT, sessions, RBAC
- Upload Plugin - File storage (local, S3)
- Hooks Plugin - Lifecycle hooks (beforeCreate, afterUpdate, etc.)
- Soft Delete Plugin - Soft delete with `deletedAt` field

**Source code:**
- `packages/plugins/auth/`
- `packages/plugins/upload/`
- `packages/plugins/hooks/`
- `packages/plugins/soft-delete/`

---

## Development Workflow

1. **Create plugin class**
   ```bash
   mkdir packages/plugins/my-plugin
   cd packages/plugins/my-plugin
   ```

2. **Extend BasePlugin**
   ```typescript
   class MyPlugin extends BasePlugin<MyPluginOptions> {
     // Implementation
   }
   ```

3. **Implement required methods**
   - `init()`
   - `destroy()`

4. **Implement hooks** (optional)
   - `onSchemaLoad()`
   - `onBeforeQuery()`
   - `onAfterQuery()`

5. **Write tests**
   - See [Testing Guidelines](../../../../tests/CLAUDE.md)

6. **Document plugin**
   - README with usage examples
   - TypeScript types for options

---

## Next Steps

- [Base Plugin](./base-plugin.md) - BasePlugin class methods
- [Hooks](./hooks.md) - Lifecycle and query hooks
- [Schema Access](./schema-access.md) - SchemaRegistry API
- [Validation](./validation.md) - Using validator in plugins

---

## Reference

**Source Code:**
- BasePlugin - `packages/core/src/plugin/base.ts`
- Plugin types - `packages/types/src/plugin.ts`
- Dispatcher - `packages/core/src/dispatcher.ts`
- Plugin registry - (see forja main package)

**Example Plugins:**
- Auth Plugin - `packages/plugins/auth/`
- Upload Plugin - `packages/plugins/upload/`
- Hooks Plugin - `packages/plugins/hooks/`
- Soft Delete Plugin - `packages/plugins/soft-delete/`

**Related:**
- [Testing Guidelines](../../../../tests/CLAUDE.md)
