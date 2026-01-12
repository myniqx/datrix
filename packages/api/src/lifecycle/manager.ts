/**
 * API Lifecycle Manager
 *
 * Manages API initialization lifecycle including:
 * - User schema validation and injection
 * - Auth schema reservation
 * - Schema preparation for API routes
 */

import type { ApiAuthConfig } from 'forja-types/config';
import type { SchemaDefinition, FieldDefinition } from 'forja-types/core/schema';
import type { Result } from 'forja-types/utils';
import { DEFAULT_API_AUTH_CONFIG } from 'forja-types/config';

/**
 * API Lifecycle Error
 */
export class ApiLifecycleError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(message: string, code: string, details?: unknown) {
    super(message);
    this.name = 'ApiLifecycleError';
    this.code = code;
    this.details = details;
  }
}

/**
 * Schema Registry Interface (minimal interface needed)
 */
interface SchemaRegistry {
  has(name: string): boolean;
  get(name: string): SchemaDefinition | undefined;
  register(schema: SchemaDefinition): void;
  update(name: string, schema: SchemaDefinition): void;
}

/**
 * API Lifecycle Manager
 *
 * Handles API initialization and schema preparation
 */
export class ApiLifecycleManager {
  constructor(private readonly authConfig?: ApiAuthConfig) {}

  /**
   * Initialize API and prepare schemas
   *
   * This method:
   * 1. Validates 'auth' schema name is not used
   * 2. Creates or extends user schema with auth fields
   * 3. Validates auth configuration
   */
  async init(schemas: SchemaRegistry): Promise<Result<void, ApiLifecycleError>> {
    // 1. Check if 'auth' schema exists in user schemas
    if (schemas.has('auth')) {
      return {
        success: false,
        error: new ApiLifecycleError(
          "Schema name 'auth' is reserved for API authentication routes. " +
          "Please rename your schema to avoid conflicts.",
          'RESERVED_SCHEMA_NAME',
          { schemaName: 'auth' }
        ),
      };
    }

    // 2. If auth is disabled, skip user schema setup
    if (!this.authConfig || this.authConfig.enabled === false) {
      return { success: true, data: undefined };
    }

    // 3. Prepare user schema
    const userSchemaResult = await this.prepareUserSchema(schemas);
    if (!userSchemaResult.success) {
      return userSchemaResult;
    }

    return { success: true, data: undefined };
  }

  /**
   * Prepare user schema (create or extend)
   */
  private async prepareUserSchema(
    schemas: SchemaRegistry
  ): Promise<Result<void, ApiLifecycleError>> {
    const config = this.authConfig!;
    const userSchemaName = config.userSchema?.name ?? DEFAULT_API_AUTH_CONFIG.userSchema.name;
    const existingSchema = schemas.get(userSchemaName);

    if (!existingSchema) {
      // Create minimal user schema
      const createResult = this.createMinimalUserSchema(config, userSchemaName);
      if (!createResult.success) {
        return createResult;
      }

      schemas.register(createResult.data);
      return { success: true, data: undefined };
    } else {
      // Extend existing user schema
      const extendResult = this.extendUserSchema(existingSchema, config);
      if (!extendResult.success) {
        return {
          success: false,
          error: extendResult.error,
        };
      }

      schemas.update(userSchemaName, extendResult.data);
      return { success: true, data: undefined };
    }
  }

  /**
   * Create minimal user schema with auth fields
   */
  private createMinimalUserSchema(
    config: ApiAuthConfig,
    schemaName: string
  ): Result<SchemaDefinition, ApiLifecycleError> {
    const fieldNames = {
      email: config.userSchema?.fields?.email ?? DEFAULT_API_AUTH_CONFIG.userSchema.fields.email,
      password: config.userSchema?.fields?.password ?? DEFAULT_API_AUTH_CONFIG.userSchema.fields.password,
      role: config.userSchema?.fields?.role ?? DEFAULT_API_AUTH_CONFIG.userSchema.fields.role,
    };

    const extraFields = config.userSchema?.extraFields ?? [];

    // Build fields object
    const fields: Record<string, FieldDefinition> = {
      id: {
        type: 'string',
        required: true,
        unique: true,
        primaryKey: true,
      },
      [fieldNames.email]: {
        type: 'string',
        required: true,
        unique: true,
      },
      [fieldNames.password]: {
        type: 'string',
        required: true,
        internal: true, // Never expose in API responses
      },
      passwordSalt: {
        type: 'string',
        required: true,
        internal: true,
      },
      [fieldNames.role]: {
        type: 'string',
        required: true,
        default: config.rbac?.defaultRole ?? DEFAULT_API_AUTH_CONFIG.rbac.defaultRole,
      },
      createdAt: {
        type: 'date',
        required: true,
        default: () => new Date(),
      },
      updatedAt: {
        type: 'date',
        required: true,
        default: () => new Date(),
      },
    };

    // Add extra fields
    for (const field of extraFields) {
      if (typeof field === 'object' && field !== null && 'name' in field) {
        const fieldName = (field as { name: string }).name;
        if (fieldName in fields) {
          return {
            success: false,
            error: new ApiLifecycleError(
              `Extra field '${fieldName}' conflicts with required auth field`,
              'FIELD_CONFLICT',
              { field: fieldName }
            ),
          };
        }
        fields[fieldName] = field as FieldDefinition;
      }
    }

    const schema: SchemaDefinition = {
      name: schemaName,
      fields,
      indexes: [
        {
          name: `${schemaName}_email_idx`,
          fields: [fieldNames.email],
          unique: true,
        },
      ],
      timestamps: true,
    };

    return { success: true, data: schema };
  }

