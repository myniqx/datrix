/**
 * Test Fixtures
 *
 * Sample schemas, field definitions, and test data for use in tests
 */

import type { FieldDefinition, SchemaDefinition } from '@core/schema/types';

/**
 * Sample field definitions for testing
 */
export const sampleFields = {
  // String fields
  requiredString: {
    type: 'string' as const,
    required: true,
  },
  optionalString: {
    type: 'string' as const,
    required: false,
  },
  stringWithMinLength: {
    type: 'string' as const,
    minLength: 3,
  },
  stringWithMaxLength: {
    type: 'string' as const,
    maxLength: 10,
  },
  stringWithPattern: {
    type: 'string' as const,
    pattern: /^[a-z]+$/,
  },
  emailField: {
    type: 'string' as const,
    pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    required: true,
  },

  // Number fields
  requiredNumber: {
    type: 'number' as const,
    required: true,
  },
  numberWithMin: {
    type: 'number' as const,
    min: 0,
  },
  numberWithMax: {
    type: 'number' as const,
    max: 100,
  },
  integerField: {
    type: 'number' as const,
    integer: true,
  },
  ageField: {
    type: 'number' as const,
    min: 18,
    max: 120,
  },

  // Boolean fields
  requiredBoolean: {
    type: 'boolean' as const,
    required: true,
  },
  optionalBoolean: {
    type: 'boolean' as const,
    required: false,
  },

  // Date fields
  requiredDate: {
    type: 'date' as const,
    required: true,
  },
  dateWithMin: {
    type: 'date' as const,
    min: new Date('2020-01-01'),
  },
  dateWithMax: {
    type: 'date' as const,
    max: new Date('2030-12-31'),
  },

  // Enum fields
  roleEnum: {
    type: 'enum' as const,
    values: ['admin', 'user', 'moderator'] as const,
    required: true,
  },
  statusEnum: {
    type: 'enum' as const,
    values: ['active', 'inactive', 'pending'] as const,
  },

  // Array fields
  stringArray: {
    type: 'array' as const,
    items: { type: 'string' as const },
  },
  arrayWithMinItems: {
    type: 'array' as const,
    items: { type: 'string' as const },
    minItems: 1,
  },
  arrayWithMaxItems: {
    type: 'array' as const,
    items: { type: 'number' as const },
    maxItems: 5,
  },
  uniqueArray: {
    type: 'array' as const,
    items: { type: 'string' as const },
    unique: true,
  },

  // JSON field
  jsonField: {
    type: 'json' as const,
  },

  // Relation fields
  hasOneRelation: {
    type: 'relation' as const,
    model: 'Profile',
    kind: 'hasOne' as const,
    foreignKey: 'userId',
  },
  hasManyRelation: {
    type: 'relation' as const,
    model: 'Post',
    kind: 'hasMany' as const,
    foreignKey: 'authorId',
  },
} satisfies Record<string, FieldDefinition>;

/**
 * Sample schema definitions for testing
 */
export const sampleSchemas = {
  userSchema: {
    name: 'User',
    fields: {
      id: { type: 'number' as const, required: true },
      email: {
        type: 'string' as const,
        required: true,
        unique: true,
        pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
      },
      name: { type: 'string' as const, required: true, minLength: 2, maxLength: 50 },
      age: { type: 'number' as const, min: 18, max: 120 },
      role: { type: 'enum' as const, values: ['admin', 'user'] as const, default: 'user' },
      active: { type: 'boolean' as const, default: true },
      createdAt: { type: 'date' as const },
    },
    indexes: [
      { fields: ['email'], unique: true },
    ],
  } as const,

  postSchema: {
    name: 'Post',
    fields: {
      id: { type: 'number' as const, required: true },
      title: { type: 'string' as const, required: true, minLength: 5, maxLength: 200 },
      content: { type: 'string' as const, required: true },
      published: { type: 'boolean' as const, default: false },
      authorId: { type: 'number' as const, required: true },
      tags: { type: 'array' as const, items: { type: 'string' as const } },
      createdAt: { type: 'date' as const },
    },
  } as const,

  profileSchema: {
    name: 'Profile',
    fields: {
      id: { type: 'number' as const, required: true },
      userId: { type: 'number' as const, required: true, unique: true },
      bio: { type: 'string' as const, maxLength: 500 },
      avatar: { type: 'string' as const },
    },
  } as const,
};

/**
 * Valid test data samples
 */
export const validData = {
  user: {
    id: 1,
    email: 'user@example.com',
    name: 'John Doe',
    age: 25,
    role: 'user',
    active: true,
    createdAt: new Date('2024-01-01'),
  },
  post: {
    id: 1,
    title: 'Test Post Title',
    content: 'This is a test post content.',
    published: true,
    authorId: 1,
    tags: ['test', 'example'],
    createdAt: new Date('2024-01-01'),
  },
  profile: {
    id: 1,
    userId: 1,
    bio: 'Software developer passionate about TypeScript',
    avatar: 'https://example.com/avatar.jpg',
  },
};

/**
 * Invalid test data samples
 */
export const invalidData = {
  user: {
    missingRequired: {
      id: 1,
      // missing email and name
      age: 25,
    },
    invalidEmail: {
      id: 1,
      email: 'not-an-email',
      name: 'John Doe',
    },
    invalidAge: {
      id: 1,
      email: 'user@example.com',
      name: 'John Doe',
      age: 15, // less than min (18)
    },
    invalidRole: {
      id: 1,
      email: 'user@example.com',
      name: 'John Doe',
      role: 'invalid-role', // not in enum
    },
  },
  post: {
    titleTooShort: {
      id: 1,
      title: 'Test', // less than minLength (5)
      content: 'Content',
      authorId: 1,
    },
    titleTooLong: {
      id: 1,
      title: 'A'.repeat(201), // more than maxLength (200)
      content: 'Content',
      authorId: 1,
    },
  },
};

/**
 * Edge case test data
 */
export const edgeCases = {
  emptyString: '',
  emptyArray: [],
  null: null,
  undefined: undefined,
  zero: 0,
  negativeNumber: -1,
  largeNumber: Number.MAX_SAFE_INTEGER,
  specialChars: '!@#$%^&*()',
  whitespace: '   ',
  htmlString: '<script>alert("xss")</script>',
  sqlInjection: "'; DROP TABLE users; --",
  unicodeString: '你好世界🌍',
  dateString: '2024-01-01T00:00:00.000Z',
  invalidDate: new Date('invalid'),
};

/**
 * Helper functions for creating test data
 */
export const createTestData = {
  user: (overrides?: Partial<typeof validData.user>) => ({
    ...validData.user,
    ...overrides,
  }),

  post: (overrides?: Partial<typeof validData.post>) => ({
    ...validData.post,
    ...overrides,
  }),

  profile: (overrides?: Partial<typeof validData.profile>) => ({
    ...validData.profile,
    ...overrides,
  }),
};
