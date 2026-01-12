# Plugin System - Development Guide

## 📖 Overview

Forja plugin sistemi, framework'ün core özelliklerini genişletmek için güçlü ve tip-güvenli bir yapı sağlar. Plugin'ler schema'ları modifiye edebilir, query'leri intercept edebilir ve lifecycle hook'ları ekleyebilir.

---

## 🎯 Plugin Capabilities

### 1. Schema Registration - Kendi Schema'larını Ekle

Plugin'in kendi tablolarını oluşturması için.

```typescript
class AuthPlugin extends BasePlugin {
  async getSchemas(): Promise<SchemaDefinition[]> {
    return [
      defineSchema({
        name: 'Session',
        fields: {
          id: { type: 'string', required: true },
          userId: { type: 'string', required: true },
          token: { type: 'string', required: true },
          expiresAt: { type: 'date', required: true },
        },
        indexes: [{ fields: ['token'], unique: true }],
      }),
    ];
  }
}
```

---

### 2. Schema Extension - Mevcut Schema'ları Genişlet

#### 2.1 Tüm Schema'lara Field Ekle

```typescript
class TimestampPlugin extends BasePlugin {
  async extendSchemas(context: SchemaExtensionContext): Promise<SchemaExtension[]> {
    return context.extendAll((schema) => ({
      fields: {
        createdAt: { type: 'date', required: true, autoCreate: true },
        updatedAt: { type: 'date', required: true, autoUpdate: true },
      },
    }));
  }
}
```

#### 2.2 Pattern ile Filtreleme

```typescript
class AuditPlugin extends BasePlugin<{ exclude?: string[] }> {
  async extendSchemas(context: SchemaExtensionContext): Promise<SchemaExtension[]> {
    return context.extendByPattern(
      {
        exclude: this.options.exclude || ['Session', 'RefreshToken'],
      },
      (schema) => ({
        fields: {
          createdBy: { type: 'string', required: false },
          updatedBy: { type: 'string', required: false },
        },
        indexes: [{ fields: ['createdBy'] }, { fields: ['updatedBy'] }],
      })
    );
  }
}
```

#### 2.3 Conditional Extension (Predicate)

```typescript
class SoftDeletePlugin extends BasePlugin {
  async extendSchemas(context: SchemaExtensionContext): Promise<SchemaExtension[]> {
    return context.extendWhere(
      (schema) => schema.softDelete === true,
      (schema) => ({
        fields: {
          deletedAt: { type: 'date', required: false },
        },
        indexes: [{ fields: ['deletedAt'] }],
      })
    );
  }
}
```

#### 2.4 Field Modification & Removal

```typescript
class FieldModifierPlugin extends BasePlugin {
  async extendSchemas(context: SchemaExtensionContext): Promise<SchemaExtension[]> {
    return [
      {
        targetSchema: 'User',
        modifyFields: {
          email: { unique: true },
        },
        removeFields: ['temporaryField'],
      },
    ];
  }
}
```

---

### 3. Query Interception - Query'leri Modifiye Et

#### 3.1 Before Query - Row Level Security

```typescript
class RowLevelSecurityPlugin extends BasePlugin {
  async onBeforeQuery(
    query: QueryObject,
    context: QueryContext
  ): Promise<QueryObject> {
    if (query.type === 'select' && context.user) {
      return {
        ...query,
        where: {
          $and: [query.where || {}, { userId: context.user.id }],
        },
      };
    }
    return query;
  }
}
```

#### 3.2 Before Query - Auto-populate Fields

```typescript
class AutoPopulatePlugin extends BasePlugin {
  async onBeforeQuery(query: QueryObject): Promise<QueryObject> {
    if (query.type === 'insert' && query.data) {
      return {
        ...query,
        data: {
          ...query.data,
          id: generateId(),
          createdAt: new Date(),
        },
      };
    }

    if (query.type === 'update' && query.data) {
      return {
        ...query,
        data: {
          ...query.data,
          updatedAt: new Date(),
        },
      };
    }

    return query;
  }
}
```

#### 3.3 Query Cancellation

```typescript
class PermissionPlugin extends BasePlugin {
  async onBeforeQuery(query: QueryObject, context: QueryContext): Promise<QueryObject> {
    const hasPermission = this.checkPermission(context.user, query);

    if (!hasPermission) {
      throw new PluginError('Unauthorized', {
        code: 'PERMISSION_DENIED',
        pluginName: this.name,
      });
    }

    return query;
  }
}
```

---

### 4. Result Transformation - Sonuçları Modifiye Et

#### 4.1 Field Sanitization

```typescript
class SanitizationPlugin extends BasePlugin {
  async onAfterQuery<TResult>(result: TResult): Promise<TResult> {
    if (Array.isArray(result)) {
      return result.map((item) => this.sanitize(item)) as TResult;
    }
    return this.sanitize(result) as TResult;
  }

  private sanitize(item: any) {
    if (!item) return item;
    const { password, secretKey, ...safe } = item;
    return safe;
  }
}
```

#### 4.2 Virtual Fields

```typescript
class VirtualFieldsPlugin extends BasePlugin {
  async onAfterQuery<TResult>(result: TResult, context: QueryContext): Promise<TResult> {
    if (context.modelName === 'User' && Array.isArray(result)) {
      return result.map((user) => ({
        ...user,
        fullName: `${user.firstName} ${user.lastName}`,
        age: this.calculateAge(user.birthDate),
      })) as TResult;
    }
    return result;
  }
}
```

