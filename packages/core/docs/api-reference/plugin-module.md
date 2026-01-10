# Plugin Module API Reference

> Complete API reference for plugin module.

---

## Classes

### BasePlugin

```typescript
abstract class BasePlugin<TOptions = Record<string, unknown>> implements ForjaPlugin<TOptions> {
  abstract readonly name: string
  abstract readonly version: string
  readonly options: TOptions

  constructor(options: TOptions)

  // Required abstract methods
  abstract init(
    context: PluginContext
  ): Promise<Result<void, PluginError>>

  abstract destroy(): Promise<Result<void, PluginError>>

  // Optional lifecycle hooks
  async onSchemaLoad(schemas: SchemaRegistry): Promise<void>

  async onBeforeQuery(query: QueryObject): Promise<QueryObject>

  async onAfterQuery<TResult>(result: TResult): Promise<TResult>

  // Protected helpers
  protected validateOptions(
    validator: (opts: unknown) => opts is TOptions,
    errorMessage: string
  ): Result<TOptions, PluginError>

  protected isInitialized(): boolean

  protected getContext(): Result<PluginContext, PluginError>

  protected createError(
    message: string,
    code: string,
    details?: unknown
  ): PluginError
}
```

### Dispatcher

```typescript
class Dispatcher {
  constructor(registry: PluginRegistry)

  async dispatchSchemaLoad(schemas: SchemaRegistry): Promise<void>

  async dispatchBeforeQuery(query: QueryObject): Promise<QueryObject>

  async dispatchAfterQuery<TResult>(result: TResult): Promise<TResult>
}
```

---

## Factory Functions

```typescript
function createDispatcher(registry: PluginRegistry): Dispatcher
```

---

## Types

```typescript
interface ForjaPlugin<TOptions = Record<string, unknown>> {
  readonly name: string
  readonly version: string
  readonly options: TOptions

  init(context: PluginContext): Promise<Result<void, PluginError>>
  destroy(): Promise<Result<void, PluginError>>

  onSchemaLoad?(schemas: SchemaRegistry): Promise<void>
  onBeforeQuery?(query: QueryObject): Promise<QueryObject>
  onAfterQuery?<TResult>(result: TResult): Promise<TResult>
}

interface PluginContext {
  readonly schemas: SchemaRegistry
  readonly adapter: DatabaseAdapter
  readonly dispatcher: Dispatcher
}

interface PluginError extends Error {
  readonly code: string
  readonly pluginName?: string
  readonly details?: unknown
}
```

---

## Source

- BasePlugin - `packages/core/src/plugin/base.ts`
- Dispatcher - `packages/core/src/dispatcher.ts`
- Plugin types - `packages/types/src/plugin.ts`
