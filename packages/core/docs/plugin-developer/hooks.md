# Plugin Hooks

> Lifecycle and query hooks for plugins.

---

## Overview

Plugins can intercept application lifecycle events and query operations through hooks. All hooks are optional - implement only what your plugin needs.

---

## Lifecycle Hooks

### onSchemaLoad()

Called when schemas are loaded into registry.

```typescript
async onSchemaLoad(schemas: SchemaRegistry): Promise<void> {
  // Access all registered schemas
  const allSchemas = schemas.getAll();

  // Get specific schema
  const userSchema = schemas.get('User');

  // Check schema exists
  if (schemas.has('Post')) {
    // Schema registered
  }
}
```

**When called:**
- After all schemas are registered
- Before query operations begin
- Once per application lifecycle

**Use cases:**
- Validate schema structure
- Cache schema metadata
- Set up schema-based resources

---

## Query Hooks

### onBeforeQuery()

Intercept and modify queries before database execution.

```typescript
async onBeforeQuery(query: QueryObject): Promise<QueryObject> {
  // Example: Add soft delete filter
  if (query.type === 'select' || query.type === 'update') {
    return {
      ...query,
      where: {
        ...query.where,
        deletedAt: { $null: true }
      }
    };
  }

  // Example: Convert DELETE to UPDATE
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
```

**When called:**
- Before every database query
- After query building
- Before adapter translation

**Use cases:**
- Add global filters (soft delete, tenant isolation)
- Transform queries (DELETE → UPDATE)
- Log/audit queries
- Add default values

### onAfterQuery()

Transform query results after database execution.

```typescript
async onAfterQuery<TResult>(result: TResult): Promise<TResult> {
  // Example: Add computed field
  if (Array.isArray(result)) {
    return result.map(item => ({
      ...item,
      fullName: `${item.firstName} ${item.lastName}`
    })) as TResult;
  }

  // Example: Transform single result
  if (result && typeof result === 'object') {
    return {
      ...result,
      computedField: 'value'
    } as TResult;
  }

  return result;
}
```

**When called:**
- After database query execution
- Before returning to caller
- For every query result

**Use cases:**
- Add computed fields
- Transform data format
- Log/audit results
- Cache results

---

## Hook Execution Order

Multiple plugins can implement the same hooks. Execution order:

**onSchemaLoad:**
1. Plugin 1 → onSchemaLoad()
2. Plugin 2 → onSchemaLoad()
3. Plugin 3 → onSchemaLoad()

**onBeforeQuery:**
1. Original query
2. → Plugin 1 → onBeforeQuery()
3. → Plugin 2 → onBeforeQuery()
4. → Plugin 3 → onBeforeQuery()
5. → Database adapter

**onAfterQuery:**
1. Database result
2. → Plugin 1 → onAfterQuery()
3. → Plugin 2 → onAfterQuery()
4. → Plugin 3 → onAfterQuery()
5. → Return to caller

---

## Hook Isolation

Errors in hooks are isolated:

```typescript
// Plugin 1
async onBeforeQuery(query: QueryObject): Promise<QueryObject> {
  throw new Error('Plugin 1 error');  // Isolated, doesn't affect Plugin 2
}

// Plugin 2 still executes
async onBeforeQuery(query: QueryObject): Promise<QueryObject> {
  // This still runs
  return query;
}
```

**Note:** Hook errors are logged but don't stop execution. Ensure hooks handle errors gracefully.

---

## Common Patterns

### Global Filters

```typescript
async onBeforeQuery(query: QueryObject): Promise<QueryObject> {
  if (query.type === 'select') {
    // Add tenant filter to all queries
    return {
      ...query,
      where: {
        $and: [
          query.where || {},
          { tenantId: this.currentTenantId }
        ]
      }
    };
  }

  return query;
}
```

### Query Logging

```typescript
async onBeforeQuery(query: QueryObject): Promise<QueryObject> {
  console.log(`[${query.type.toUpperCase()}] ${query.table}`, query);
  return query;
}

async onAfterQuery<TResult>(result: TResult): Promise<TResult> {
  console.log('Query result:', Array.isArray(result) ? result.length : 'single');
  return result;
}
```

### Soft Delete

```typescript
async onBeforeQuery(query: QueryObject): Promise<QueryObject> {
  // Convert DELETE to UPDATE
  if (query.type === 'delete') {
    return {
      type: 'update',
      table: query.table,
      where: query.where,
      data: { deletedAt: new Date() },
      returning: query.returning
    };
  }

  // Filter soft-deleted records
  if (query.type === 'select') {
    return {
      ...query,
      where: {
        ...query.where,
        deletedAt: { $null: true }
      }
    };
  }

  return query;
}
```

### Computed Fields

```typescript
async onAfterQuery<TResult>(result: TResult): Promise<TResult> {
  const addComputedFields = (item: any) => ({
    ...item,
    fullName: `${item.firstName} ${item.lastName}`,
    age: calculateAge(item.birthDate),
    isAdult: calculateAge(item.birthDate) >= 18
  });

  if (Array.isArray(result)) {
    return result.map(addComputedFields) as TResult;
  }

  if (result && typeof result === 'object') {
    return addComputedFields(result) as TResult;
  }

  return result;
}
```

---

## Best Practices

**1. Keep hooks fast**
```typescript
// ❌ Slow - external API call
async onBeforeQuery(query: QueryObject): Promise<QueryObject> {
  await fetch('https://api.example.com/check');  // Don't do this!
  return query;
}

// ✅ Fast - in-memory operation
async onBeforeQuery(query: QueryObject): Promise<QueryObject> {
  return {
    ...query,
    where: { ...query.where, tenantId: this.tenantId }
  };
}
```

**2. Handle all query types**
```typescript
async onBeforeQuery(query: QueryObject): Promise<QueryObject> {
  // Check query type before modifying
  if (query.type === 'select' || query.type === 'update') {
    // Modify
  }

  return query;
}
```

**3. Don't mutate query object**
```typescript
// ❌ Mutation
async onBeforeQuery(query: QueryObject): Promise<QueryObject> {
  query.where = { ...query.where, deletedAt: null };  // Don't!
  return query;
}

// ✅ Return new object
async onBeforeQuery(query: QueryObject): Promise<QueryObject> {
  return {
    ...query,
    where: { ...query.where, deletedAt: null }
  };
}
```

**4. Type guard results in onAfterQuery**
```typescript
async onAfterQuery<TResult>(result: TResult): Promise<TResult> {
  // Check result type before transforming
  if (!result || typeof result !== 'object') {
    return result;
  }

  if (Array.isArray(result)) {
    // Handle array
  } else {
    // Handle object
  }

  return result;
}
```

---

## Reference

**Source Code:**
- Hook definitions - `packages/types/src/plugin.ts`
- Dispatcher - `packages/core/src/dispatcher.ts`
- BasePlugin - `packages/core/src/plugin/base.ts`

**Example Implementations:**
- Soft Delete Plugin - `packages/plugins/soft-delete/`
- Hooks Plugin - `packages/plugins/hooks/`

**Related:**
- [Getting Started](./getting-started.md)
- [Base Plugin](./base-plugin.md)
- [Query Builder](../adapter-developer/query-builder.md)
