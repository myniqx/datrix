/**
 * Test Fixtures
 *
 * Sample schemas, field definitions, and test data for use in tests
 */

import { FieldDefinition } from "forja-types/core/schema";


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
 * API Handler Context test data
 */
export const apiContextData = {
  validExpressRequest: {
    method: 'GET',
    url: '/api/users/1?status=active',
    params: { id: '1' },
    query: { status: 'active' },
    body: undefined,
    headers: {
      'content-type': 'application/json',
      'user-agent': 'test-agent/1.0',
    },
    user: { id: 1, role: 'user' },
  },
  validExpressPostRequest: {
    method: 'POST',
    url: '/api/users',
    params: {},
    query: {},
    body: { name: 'John Doe', email: 'john@example.com' },
    headers: {
      'content-type': 'application/json',
    },
    user: { id: 1, role: 'admin' },
  },
  expressRequestWithArrayHeaders: {
    method: 'GET',
    params: {},
    query: {},
    headers: {
      'x-custom': ['value1', 'value2', 'value3'],
      'content-type': 'application/json',
    },
  },
  expressRequestMultipleQueryValues: {
    method: 'GET',
    params: {},
    query: { tags: ['tech', 'news', 'sports'] },
    headers: {},
  },
  maliciousHeaders: {
    xssInHeader: '<script>alert("xss")</script>',
    sqlInjectionInHeader: "'; DROP TABLE users; --",
    commandInjection: '; rm -rf /',
    nullByteInjection: 'value\x00malicious',
    crlfInjection: 'value\r\nX-Injected: true',
  },
  edgeCaseHeaders: {
    emptyString: '',
    veryLongHeader: 'A'.repeat(10000),
    unicodeHeader: '你好世界🌍',
    onlyWhitespace: '   ',
    specialChars: '!@#$%^&*()_+-=[]{}|;:,.<>?',
    controlChars: '\x00\x01\x02\x03',
  },
  maliciousQueryParams: {
    xssInQuery: { search: '<script>alert(1)</script>' },
    sqlInjectionInQuery: { name: "'; DROP TABLE users; --" },
    pathTraversal: { file: '../../../etc/passwd' },
    prototypePolllution: { '__proto__': { admin: true } },
    deeplyNestedObject: JSON.parse('{"a":'.repeat(1000) + '{}' + '}'.repeat(1000)),
  },
  edgeCaseUrls: {
    emptyUrl: '',
    malformedUrl: 'not-a-valid-url',
    veryLongUrl: 'https://example.com/' + 'a'.repeat(10000),
    unicodeUrl: 'https://example.com/你好',
    urlWithFragment: 'https://example.com/page#section',
    urlWithCredentials: 'https://user:pass@example.com/api',
  },
  edgeCaseBodies: {
    circularReference: (() => {
      const obj: any = { name: 'test' };
      obj.self = obj;
      return obj;
    })(),
    veryLargeBody: { data: 'x'.repeat(10000000) },
    emptyObject: {},
    emptyArray: [],
    nestedArrays: [[[[['deeply nested']]]]],
  },
};

/**
 * CRUD Handler test data
 */
