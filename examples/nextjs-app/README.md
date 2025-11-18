# Forja Next.js App Router Example

Complete example of integrating Forja with Next.js 14+ App Router.

## Features Demonstrated

- ✅ PostgreSQL database adapter
- ✅ Type-safe schema definitions
- ✅ RESTful API routes (CRUD operations)
- ✅ Authentication with JWT
- ✅ File uploads with local storage
- ✅ Relation handling (User → Posts)
- ✅ Lifecycle hooks
- ✅ RBAC permissions
- ✅ Automatic migrations

## Prerequisites

- Node.js 18+ or 20+
- PostgreSQL 14+ running locally or remotely
- pnpm (recommended) or npm

## Installation

### 1. Create Next.js App

```bash
npx create-next-app@latest forja-nextjs-example
cd forja-nextjs-example

# Select options:
# - TypeScript: Yes
# - ESLint: Yes
# - Tailwind: Yes (optional)
# - App Router: Yes
# - Import alias: @/* (default)
```

### 2. Install Forja

```bash
pnpm add forja
# or
npm install forja
```

### 3. Install Database Driver

```bash
pnpm add pg
# or
npm install pg
```

### 4. Set Up Environment Variables

Create `.env.local`:

```env
DATABASE_URL="postgresql://user:password@localhost:5432/forja_nextjs"
JWT_SECRET="your-super-secret-jwt-key-min-32-chars-long"
UPLOAD_DIR="./public/uploads"
UPLOAD_URL="http://localhost:3000/uploads"
```

**Security Note:** Generate a strong JWT secret:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 5. Create Configuration File

Create `forja.config.ts` in project root (see example in this directory).

### 6. Create Schemas

Create `schemas/` directory with schema files (see examples in this directory).

### 7. Create API Routes

Create API routes in `app/api/` directory (see examples in this directory).

## Project Structure

```
forja-nextjs-example/
├── app/
│   ├── api/
│   │   ├── users/
│   │   │   └── [...forja]/
│   │   │       └── route.ts       # User CRUD endpoints
│   │   ├── posts/
│   │   │   └── [...forja]/
│   │   │       └── route.ts       # Post CRUD endpoints
│   │   ├── auth/
│   │   │   ├── login/
│   │   │   │   └── route.ts       # Login endpoint
│   │   │   ├── register/
│   │   │   │   └── route.ts       # Registration endpoint
│   │   │   └── me/
│   │   │       └── route.ts       # Get current user
│   │   └── upload/
│   │       └── route.ts           # File upload endpoint
│   ├── layout.tsx
│   └── page.tsx
├── schemas/
│   ├── user.schema.ts             # User schema
│   └── post.schema.ts             # Post schema
├── lib/
│   └── forja.ts                   # Forja client instance
├── forja.config.ts                # Forja configuration
├── .env.local                     # Environment variables
├── package.json
└── tsconfig.json
```

## Running the Example

### 1. Run Migrations

```bash
# Forja automatically creates tables based on schemas
pnpm forja migrate
```

### 2. Start Development Server

```bash
pnpm dev
```

### 3. Test API Endpoints

#### Create a User (Register)

```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@example.com",
    "password": "SecurePassword123!",
    "name": "Admin User",
    "role": "admin"
  }'
```

#### Login

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@example.com",
    "password": "SecurePassword123!"
  }'
```

Response:
```json
{
  "data": {
    "user": {
      "id": "1",
      "email": "admin@example.com",
      "name": "Admin User",
      "role": "admin"
    },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

**Save the token** for authenticated requests.

#### Get Current User

```bash
curl http://localhost:3000/api/auth/me \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

#### Create a Post

```bash
curl -X POST http://localhost:3000/api/posts \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "My First Post",
    "content": "This is the content of my first post!",
    "status": "published"
  }'
```

#### Get All Posts (with author populated)

```bash
curl "http://localhost:3000/api/posts?populate[author][fields][0]=name&populate[author][fields][1]=email"
```

#### Get Posts with Filtering

```bash
# Published posts only
curl "http://localhost:3000/api/posts?where[status]=published"

# Posts with pagination
curl "http://localhost:3000/api/posts?page=1&pageSize=10"

# Posts with sorting
curl "http://localhost:3000/api/posts?sort=-createdAt"

# Complex query
curl "http://localhost:3000/api/posts?where[status]=published&where[title][\$contains]=First&populate=author&sort=-createdAt&page=1&pageSize=10"
```

#### Upload a File

```bash
curl -X POST http://localhost:3000/api/upload \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -F "file=@/path/to/image.jpg"
```

Response:
```json
{
  "data": {
    "key": "1698765432000-abc123.jpg",
    "url": "http://localhost:3000/uploads/1698765432000-abc123.jpg",
    "size": 123456,
    "mimetype": "image/jpeg"
  }
}
```

#### Update a Post

```bash
curl -X PUT http://localhost:3000/api/posts/1 \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Updated Title",
    "content": "Updated content"
  }'
