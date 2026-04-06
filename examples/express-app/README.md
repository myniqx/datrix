# Datrix Express.js Example

Complete example of integrating Datrix with Express.js for traditional REST APIs.

## Features Demonstrated

- ✅ Express.js integration
- ✅ PostgreSQL database adapter
- ✅ Type-safe CRUD operations
- ✅ Authentication middleware with JWT
- ✅ CORS configuration
- ✅ Error handling
- ✅ Request validation
- ✅ File uploads with Multer integration
- ✅ Automatic API documentation

## Prerequisites

- Node.js 18+ or 20+
- PostgreSQL 14+ running
- pnpm (recommended) or npm

## Installation

### 1. Initialize Project

```bash
mkdir datrix-express-example
cd datrix-express-example
pnpm init
```

### 2. Install Dependencies

```bash
# Core dependencies
pnpm add express datrix pg

# TypeScript dependencies
pnpm add -D typescript @types/express @types/node tsx nodemon

# Additional dependencies
pnpm add cors helmet compression morgan
pnpm add -D @types/cors @types/compression @types/morgan

# File upload
pnpm add multer
pnpm add -D @types/multer
```

### 3. Set Up TypeScript

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### 4. Set Up Environment Variables

Create `.env`:

```env
# Server
PORT=3000
NODE_ENV=development

# Database
DATABASE_URL="postgresql://user:password@localhost:5432/datrix_express"

# JWT
JWT_SECRET="your-super-secret-jwt-key-min-32-chars-long"

# Upload
UPLOAD_DIR="./uploads"
UPLOAD_URL="http://localhost:3000/uploads"

# CORS
CORS_ORIGIN="http://localhost:3000,http://localhost:5173"
```

### 5. Update package.json Scripts

```json
{
  "scripts": {
    "dev": "nodemon --exec tsx src/server.ts",
    "build": "tsc",
    "start": "node dist/server.js",
    "migrate": "datrix migrate",
    "migrate:dry-run": "datrix migrate --dry-run",
    "type-check": "tsc --noEmit"
  }
}
```

### 6. Create Project Structure

```bash
mkdir -p src/{schemas,routes,middleware,utils}
```

## Project Structure

```
datrix-express-example/
├── src/
│   ├── server.ts              # Main Express server
│   ├── schemas/
│   │   ├── user.schema.ts     # User schema
│   │   └── post.schema.ts     # Post schema
│   ├── routes/
│   │   ├── auth.routes.ts     # Authentication routes
│   │   ├── user.routes.ts     # User CRUD routes
│   │   ├── post.routes.ts     # Post CRUD routes
│   │   └── upload.routes.ts   # File upload routes
│   ├── middleware/
│   │   ├── auth.middleware.ts # JWT authentication
│   │   ├── error.middleware.ts # Error handling
│   │   └── upload.middleware.ts # File upload
│   └── utils/
│       ├── datrix.ts           # Datrix client
│       └── jwt.ts             # JWT utilities
├── datrix.config.ts            # Datrix configuration
├── .env                       # Environment variables
├── tsconfig.json              # TypeScript config
└── package.json
```

## Running the Example

### 1. Run Migrations

```bash
pnpm migrate
```

### 2. Start Development Server

```bash
pnpm dev
```

Server will start on `http://localhost:3000`

### 3. Test Endpoints

#### Health Check

```bash
curl http://localhost:3000/health
```

Response:
```json
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "uptime": 123.456
}
```

#### Register User

```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "SecurePass123!",
    "name": "John Doe"
  }'
```

#### Login

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "SecurePass123!"
  }'
```

Save the returned `token` for authenticated requests.

#### List Users

```bash
curl http://localhost:3000/api/users \
  -H "Authorization: Bearer YOUR_TOKEN"
```

#### Create Post

```bash
curl -X POST http://localhost:3000/api/posts \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "My First Post",
    "content": "This is my first post using Datrix!",
    "status": "published"
  }'
```

#### Upload File

```bash
curl -X POST http://localhost:3000/api/upload \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "file=@/path/to/image.jpg"
```

## API Endpoints

### Authentication

- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login user
- `GET /api/auth/me` - Get current user
- `POST /api/auth/logout` - Logout user
- `POST /api/auth/refresh` - Refresh access token

### Users

- `GET /api/users` - List users (with filters, pagination)
- `GET /api/users/:id` - Get single user
- `POST /api/users` - Create user (admin only)
- `PUT /api/users/:id` - Update user
- `PATCH /api/users/:id` - Partial update user
- `DELETE /api/users/:id` - Delete user (admin only)

### Posts

- `GET /api/posts` - List posts (with filters, pagination)
- `GET /api/posts/:id` - Get single post
- `POST /api/posts` - Create post
- `PUT /api/posts/:id` - Update post
- `DELETE /api/posts/:id` - Delete post
- `GET /api/posts/slug/:slug` - Get post by slug

### Uploads

- `POST /api/upload` - Upload file
- `DELETE /api/upload/:key` - Delete file
- `GET /uploads/:key` - Serve file (static)

## Middleware

### Authentication Middleware

Protects routes requiring authentication:

```typescript
import { authMiddleware } from '@/middleware/auth.middleware';

// Protect single route
router.get('/api/users', authMiddleware, (req, res) => {
  // req.user is now available
});

// Protect all routes in router
router.use(authMiddleware);
```

### Role Middleware

Restrict access by role:

```typescript
import { requireRole } from '@/middleware/auth.middleware';

// Admin only
router.delete('/api/users/:id', requireRole('admin'), (req, res) => {
  // Only admins can access
});