export const crudTestData = {
  validRequestContext: {
    method: 'GET' as const,
    params: {},
    query: {},
    body: undefined,
    headers: {},
    user: undefined,
    metadata: {},
  },
  mockUserSchema: {
    name: 'User',
    tableName: 'users',
    fields: {
      id: { type: 'number' as const, primary: true },
      email: { type: 'string' as const, required: true, unique: true },
      name: { type: 'string' as const, required: true, minLength: 2 },
      age: { type: 'number' as const, min: 18 },
      role: { type: 'enum' as const, values: ['user', 'admin'] as const, default: 'user' },
    },
  },
  validUserRecord: {
    id: 1,
    email: 'user@example.com',
    name: 'John Doe',
    age: 25,
    role: 'user',
  },
  validUserInput: {
    email: 'newuser@example.com',
    name: 'Jane Doe',
    age: 30,
    role: 'user',
  },
  invalidUserInput: {
    missingEmail: { name: 'John' },
    missingName: { email: 'john@example.com' },
    invalidEmail: { email: 'not-an-email', name: 'John' },
    tooShortName: { email: 'john@example.com', name: 'J' },
    tooYoung: { email: 'john@example.com', name: 'John', age: 10 },
    invalidRole: { email: 'john@example.com', name: 'John', role: 'superadmin' },
  },
  maliciousInput: {
    sqlInjectionInEmail: { email: "'; DROP TABLE users; --", name: 'Hacker' },
    xssInName: { email: 'hacker@example.com', name: '<script>alert("xss")</script>' },
    oversizedName: { email: 'user@example.com', name: 'A'.repeat(10000) },
    nestedInjection: {
      email: 'user@example.com',
      name: 'User',
      metadata: { 'constructor[prototype][isAdmin]': true },
    },
  },
  bulkRecords: Array.from({ length: 100 }, (_, i) => ({
    id: i + 1,
    email: `user${i + 1}@example.com`,
    name: `User ${i + 1}`,
    age: 20 + (i % 50),
    role: i % 10 === 0 ? 'admin' : 'user',
  })),
};

/**
 * Factory Handler test data
 */
export const factoryTestData = {
  adminUser: { id: 1, role: 'admin', username: 'admin' },
  regularUser: { id: 2, role: 'user', username: 'user' },
  managerUser: { id: 3, role: 'manager', username: 'manager' },
  userWithMultipleRoles: { id: 4, roles: ['user', 'editor'], username: 'multi' },
  unauthorizedUser: { id: 5, role: 'guest', username: 'guest' },
};

/**
 * API Parser test data
 */