  /**
   * Extend existing user schema with auth fields
   */
  private extendUserSchema(
    existingSchema: SchemaDefinition,
    config: ApiAuthConfig
  ): Result<SchemaDefinition, ApiLifecycleError> {
    const fieldNames = {
      email: config.userSchema?.fields?.email ?? DEFAULT_API_AUTH_CONFIG.userSchema.fields.email,
      password: config.userSchema?.fields?.password ?? DEFAULT_API_AUTH_CONFIG.userSchema.fields.password,
      role: config.userSchema?.fields?.role ?? DEFAULT_API_AUTH_CONFIG.userSchema.fields.role,
    };

    const requiredAuthFields: Record<string, FieldDefinition> = {
      [fieldNames.password]: {
        type: 'string',
        required: true,
        internal: true,
      },
      passwordSalt: {
        type: 'string',
        required: true,
        internal: true,
      },
      [fieldNames.role]: {
        type: 'string',
        required: true,
        default: config.rbac?.defaultRole ?? DEFAULT_API_AUTH_CONFIG.rbac.defaultRole,
      },
    };

    // Check if email field exists
    if (!(fieldNames.email in existingSchema.fields)) {
      return {
        success: false,
        error: new ApiLifecycleError(
          `User schema must have an '${fieldNames.email}' field for authentication`,
          'MISSING_EMAIL_FIELD',
          { schemaName: existingSchema.name, requiredField: fieldNames.email }
        ),
      };
    }

    // Validate email field type
    const emailField = existingSchema.fields[fieldNames.email];
    if (emailField?.type !== 'string') {
      return {
        success: false,
        error: new ApiLifecycleError(
          `Email field '${fieldNames.email}' must be of type 'string'`,
          'INVALID_EMAIL_FIELD_TYPE',
          { schemaName: existingSchema.name, field: fieldNames.email, actualType: emailField?.type }
        ),
      };
    }

    // Merge fields (don't override existing auth fields if they exist)
    const newFields: Record<string, FieldDefinition> = { ...existingSchema.fields };

    for (const [fieldName, fieldDef] of Object.entries(requiredAuthFields)) {
      if (!(fieldName in newFields)) {
        newFields[fieldName] = fieldDef;
      }
    }

    // Return extended schema
    const extendedSchema: SchemaDefinition = {
      ...existingSchema,
      fields: newFields,
    };

    return { success: true, data: extendedSchema };
  }

  /**
   * Validate JWT configuration
   */
  validateJwtConfig(): Result<void, ApiLifecycleError> {
    if (!this.authConfig?.jwt) {
      return { success: true, data: undefined };
    }

    const jwt = this.authConfig.jwt;

    // Validate secret length (minimum 32 characters for HS256)
    if (jwt.secret.length < 32) {
      return {
        success: false,
        error: new ApiLifecycleError(
          'JWT secret must be at least 32 characters long for security',
          'WEAK_JWT_SECRET',
          { secretLength: jwt.secret.length, minimumLength: 32 }
        ),
      };
    }

    return { success: true, data: undefined };
  }

  /**
   * Check if a schema should have auto-generated routes
   */
  shouldGenerateRoutes(schemaName: string, excludeSchemas: readonly string[] = []): boolean {
    // 'auth' is always reserved
    if (schemaName === 'auth') {
      return false;
    }

    // Check exclude list
    if (excludeSchemas.includes(schemaName)) {
      return false;
    }

    return true;
  }

  /**
   * Get user schema name
   */
  getUserSchemaName(): string {
    return this.authConfig?.userSchema?.name ?? DEFAULT_API_AUTH_CONFIG.userSchema.name;
  }

  /**
   * Get auth field names
   */
  getAuthFieldNames(): {
    email: string;
    password: string;
    role: string;
  } {
    return {
      email: this.authConfig?.userSchema?.fields?.email ?? DEFAULT_API_AUTH_CONFIG.userSchema.fields.email,
      password: this.authConfig?.userSchema?.fields?.password ?? DEFAULT_API_AUTH_CONFIG.userSchema.fields.password,
      role: this.authConfig?.userSchema?.fields?.role ?? DEFAULT_API_AUTH_CONFIG.userSchema.fields.role,
    };
  }
}

/**
 * Create API lifecycle manager
 */
export function createApiLifecycleManager(
  authConfig?: ApiAuthConfig
): ApiLifecycleManager {
  return new ApiLifecycleManager(authConfig);
}