// Multiple roles
router.post('/api/posts', requireRole(['user', 'admin']), (req, res) => {
  // Users and admins can access
});
```

### Error Middleware

Centralized error handling:

```typescript
import { errorHandler } from '@/middleware/error.middleware';

// Add at the end of middleware chain
app.use(errorHandler);
```

## Query Parameters

### Filtering

```bash
# Equality
GET /api/posts?where[status]=published

# Comparison
GET /api/posts?where[viewCount][$gt]=100

# String operations
GET /api/posts?where[title][$contains]=tutorial

# Multiple conditions
GET /api/posts?where[status]=published&where[featured]=true
```

### Pagination

```bash
# Page-based
GET /api/posts?page=2&pageSize=25

# Offset-based
GET /api/posts?limit=25&offset=50
```

### Sorting

```bash
# Ascending
GET /api/posts?sort=createdAt

# Descending
GET /api/posts?sort=-createdAt

# Multiple fields
GET /api/posts?sort=featured,-createdAt
```

### Field Selection

```bash
# Select specific fields
GET /api/users?fields=id,name,email

# Array notation
GET /api/users?fields[0]=id&fields[1]=name
```

### Populate Relations

```bash
# Populate author
GET /api/posts?populate=author

# Populate with field selection
GET /api/posts?populate[author][fields]=name,email

# Nested populate
GET /api/posts?populate[author][populate][profile]=*
```

## Error Handling

All errors return consistent format:

```json
{
  "error": {
    "message": "Error description",
    "code": "ERROR_CODE",
    "status": 400,
    "details": {
      "field": "email",
      "value": "invalid"
    }
  }
}
```

Common error codes:
- `VALIDATION_ERROR` (400) - Invalid input
- `UNAUTHORIZED` (401) - Not authenticated
- `FORBIDDEN` (403) - Not authorized
- `NOT_FOUND` (404) - Resource not found
- `CONFLICT` (409) - Duplicate resource
- `INTERNAL_ERROR` (500) - Server error

## Production Deployment

### 1. Build for Production

```bash
pnpm build
```

### 2. Set Environment Variables

```env
NODE_ENV=production
DATABASE_URL="postgresql://prod_user:prod_pass@db.host:5432/prod_db"
JWT_SECRET="production-secret-min-64-chars"
PORT=8080
```

### 3. Start Production Server

```bash
NODE_ENV=production pnpm start
```

### 4. Use Process Manager

```bash
# Install PM2
npm install -g pm2

# Start with PM2
pm2 start dist/server.js --name datrix-api

# Enable startup script
pm2 startup
pm2 save
```

### 5. Set Up Nginx Reverse Proxy

```nginx
server {
    listen 80;
    server_name api.example.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## Performance Optimization

### 1. Enable Compression

Already included in `server.ts`:
```typescript
import compression from 'compression';
app.use(compression());
```

### 2. Add Rate Limiting

```bash
pnpm add express-rate-limit
```

```typescript
import rateLimit from 'express-rate-limit';

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window
});

app.use('/api/', limiter);
```

### 3. Add Caching

```bash
pnpm add redis
```

```typescript
import { createClient } from 'redis';

const redis = createClient({ url: process.env.REDIS_URL });
await redis.connect();

// Cache middleware
const cache = (duration: number) => async (req, res, next) => {
  const key = `cache:${req.originalUrl}`;
  const cached = await redis.get(key);

  if (cached) {
    return res.json(JSON.parse(cached));
  }

  // Store original json function
  const originalJson = res.json.bind(res);

  // Override json function
  res.json = (data) => {
    redis.setEx(key, duration, JSON.stringify(data));
    return originalJson(data);
  };

  next();
};

// Use cache
app.get('/api/posts', cache(60), (req, res) => {
  // Response will be cached for 60 seconds
});
```

### 4. Database Connection Pooling

Already configured in `datrix.config.ts`:
```typescript
{
  connectionString: process.env.DATABASE_URL,
  max: 20, // Max 20 connections
  idleTimeoutMillis: 30000,
}
```

## Testing

### Install Testing Dependencies

```bash
pnpm add -D vitest supertest @types/supertest
```

### Example Test

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from './server';

describe('User API', () => {
  let authToken: string;

  beforeAll(async () => {
    // Register and login
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'test@example.com',
        password: 'Test123!',
        name: 'Test User'
      });

    authToken = res.body.data.token;
  });

  it('should list users', async () => {
    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toBeInstanceOf(Array);
  });

  afterAll(async () => {
    // Cleanup
  });
});
```

## Troubleshooting

### Port Already in Use

```
Error: listen EADDRINUSE: address already in use :::3000
```

**Solution:** Change port in `.env` or kill process using port:
```bash
lsof -ti:3000 | xargs kill
```

### Database Connection Failed

```
Error: connect ECONNREFUSED
```

**Solution:** Ensure PostgreSQL is running and credentials are correct.

### CORS Errors

```
Access to fetch at 'http://localhost:3000/api/users' from origin 'http://localhost:5173' has been blocked by CORS
```

**Solution:** Add frontend origin to `CORS_ORIGIN` in `.env`.

## Next Steps

- [ ] Add API documentation (Swagger/OpenAPI)
- [ ] Implement refresh tokens
- [ ] Add email verification
- [ ] Set up logging (Winston/Pino)
- [ ] Add request validation (Zod)
- [ ] Implement rate limiting
- [ ] Add monitoring (Prometheus/Grafana)
- [ ] Set up CI/CD pipeline
- [ ] Add comprehensive tests
- [ ] Configure Docker deployment

## Resources

- [Express.js Documentation](https://expressjs.com/)
- [Datrix Documentation](../../SETUP_GUIDE.md)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)

## License

MIT