export const parserTestData = {
  validFieldNames: ['id', 'name', 'email', 'createdAt', 'updatedAt'],
  validFieldNamesWithUnderscore: ['_id', '_internal', '__typename'],
  validFieldNamesWithDots: ['user.name', 'profile.avatar', 'post.author.email'],
  validFieldNamesMixed: ['id', '_internal', 'user.profile_name'],

  invalidFieldNames: {
    sqlInjection: 'name; DROP TABLE users;',
    sqlInjectionWithQuotes: "name'; DELETE FROM users WHERE '1'='1",
    xssScript: '<script>alert(1)</script>',
    xssImgTag: '<img src=x onerror=alert(1)>',
    pathTraversal: '../../../etc/passwd',
    commandInjection: 'name; rm -rf /',
    nullByteInjection: 'name\x00malicious',
    startsWithDigit: '1invalidField',
    startsWithDigitComplex: '99problems',
    withSpaces: 'user name',
    withSpecialChars: 'name!@#$%',
    excessivelyLong: 'a'.repeat(10000),
    controlChars: 'field\x00\x01\x02',
    unicodeTricks: 'field\u202E\u202D',
  },

  commaSeparatedFields: {
    simple: 'id,name,email',
    withWhitespace: 'id, name , email ',
    withEmptyFields: 'id,,name,',
    single: 'id',
    complex: 'id,name,email,createdAt,updatedAt,profile.avatar',
  },

  indexedArrayFields: {
    simple: { 'fields[0]': 'id', 'fields[1]': 'name' },
    withGaps: { 'fields[0]': 'id', 'fields[2]': 'email' },
    singleItem: { 'fields[0]': 'id' },
    largeIndex: { 'fields[0]': 'id', 'fields[100]': 'name' },
  },

  validRelationNames: ['author', 'profile', 'posts', 'comments', 'category'],
  validRelationNamesWithUnderscore: ['_author', 'api_key', '__meta'],
  validRelationNamesWithDots: ['author.profile', 'post.author.profile'],

  invalidRelationNames: {
    sqlInjection: 'author; DROP TABLE users;',
    sqlInjectionWithQuotes: "author'; DELETE FROM posts WHERE '1'='1",
    xssScript: '<script>alert(1)</script>',
    pathTraversal: '../../../etc/passwd',
    commandInjection: 'author; rm -rf /',
    nullByteInjection: 'author\x00malicious',
    startsWithDigit: '1author',
    withSpaces: 'author name',
    withSpecialChars: 'author!@#$%',
    excessivelyLong: 'a'.repeat(10000),
    controlChars: 'author\x00\x01\x02',
  },

  simplePopulate: {
    singleRelation: 'author',
    commaSeparated: 'author,comments,category',
    withUnderscore: 'api_key,_internal',
    wildcard: '*',
  },

  objectStylePopulate: {
    wildcardRelation: { 'populate[author]': '*' },
    withFields: { 'populate[author][fields]': 'name,email' },
    withFieldsIndexed: {
      'populate[author][fields][0]': 'name',
      'populate[author][fields][1]': 'email',
    },
  },

  nestedPopulate: {
    simple: { 'populate[author][populate]': 'profile' },
    withFields: {
      'populate[author][populate][profile][fields]': 'bio,avatar',
    },
    deep: {
      'populate[author][populate][profile][fields]': 'bio',
      'populate[author][populate][profile][populate]': 'avatar',
    },
  },

  maxDepthPopulate: {
    depth1: { 'populate[a]': '*' },
    depth2: { 'populate[a][populate][b]': '*' },
    depth3: { 'populate[a][populate][b][populate][c]': '*' },
    depth4: { 'populate[a][populate][b][populate][c][populate][d]': '*' },
    depth5: { 'populate[a][populate][b][populate][c][populate][d][populate][e]': '*' },
    depth6: { 'populate[a][populate][b][populate][c][populate][d][populate][e][populate][f]': '*' },
  },

  simpleWhereConditions: {
    singleField: { 'where[status]': 'active' },
    multipleFields: { 'where[status]': 'active', 'where[type]': 'post' },
    numberField: { 'where[id]': '123' },
    booleanField: { 'where[active]': 'true' },
    nullField: { 'where[deletedAt]': 'null' },
  },

  comparisonOperators: {
    greaterThan: { 'where[price][$gt]': '100' },
    lessThan: { 'where[age][$lt]': '18' },
    greaterThanOrEqual: { 'where[score][$gte]': '90' },
    lessThanOrEqual: { 'where[views][$lte]': '1000' },
    notEqual: { 'where[status][$ne]': 'archived' },
    combined: { 'where[price][$gte]': '100', 'where[price][$lte]': '500' },
  },

  stringOperators: {
    contains: { 'where[name][$contains]': 'john' },
    startsWith: { 'where[email][$startsWith]': 'admin' },
    endsWith: { 'where[domain][$endsWith]': '.com' },
    like: { 'where[pattern][$like]': '%test%' },
    ilike: { 'where[pattern][$ilike]': '%TEST%' },
  },

  arrayOperators: {
    in: { 'where[status][$in]': ['active', 'pending'] },
    nin: { 'where[role][$nin]': ['guest', 'banned'] },
    inWithNumbers: { 'where[id][$in]': ['1', '2', '3'] },
  },

  logicalOperators: {
    simpleOr: {
      'where[$or][0][status]': 'active',
      'where[$or][1][status]': 'pending',
    },
    simpleAnd: {
      'where[$and][0][status]': 'active',
      'where[$and][1][verified]': 'true',
    },
    nestedOr: {
      'where[$or][0][status]': 'active',
      'where[$or][1][$and][0][status]': 'pending',
      'where[$or][1][$and][1][verified]': 'true',
    },
  },

  invalidWhereConditions: {
    sqlInjectionField: { 'where[name; DROP TABLE users;]': 'test' },
    sqlInjectionValue: { 'where[name]': "'; DROP TABLE users; --" },
    xssInField: { 'where[<script>alert(1)</script>]': 'test' },
    xssInValue: { 'where[name]': '<script>alert(1)</script>' },
    pathTraversalField: { 'where[../../../etc/passwd]': 'test' },
    commandInjectionValue: { 'where[name]': '; rm -rf /' },
    nullByteField: { 'where[name\x00malicious]': 'test' },
    invalidOperator: { 'where[price][$invalidOp]': '100' },
    excessivelyLongField: { [`where[${'a'.repeat(10000)}]`]: 'test' },
    excessivelyLongValue: { 'where[name]': 'x'.repeat(100000) },
  },

  paginationParams: {
    limitOffset: { limit: '10', offset: '20' },
    pagePageSize: { page: '2', pageSize: '15' },
    pageOnly: { page: '3' },
    pageSizeOnly: { pageSize: '50' },
    defaultPagination: {},
    largePage: { page: '100', pageSize: '25' },
  },

  invalidPaginationParams: {
    negativeLimit: { limit: '-10' },
    negativeOffset: { offset: '-5' },
    zeroPage: { page: '0' },
    negativePage: { page: '-1' },
    zeroPageSize: { pageSize: '0' },
    negativePageSize: { pageSize: '-10' },
    exceedsMaxPageSize: { limit: '200' },
    nonNumericLimit: { limit: 'abc' },
    nonNumericPage: { page: 'xyz' },
  },

  sortParams: {
    singleAsc: { sort: 'name' },
    singleDesc: { sort: '-createdAt' },
    multiple: { sort: 'name,-age,status' },
    array: { sort: ['name', '-age'] },
    withDots: { sort: 'user.profile.name' },
    withUnderscore: { sort: '_id,-created_at' },
  },

  invalidSortParams: {
    sqlInjection: { sort: 'name; DROP TABLE users;' },
    specialChars: { sort: 'field!@#$%' },
    startsWithDigit: { sort: '1field' },
    withSpaces: { sort: 'my field' },
    pathTraversal: { sort: '../../../etc/passwd' },
    xss: { sort: '<script>alert(1)</script>' },
    excessivelyLong: { sort: 'a'.repeat(10000) },
  },

  integratedQueryParams: {
    simple: {
      fields: 'id,name',
      'where[status]': 'active',
      populate: 'author',
      sort: '-id',
      limit: '5',
    },
    complex: {
      'fields[0]': 'id',
      'fields[1]': 'title',
      'where[published]': 'true',
      'where[views][$gte]': '100',
      'populate[author][fields]': 'name,email',
      'populate[comments][populate]': 'user',
      sort: 'title,-createdAt',
      page: '2',
      pageSize: '20',
    },
  },

  serializerData: {
    simpleRecord: {
      id: 1,
      name: 'John Doe',
      email: 'john@example.com',
      age: 30,
    },
    recordWithDate: {
      id: 1,
      name: 'John',
      createdAt: new Date('2024-01-01T12:00:00Z'),
      updatedAt: new Date('2024-06-15T08:30:00Z'),
    },
    recordWithJson: {
      id: 1,
      name: 'John',
      profile: JSON.stringify({ bio: 'Hello World', city: 'London', age: 30 }),
      metadata: JSON.stringify({ tags: ['tech', 'design'], verified: true }),
    },
    recordWithArray: {
      id: 1,
      name: 'John',
      tags: ['javascript', 'typescript', 'react'],
      roles: ['admin', 'user'],
    },
    recordWithNullUndefined: {
      id: 1,
      name: 'John',
      email: null,
      phone: undefined,
      deletedAt: null,
    },
    collection: [
      { id: 1, name: 'John', age: 30 },
      { id: 2, name: 'Jane', age: 25 },
      { id: 3, name: 'Bob', age: 35 },
    ],
    emptyCollection: [],
    paginationMeta: {
      pagination: {
        page: 1,
        pageSize: 25,
        pageCount: 4,
        total: 100,
      },
    },
  },

  invalidSerializerData: {
    notAnObject: 'string value',
    notAnArray: { not: 'array' },
    circularReference: (() => {
      const obj: any = { id: 1, name: 'Test' };
      obj.self = obj;
      return obj;
    })(),
    invalidDate: { id: 1, createdAt: 'not-a-date' },
    invalidJson: { id: 1, data: 'invalid{json}' },
  },

  // Relations serializer test data
  relationsData: {
    // Simple belongsTo relation
    postWithAuthor: {
      id: 1,
      title: 'Hello World',
      author: { id: 10, name: 'John Doe', email: 'john@example.com' }
    },

    // hasMany relation
    postWithComments: {
      id: 1,
      title: 'Post Title',
      comments: [
        { id: 101, text: 'Nice post!', createdAt: new Date('2024-01-01') },
        { id: 102, text: 'Great work', createdAt: new Date('2024-01-02') }
      ]
    },

    // Nested relations (2 levels)
    postWithNestedAuthor: {
      id: 1,
      title: 'Post Title',
      author: {
        id: 10,
        name: 'John Doe',
        profile: { id: 20, bio: 'Developer', avatar: 'avatar.jpg' }
      }
    },

    // Deep nested relations (3 levels)
    postWithDeepNested: {
      id: 1,
      title: 'Post Title',
      author: {
        id: 10,
        name: 'John',
        profile: {
          id: 20,
          bio: 'Dev',
          settings: { id: 30, theme: 'dark', notifications: true }
        }
      }
    },

    // Multiple relations
    postWithMultipleRelations: {
      id: 1,
      title: 'Post Title',
      author: { id: 10, name: 'John' },
      comments: [
        { id: 101, text: 'Comment 1', user: { id: 11, name: 'Alice' } },
        { id: 102, text: 'Comment 2', user: { id: 12, name: 'Bob' } }
      ],
      tags: [
        { id: 201, name: 'javascript' },
        { id: 202, name: 'typescript' }
      ]
    },

    // Circular reference
    circularAuthorPost: (() => {
      const author: any = { id: 1, name: 'John' };
      const post: any = { id: 10, title: 'Hello', author: author };
      author.posts = [post];
      return { author, post };
    })(),

    // Null relation
    postWithNullAuthor: {
      id: 1,
      title: 'Post Title',
      author: null
    },

    // Undefined relation
    postWithUndefinedComments: {
      id: 1,
      title: 'Post Title',
      comments: undefined
    },

    // Empty array relation
    postWithEmptyComments: {
      id: 1,
      title: 'Post Title',
      comments: []
    },

    // Relation with internal fields
    postWithInternalFields: {
      id: 1,
      title: 'Post',
      author: {
        id: 10,
        name: 'John',
        _password: 'secret',
        _internal: 'data',
        email: 'john@example.com'
      }
    },
  },

  // Migration test data
  migrationSchemas: {
    // Simple schemas for basic tests
    emptySchema: {
      name: 'empty',
      fields: {}
    },

    usersBasic: {
      name: 'users',
      fields: {
        id: { type: 'number' as const, required: true },
        name: { type: 'string' as const, required: true }
      }
    },

    usersWithEmail: {
      name: 'users',
      fields: {
        id: { type: 'number' as const, required: true },
        name: { type: 'string' as const, required: true },
        email: { type: 'string' as const, required: true }
      }
    },

    usersWithoutEmail: {
      name: 'users',
      fields: {
        id: { type: 'number' as const, required: true },
        name: { type: 'string' as const, required: true }
      }
    },

    usersAgeOptional: {
      name: 'users',
      fields: {
        age: { type: 'number' as const, required: false }
      }
    },

    usersAgeRequired: {
      name: 'users',
      fields: {
        age: { type: 'number' as const, required: true }
      }
    },

    usersWithConstraints: {
      name: 'users',
      fields: {
        username: { type: 'string' as const, minLength: 3, maxLength: 20 }
      }
    },

    usersWithDifferentConstraints: {
      name: 'users',
      fields: {
        username: { type: 'string' as const, minLength: 5, maxLength: 50 }
      }
    },

    usersWithIndex: {
      name: 'users',
      fields: {
        id: { type: 'number' as const, required: true },
        email: { type: 'string' as const, required: true }
      },
      indexes: [
        { fields: ['email'], unique: true }
      ]
    },

    postsBasic: {
      name: 'posts',
      fields: {
        id: { type: 'number' as const, required: true }
      }
    },

    commentsBasic: {
      name: 'comments',
      fields: {
        id: { type: 'number' as const, required: true }
      }
    },
  },
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

  expressRequest: (overrides?: Partial<typeof apiContextData.validExpressRequest>) => ({
    ...apiContextData.validExpressRequest,
    ...overrides,
  }),

  nextRequest: (url: string, options?: RequestInit) => {
    return new Request(url, {
      method: 'GET',
      headers: { 'content-type': 'application/json' },
      ...options,
    });
  },
};
