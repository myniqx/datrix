# BasePlugin Class

> Reference for BasePlugin class methods and properties.

---

## Class Signature

```typescript
abstract class BasePlugin<TOptions = Record<string, unknown>> implements ForjaPlugin<TOptions> {
  abstract readonly name: string
  abstract readonly version: string
  readonly options: TOptions

  constructor(options: TOptions)

  // Required abstract methods
  abstract init(context: PluginContext): Promise<Result<void, PluginError>>
  abstract destroy(): Promise<Result<void, PluginError>>

  // Optional lifecycle hooks
  async onSchemaLoad(schemas: SchemaRegistry): Promise<void>
  async onBeforeQuery(query: QueryObject): Promise<QueryObject>
  async onAfterQuery<TResult>(result: TResult): Promise<TResult>

  // Protected helpers
  protected validateOptions(validator: Function, errorMessage: string): Result<TOptions, PluginError>
  protected isInitialized(): boolean
  protected getContext(): Result<PluginContext, PluginError>
  protected createError(message: string, code: string, details?: unknown): PluginError
}
```

---

## Abstract Properties

Must be implemented by plugin:

```typescript
class MyPlugin extends BasePlugin {
  readonly name = 'my-plugin';      // Plugin identifier
  readonly version = '1.0.0';       // Semantic version
}
```

---

## Abstract Methods

### init()

Initialize plugin resources.

```typescript
async init(context: PluginContext): Promise<Result<void, PluginError>> {
  // Validate options
  const validation = this.validateOptions(
    (opts): opts is MyPluginOptions => {
      return typeof opts === 'object' && 'someField' in opts;
    },
    'Invalid plugin options'
  );

  if (!validation.success) {
    return validation;
  }

  // Setup resources
  // Store context
  this.context = context;

  return { success: true, data: undefined };
}
```

### destroy()

Cleanup plugin resources.

```typescript
async destroy(): Promise<Result<void, PluginError>> {
  // Close connections
  // Clear caches
  // Release resources

  return { success: true, data: undefined };
}
```

---

## Optional Hook Methods

### onSchemaLoad()

Called when schemas are registered.

```typescript
async onSchemaLoad(schemas: SchemaRegistry): Promise<void> {
  // Access schemas
  const userSchema = schemas.get('User');

  // Optionally modify schemas
  // Add computed fields, etc.
}
```

### onBeforeQuery()

Intercept queries before execution.

```typescript
async onBeforeQuery(query: QueryObject): Promise<QueryObject> {
  // Modify query
  if (query.type === 'select') {
    return {
      ...query,
      where: {
        ...query.where,
        deletedAt: { $null: true }  // Example: soft delete filter
      }
    };
  }

  return query;
}
```

### onAfterQuery()

Transform query results.

```typescript
async onAfterQuery<TResult>(result: TResult): Promise<TResult> {
  // Transform result
  if (Array.isArray(result)) {
    return result.map(item => ({
      ...item,
      // Add computed field
    })) as TResult;
  }

  return result;
}
```

---

## Protected Helper Methods

### validateOptions()

Validate plugin options with type guard.

```typescript
const validation = this.validateOptions(
  (opts): opts is MyPluginOptions => {
    return typeof opts === 'object' &&
           'requiredField' in opts &&
           typeof opts.requiredField === 'string';
  },
  'Invalid plugin options: requiredField must be a string'
);

if (!validation.success) {
  return validation;
}

// opts is now typed as MyPluginOptions
const { requiredField } = this.options;
```

### isInitialized()

Check if plugin is initialized.

```typescript
if (!this.isInitialized()) {
  throw new Error('Plugin not initialized');
}
```

### getContext()

Get plugin context (only after init).

```typescript
const contextResult = this.getContext();

if (!contextResult.success) {
  return contextResult;
}

const { schemas, adapter } = contextResult.data;
```

### createError()

Create typed plugin error.

```typescript
return {
  success: false,
  error: this.createError(
    'Database connection failed',
    'DB_CONNECTION_ERROR',
    { host: 'localhost', port: 5432 }
  )
};
```

---

## Plugin Context

Provided to `init()` method:

```typescript
interface PluginContext {
  readonly schemas: SchemaRegistry      // All registered schemas
  readonly adapter: DatabaseAdapter     // Database adapter
  readonly dispatcher: Dispatcher       // Hook dispatcher
}
```

---

## Error Codes

Common plugin error codes:

- `INIT_ERROR` - Initialization failed
- `DESTROY_ERROR` - Cleanup failed
- `INVALID_OPTIONS` - Options validation failed
- `NOT_INITIALIZED` - Plugin not initialized
- `UNKNOWN_ERROR` - Unexpected error

---

## Best Practices

**1. Validate options in init()**
```typescript
async init(context: PluginContext): Promise<Result<void, PluginError>> {
  const validation = this.validateOptions(...);
  if (!validation.success) return validation;

  // Continue with initialization
}
```

**2. Store context for later use**
```typescript
private context?: PluginContext;

async init(context: PluginContext): Promise<Result<void, PluginError>> {
  this.context = context;
  // ...
}
```

**3. Clean up in destroy()**
```typescript
async destroy(): Promise<Result<void, PluginError>> {
  // Close all connections
  // Clear all caches
  // Set context to undefined
  this.context = undefined;

  return { success: true, data: undefined };
}
```

**4. Use Result pattern consistently**
```typescript
// ❌ Don't throw
async init() {
  throw new Error('Failed');
}

// ✅ Return Result
async init(): Promise<Result<void, PluginError>> {
  return {
    success: false,
    error: this.createError('Failed', 'INIT_ERROR')
  };
}
```

---

## Reference

**Source Code:**
- BasePlugin class - `packages/core/src/plugin/base.ts`
- Plugin types - `packages/types/src/plugin.ts`
- Plugin errors - `packages/types/src/errors.ts`

**Related:**
- [Getting Started](./getting-started.md)
- [Hooks](./hooks.md)
- [Schema Access](./schema-access.md)
