# Validation in Plugins

> Using core validator in plugins.

---

## Overview

Plugins can use the core validator to validate data against schemas. This is useful for custom validation logic, data transformation, and input sanitization.

---

## Validator Functions

```typescript
import {
  validateField,
  validateSchema,
  validatePartial,
  validateMany
} from 'forja-core';
```

---

## Field Validation

Validate a single field value:

```typescript
import { validateField } from 'forja-core';

const emailField = {
  type: 'string' as const,
  required: true,
  pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/
};

const result = validateField('user@example.com', emailField, 'email');

if (result.success) {
  const validEmail = result.data;
} else {
  const errors = result.error;
}
```

---

## Schema Validation

Validate entire object against schema:

```typescript
import { validateSchema } from 'forja-core';

class MyPlugin extends BasePlugin {
  async validateUserData(data: unknown): Promise<Result<User, ValidationError[]>> {
    const schema = this.getContext().data.schemas.get('User');

    if (!schema) {
      return { success: false, error: [/* error */] };
    }

    return validateSchema(data, schema);
  }
}
```

---

## Partial Validation

Validate partial objects (for updates):

```typescript
import { validatePartial } from 'forja-core';

// Only validate provided fields
const result = validatePartial({ email: 'new@example.com' }, userSchema);
```

---

## Array Validation

Validate array of objects:

```typescript
import { validateMany } from 'forja-core';

const users = [
  { email: 'user1@example.com', name: 'User 1' },
  { email: 'user2@example.com', name: 'User 2' }
];

const result = validateMany(users, userSchema);

if (result.success) {
  const validUsers = result.data;  // User[]
}
```

---

## Validator Options

```typescript
interface ValidatorOptions {
  strict?: boolean         // Reject unknown fields (default: true)
  stripUnknown?: boolean   // Remove unknown fields (default: false)
  abortEarly?: boolean     // Stop on first error (default: false)
}

const result = validateSchema(data, schema, {
  strict: false,
  abortEarly: true
});
```

---

## Error Handling

```typescript
import { ValidationErrorCollection } from 'forja-core';

const result = validateSchema(data, schema);

if (!result.success) {
  const errors = new ValidationErrorCollection(result.error);

  // Group by field
  const byField = errors.groupByField();
  console.log(byField.email);  // All email errors

  // Get first error per field
  const firstErrors = errors.getFirstPerField();

  // Format as string
  console.log(errors.toString());

  // Count errors
  console.log(errors.count());
}
```

---

## Common Patterns

### Validate Plugin Configuration

```typescript
async init(context: PluginContext): Promise<Result<void, PluginError>> {
  // Define config schema
  const configSchema = {
    name: 'PluginConfig',
    fields: {
      apiKey: {
        type: 'string' as const,
        required: true,
        minLength: 32
      },
      timeout: {
        type: 'number' as const,
        min: 1000,
        max: 60000,
        default: 5000
      }
    }
  };

  // Validate options
  const result = validateSchema(this.options, configSchema);

  if (!result.success) {
    return {
      success: false,
      error: this.createError(
        'Invalid plugin configuration',
        'INVALID_CONFIG',
        result.error
      )
    };
  }

  return { success: true, data: undefined };
}
```

### Validate Before Query

```typescript
async onBeforeQuery(query: QueryObject): Promise<QueryObject> {
  if (query.type === 'insert' || query.type === 'update') {
    const schema = this.getContext().data.schemas.get(query.table);

    if (schema && query.data) {
      const validation = query.type === 'insert'
        ? validateSchema(query.data, schema)
        : validatePartial(query.data, schema);

      if (!validation.success) {
        console.error('Validation failed:', validation.error);
        // Handle error (log, throw, modify query, etc.)
      }
    }
  }

  return query;
}
```

### Sanitize Input

```typescript
async sanitizeInput(data: unknown, schemaName: string): Promise<unknown> {
  const schema = this.getContext().data.schemas.get(schemaName);

  if (!schema) {
    return data;
  }

  const result = validateSchema(data, schema, {
    strict: false,
    stripUnknown: true  // Remove unknown fields
  });

  return result.success ? result.data : data;
}
```

---

## Best Practices

**1. Validate plugin configuration early**
```typescript
async init(context: PluginContext): Promise<Result<void, PluginError>> {
  // Validate before any other setup
  const configValidation = validateSchema(this.options, configSchema);

  if (!configValidation.success) {
    return { success: false, error: ... };
  }

  // Continue with setup
}
```

**2. Don't validate in hot paths**
```typescript
// ❌ Don't validate every query
async onBeforeQuery(query: QueryObject): Promise<QueryObject> {
  validateSchema(query.data, schema);  // Slow!
  return query;
}

// ✅ Validation happens at API layer, not in plugins
```

**3. Use appropriate validator function**
```typescript
// ✅ Use validatePartial for updates
const updateResult = validatePartial(updateData, schema);

// ✅ Use validateMany for bulk operations
const bulkResult = validateMany(dataArray, schema);
```

**4. Handle validation errors gracefully**
```typescript
const result = validateSchema(data, schema);

if (!result.success) {
  // Log errors
  console.error('Validation failed:', result.error);

  // Don't throw - return error result
  return {
    success: false,
    error: this.createError('Validation failed', 'VALIDATION_ERROR', result.error)
  };
}
```

---

## Reference

**Source Code:**
- Validator functions - `packages/core/src/validator/`
- Validation types - `packages/types/src/validator.ts`
- Error collection - `packages/core/src/validator/errors.ts`

**Related:**
- [Field Types](../user-guide/field-types.md)
- [Schema Definition](../user-guide/defining-schemas.md)
- [Validator API](../api-reference/validator-module.md)