```

#### Delete a Post

```bash
curl -X DELETE http://localhost:3000/api/posts/1 \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

## API Reference

### Query Parameters

#### Field Selection
Select specific fields to return:
```
?fields[0]=name&fields[1]=email
?fields=name,email
```

#### Filtering (WHERE)
Filter results with various operators:
```
# Equality
?where[status]=published

# Comparison
?where[price][$gt]=100
?where[price][$gte]=100
?where[price][$lt]=1000
?where[price][$lte]=1000

# String operations
?where[title][$contains]=search
?where[title][$startsWith]=Hello
?where[email][$endsWith]=@example.com

# Array operations
?where[status][$in][0]=draft&where[status][$in][1]=published
?where[id][$nin][0]=1&where[id][$nin][1]=2

# Logical operators
?where[$or][0][status]=published&where[$or][1][featured]=true
```

#### Pagination
```
# Page-based (recommended)
?page=2&pageSize=25

# Offset-based
?limit=25&offset=50
```

#### Sorting
```
# Single field (ascending)
?sort=createdAt

# Single field (descending)
?sort=-createdAt

# Multiple fields
?sort=status,-createdAt,title
```

#### Populate (Relations)
```
# All relations
?populate=*

# Specific relation
?populate=author

# Relation with field selection
?populate[author][fields][0]=name&populate[author][fields][1]=email

# Nested relations
?populate[author][populate][profile]=*

# Multiple relations
?populate[author]=*&populate[category]=*
```

## Schema Features

### Type Inference
Forja automatically infers TypeScript types from schemas:

```typescript
import { userSchema } from '@/schemas/user.schema';
import type { InferSchemaType } from 'forja';

type User = InferSchemaType<typeof userSchema>;
// Type is automatically: {
//   id?: string;
//   email: string;
//   password: string;
//   name: string;
//   role: 'user' | 'admin' | 'moderator';
//   bio?: string;
//   avatar?: string;
//   createdAt?: Date;
//   updatedAt?: Date;
// }
```

### Validation
All fields are validated according to schema rules:

```typescript
{
  email: {
    type: 'string',
    required: true,
    unique: true,
    pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    errorMessage: 'Invalid email format'
  }
}
```

### Lifecycle Hooks
Execute custom logic at different lifecycle events:

```typescript
{
  hooks: {
    beforeCreate: async (data) => {
      // Hash password before storing
      const hashedPassword = await hash(data.password);
      return { ...data, password: hashedPassword };
    },
    afterFind: async (results) => {
      // Remove password from response
      if (Array.isArray(results)) {
        return results.map(({ password, ...safe }) => safe);
      }
      const { password, ...safe } = results;
      return safe;
    }
  }
}
```

### Relations
Define relationships between schemas:

```typescript
{
  author: {
    type: 'relation',
    model: 'User',
    kind: 'belongsTo',
    foreignKey: 'authorId'
  }
}
```

## Authentication

### JWT Strategy
The example uses JWT for authentication:

1. User registers/logs in
2. Server returns JWT token
3. Client includes token in `Authorization` header
4. Server validates token on protected routes

### Role-Based Access Control (RBAC)
Permissions are enforced using RBAC:

```typescript
permissions: {
  read: ['user', 'admin', 'moderator'],  // All authenticated users
  create: ['user', 'admin'],              // Users and admins
  update: ['admin'],                      // Admin only
  delete: ['admin']                       // Admin only
}
```

### Custom Permission Functions
For more complex authorization:

```typescript
permissions: {
  update: (context) => {
    // Users can only update their own posts
    const userId = context.user?.id;
    const postAuthorId = context.params.authorId;
    const isAdmin = context.user?.role === 'admin';

    return userId === postAuthorId || isAdmin;
  }
}
```