---

### 5. Schema Load Hook - Post-registration İşlemler

```typescript
class ValidationPlugin extends BasePlugin {
  async onSchemaLoad(schemas: SchemaRegistry): Promise<void> {
    for (const schema of schemas.getAll()) {
      this.validateRelations(schema, schemas);
    }
  }

  private validateRelations(schema: SchemaDefinition, registry: SchemaRegistry): void {
    for (const [fieldName, field] of Object.entries(schema.fields)) {
      if (field.type === 'relation') {
        if (!registry.has(field.model)) {
          throw new Error(
            `Invalid relation in ${schema.name}.${fieldName}: model '${field.model}' not found`
          );
        }
      }
    }
  }
}
```

---

## 🏗️ Plugin Lifecycle

```
1. Plugin creation (constructor)
2. User schemas register
3. Plugin.getSchemas() → Plugin schemas register
4. Plugin.extendSchemas() → Schema modifications apply
5. Schema validation
6. Plugin.init() → Initialize plugin
7. Plugin.onSchemaLoad() → Post-registration hook
8. Ready for queries
   ├─ Plugin.onBeforeQuery() → Query interception
   ├─ Query execution
   └─ Plugin.onAfterQuery() → Result transformation
9. Plugin.destroy() → Cleanup
```

---

## 📋 Plugin Interface Summary

```typescript
interface ForjaPlugin<TOptions = Record<string, unknown>> {
  readonly name: string;
  readonly version: string;
  readonly options: TOptions;

  init(context: PluginContext): Promise<Result<void, PluginError>>;
  destroy(): Promise<Result<void, PluginError>>;

  getSchemas?(): Promise<SchemaDefinition[]>;
  extendSchemas?(context: SchemaExtensionContext): Promise<SchemaExtension[]>;
  onSchemaLoad?(schemas: SchemaRegistry): Promise<void>;
  onBeforeQuery?(query: QueryObject, context: QueryContext): Promise<QueryObject>;
  onAfterQuery?<TResult>(result: TResult, context: QueryContext): Promise<TResult>;
}
```

---

## 🎯 Complete Example - Audit Plugin

```typescript
interface AuditPluginOptions {
  readonly exclude?: readonly string[];
  readonly createdByField?: string;
  readonly updatedByField?: string;
}

class AuditPlugin extends BasePlugin<AuditPluginOptions> {
  readonly name = 'audit';
  readonly version = '1.0.0';

  async init(context: PluginContext): Promise<Result<void, PluginError>> {
    this.context = context;
    return { success: true, data: undefined };
  }

  async destroy(): Promise<Result<void, PluginError>> {
    return { success: true, data: undefined };
  }

  async extendSchemas(context: SchemaExtensionContext): Promise<SchemaExtension[]> {
    const { exclude = [], createdByField = 'createdBy', updatedByField = 'updatedBy' } = this.options;

    return context.extendByPattern(
      { exclude: exclude as string[] },
      (schema) => ({
        fields: {
          [createdByField]: { type: 'string', required: false },
          [updatedByField]: { type: 'string', required: false },
        },
        indexes: [
          { fields: [createdByField] },
          { fields: [updatedByField] },
        ],
      })
    );
  }

  async onBeforeQuery(query: QueryObject, context: QueryContext): Promise<QueryObject> {
    const { createdByField = 'createdBy', updatedByField = 'updatedBy' } = this.options;

    if (query.type === 'insert' && context.user && query.data) {
      return {
        ...query,
        data: { ...query.data, [createdByField]: context.user.id },
      };
    }

    if (query.type === 'update' && context.user) {
      if (query.data) {
        query = {
          ...query,
          data: { ...query.data, [updatedByField]: context.user.id },
        };
      }

      return {
        ...query,
        where: {
          $and: [query.where || {}, { [createdByField]: context.user.id }],
        },
      };
    }

    return query;
  }
}
```

---

## ⚠️ Best Practices

1. **Type Safety**: Her zaman explicit type'lar kullan
2. **Error Handling**: Result pattern ile hata yönetimi
3. **Performance**: `onBeforeQuery` ve `onAfterQuery` her query'de çalışır, optimize et
4. **Schema Conflicts**: Field ekleme konusunda dikkatli ol (duplicate field warnings)
5. **Plugin Dependencies**: Eğer başka plugin'lere depend ediyorsan dokümante et
6. **Cleanup**: `destroy()` içinde resource'ları temizle

---

## 🔍 Context Objects

### PluginContext (init)
```typescript
interface PluginContext {
  readonly adapter: DatabaseAdapter;
  readonly schemas: SchemaRegistry;
  readonly config: ForjaConfig;
}
```

### SchemaExtensionContext
```typescript
interface SchemaExtensionContext {
  readonly schemas: ReadonlyArray<SchemaDefinition>;
  extendAll(modifier: SchemaModifier): SchemaExtension[];
  extendWhere(predicate, modifier): SchemaExtension[];
  extendByPattern(pattern, modifier): SchemaExtension[];
}
```

### QueryContext (hooks)
```typescript
interface QueryContext {
  readonly operation: 'select' | 'insert' | 'update' | 'delete';
  readonly modelName: string;
  readonly user?: AuthUser;
  readonly metadata: Map<string, unknown>;
}
```