## File Uploads

### Local Storage
Files are stored in `public/uploads/` by default:

```typescript
import { UploadPlugin, LocalStorageProvider } from 'forja/plugins';

const uploadPlugin = new UploadPlugin({
  provider: new LocalStorageProvider({
    basePath: process.env.UPLOAD_DIR!,
    baseUrl: process.env.UPLOAD_URL!
  }),
  validation: {
    maxSize: 5 * 1024 * 1024, // 5MB
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp']
  }
});
```

### S3 Storage
For production, use S3:

```typescript
import { S3StorageProvider } from 'forja/plugins';

const uploadPlugin = new UploadPlugin({
  provider: new S3StorageProvider({
    bucket: process.env.S3_BUCKET!,
    region: process.env.S3_REGION!,
    accessKeyId: process.env.S3_ACCESS_KEY!,
    secretAccessKey: process.env.S3_SECRET_KEY!
  })
});
```

## Migrations

### Automatic Migrations
Forja automatically generates migrations when schemas change:

```bash
# Create migration from schema changes
pnpm forja migrate

# Dry run (see what will change)
pnpm forja migrate --dry-run

# Rollback last migration
pnpm forja migrate --rollback
```

### Manual Migrations
For complex changes, create manual migrations:

```typescript
// migrations/001-add-slug-to-posts.ts
export default {
  up: async (adapter) => {
    await adapter.executeQuery({
      type: 'raw',
      sql: 'ALTER TABLE posts ADD COLUMN slug VARCHAR(255)'
    });
  },
  down: async (adapter) => {
    await adapter.executeQuery({
      type: 'raw',
      sql: 'ALTER TABLE posts DROP COLUMN slug'
    });
  }
};
```

## Production Deployment

### Environment Variables
Set these in production:

```env
DATABASE_URL="postgresql://prod_user:prod_pass@db.example.com:5432/forja_prod"
JWT_SECRET="production-secret-64-chars-minimum-very-secure-random-string"
UPLOAD_DIR="/var/www/uploads"
UPLOAD_URL="https://cdn.example.com/uploads"
NODE_ENV="production"
```

### Vercel Deployment

1. Install Vercel Postgres:
```bash
pnpm add @vercel/postgres
```

2. Update `forja.config.ts` to use Vercel Postgres connection

3. Deploy:
```bash
vercel --prod
```

4. Set environment variables in Vercel dashboard

### Performance Tips

1. **Enable Connection Pooling**:
```typescript
database: {
  adapter: 'postgres',
  connection: {
    connectionString: process.env.DATABASE_URL,
    max: 20, // Max connections in pool
    idleTimeoutMillis: 30000
  }
}
```

2. **Add Database Indexes**:
```typescript
{
  indexes: [
    { fields: ['email'], unique: true },
    { fields: ['status', 'createdAt'] },
    { fields: ['authorId'] }
  ]
}
```

3. **Use Field Selection**:
```typescript
// Only fetch needed fields
?fields=id,title,status&populate[author][fields]=name
```

4. **Implement Caching** (Redis, Vercel KV, etc.)

## Troubleshooting

### Database Connection Issues
```
Error: connection refused
```
**Solution:** Ensure PostgreSQL is running and connection string is correct.

### JWT Token Invalid
```
Error: Token expired
```
**Solution:** Token has expired. User needs to log in again.

### Migration Failures
```
Error: column already exists
```
**Solution:** Database is out of sync. Drop tables and re-run migrations, or create manual migration.

### File Upload Issues
```
Error: ENOENT: no such file or directory
```
**Solution:** Ensure upload directory exists and has write permissions:
```bash
mkdir -p public/uploads
chmod 755 public/uploads
```

## Next Steps

- [ ] Add email verification
- [ ] Implement password reset
- [ ] Add rate limiting
- [ ] Set up logging (Winston, Pino)
- [ ] Add request validation middleware
- [ ] Implement refresh tokens
- [ ] Add API documentation (Swagger/OpenAPI)
- [ ] Set up monitoring (Sentry, DataDog)
- [ ] Add unit and integration tests
- [ ] Configure CI/CD pipeline

## Resources

- [Forja Documentation](../../../SETUP_GUIDE.md)
- [Next.js Documentation](https://nextjs.org/docs)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)

## License

MIT
