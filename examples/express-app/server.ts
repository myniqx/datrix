/**
 * Express Server with Forja Integration
 *
 * Complete Express.js server with:
 * - Forja database management
 * - JWT authentication
 * - CORS configuration
 * - Error handling
 * - File uploads
 * - Security best practices
 */

import express from 'express';
import type { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import { createUnifiedHandler } from 'forja/api';
import { buildContextFromExpress } from 'forja/api/context';
import config from './forja.config';

// Import schemas
import { userSchema } from './schemas/user.schema';
import { postSchema } from './schemas/post.schema';

/**
 * Initialize Express app
 */
const app: Express = express();

/**
 * Environment Configuration
 */
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const CORS_ORIGIN = process.env.CORS_ORIGIN?.split(',') || ['http://localhost:3000'];

/**
 * Middleware Configuration
 */

// Security headers
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

// CORS
app.use(
  cors({
    origin: CORS_ORIGIN,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// Compression
app.use(compression());

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging (development only)
if (NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

// Serve uploaded files statically
app.use('/uploads', express.static(process.env.UPLOAD_DIR || './uploads'));

/**
 * Health Check Endpoint
 */
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: NODE_ENV,
  });
});

/**
 * API Documentation
 */
app.get('/', (req: Request, res: Response) => {
  res.json({
    name: 'Forja Express API',
    version: '1.0.0',
    endpoints: {
      health: 'GET /health',
      auth: {
        register: 'POST /api/auth/register',
        login: 'POST /api/auth/login',
        me: 'GET /api/auth/me',
      },
      users: {
        list: 'GET /api/users',
        get: 'GET /api/users/:id',
        create: 'POST /api/users',
        update: 'PUT /api/users/:id',
        delete: 'DELETE /api/users/:id',
      },
      posts: {
        list: 'GET /api/posts',
        get: 'GET /api/posts/:id',
        create: 'POST /api/posts',
        update: 'PUT /api/posts/:id',
        delete: 'DELETE /api/posts/:id',
      },
      upload: {
        upload: 'POST /api/upload',
        delete: 'DELETE /api/upload/:key',
      },
    },
    documentation: 'https://github.com/yourusername/forja',
  });
});

/**
 * Authentication Middleware
 */
async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({
        error: {
          message: 'No authentication token provided',
          code: 'UNAUTHORIZED',
        },
      });
      return;
    }

    const token = authHeader.substring(7);

    // Verify JWT (simplified - use auth plugin in production)
    const user = await verifyJWT(token);

    // Attach user to request
    req.user = user;

    next();
  } catch (error) {
    res.status(401).json({
      error: {
        message: 'Invalid or expired token',
        code: 'UNAUTHORIZED',
      },
    });
  }
}

/**
 * Role-based access control middleware
 */
function requireRole(roles: string | string[]) {
  const allowedRoles = Array.isArray(roles) ? roles : [roles];

  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        error: {
          message: 'Authentication required',
          code: 'UNAUTHORIZED',
        },
      });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({
        error: {
          message: 'Insufficient permissions',
          code: 'FORBIDDEN',
        },
      });
      return;
    }

    next();
  };
}

/**
 * Authentication Routes
 */

// Register
app.post('/api/auth/register', async (req: Request, res: Response) => {
  try {
    const { email, password, name } = req.body;

    // Validate input
    if (!email || !password || !name) {
      res.status(400).json({
        error: {
          message: 'Email, password, and name are required',
          code: 'VALIDATION_ERROR',
        },
      });
      return;
    }

    // Create user using Forja
    const createHandler = createUnifiedHandler({
      schema: userSchema,
      adapter: config.adapter,
    });

    const context = buildContextFromExpress(req);
    context.body = { email, password, name, role: 'user' };

    const response = await createHandler(context);

    if (response.status !== 201) {
      res.status(response.status).json(response.body);
      return;
    }

    // Generate JWT token
    const user = response.body.data;
    const token = await generateJWT({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    res.status(201).json({
      data: {
        user,
        token,
      },
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      error: {
        message: 'Registration failed',
        code: 'INTERNAL_ERROR',
      },
    });
  }
});

// Login
app.post('/api/auth/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({
        error: {
          message: 'Email and password are required',
          code: 'VALIDATION_ERROR',
        },
      });
      return;
    }

    // Find user by email
    const findHandler = createUnifiedHandler({
      schema: userSchema,
      adapter: config.adapter,
    });

    const context = buildContextFromExpress(req);
    context.query = { where: JSON.stringify({ email }) };

    const response = await findHandler(context);

    if (response.status !== 200 || !response.body.data?.length) {
      res.status(401).json({
        error: {
          message: 'Invalid email or password',
          code: 'UNAUTHORIZED',
        },
      });
      return;
    }

    const user = response.body.data[0];

    // Verify password (implement verifyPassword helper)
    const isValid = await verifyPassword(password, user.password);

    if (!isValid) {
      res.status(401).json({
        error: {
          message: 'Invalid email or password',
          code: 'UNAUTHORIZED',
        },
      });
      return;
    }

    // Generate JWT token
    const token = await generateJWT({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    // Remove password from response
    const { password: _, ...safeUser } = user;

    res.json({
      data: {
        user: safeUser,
        token,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      error: {
        message: 'Login failed',
        code: 'INTERNAL_ERROR',
      },
    });
  }
});

// Get current user
app.get('/api/auth/me', authMiddleware, async (req: Request, res: Response) => {
  try {
    const findHandler = createUnifiedHandler({
      schema: userSchema,
      adapter: config.adapter,
    });

    const context = buildContextFromExpress(req);
    context.params = { id: req.user!.id };

    const response = await findHandler(context);

    res.status(response.status).json(response.body);
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({
      error: {
        message: 'Failed to get user',
        code: 'INTERNAL_ERROR',
      },
    });
  }
});

/**
 * User Routes
 */

// Create Forja handler for users
const userHandler = createUnifiedHandler({
  schema: userSchema,
  adapter: config.adapter,
  permissions: {
    read: undefined, // Public
    create: ['admin'], // Admin only
    update: (context) => {
      return (
        context.user?.id === context.params.id ||
        context.user?.role === 'admin'
      );
    },
    delete: ['admin'],
  },
  middleware: [authMiddleware],
});

// User CRUD routes
app.all('/api/users/:id?', async (req: Request, res: Response) => {
  const context = buildContextFromExpress(req);
  const response = await userHandler(context);
  res.status(response.status).json(response.body);
});

/**
 * Post Routes
 */

const postHandler = createUnifiedHandler({
  schema: postSchema,
  adapter: config.adapter,
  permissions: {
    read: undefined, // Public
    create: ['user', 'admin'],
    update: (context) => {
      // Users can update their own posts
      return (
        context.body.authorId === context.user?.id ||
        context.user?.role === 'admin'
      );
    },
    delete: (context) => {
      return (
        context.body.authorId === context.user?.id ||
        context.user?.role === 'admin'
      );
    },
  },
  middleware: [
    // Add authorId from authenticated user
    async (context, next) => {
      if (context.method === 'POST' && context.user) {
        context.body = {
          ...context.body,
          authorId: context.user.id,
        };
      }
      return await next();
    },
  ],
});

app.all('/api/posts/:id?', async (req: Request, res: Response) => {
  const context = buildContextFromExpress(req);
  const response = await postHandler(context);
  res.status(response.status).json(response.body);
});

/**
 * File Upload Route
 */
app.post('/api/upload', authMiddleware, async (req: Request, res: Response) => {
  try {
    // Simplified upload - use multer in production
    // const upload = multer({ dest: process.env.UPLOAD_DIR });

    res.status(501).json({
      error: {
        message: 'Upload endpoint not implemented yet',
        code: 'NOT_IMPLEMENTED',
      },
    });
  } catch (error) {
    res.status(500).json({
      error: {
        message: 'Upload failed',
        code: 'INTERNAL_ERROR',
      },
    });
  }
});

/**
 * Error Handling Middleware
 */
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('Error:', err);

  res.status(500).json({
    error: {
      message: NODE_ENV === 'production' ? 'Internal server error' : err.message,
      code: 'INTERNAL_ERROR',
      ...(NODE_ENV === 'development' && { stack: err.stack }),
    },
  });
});

/**
 * 404 Handler
 */
app.use((req: Request, res: Response) => {
  res.status(404).json({
    error: {
      message: 'Endpoint not found',
      code: 'NOT_FOUND',
      path: req.path,
    },
  });
});

/**
 * Start Server
 */
async function startServer(): Promise<void> {
  try {
    // Connect to database
    await config.adapter.connect();
    console.log('✓ Database connected');

    // Initialize plugins
    for (const plugin of config.plugins) {
      const result = await plugin.init({
        adapter: config.adapter,
        schemas: config.schemas,
        config,
      });

      if (!result.success) {
        throw new Error(`Failed to initialize plugin: ${plugin.name}`);
      }
    }
    console.log('✓ Plugins initialized');

    // Start server
    app.listen(PORT, () => {
      console.log(`
🚀 Server running on http://localhost:${PORT}
📝 Environment: ${NODE_ENV}
🗄️  Database: Connected
🔐 Auth: Enabled
      `);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

/**
 * Graceful Shutdown
 */
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');

  // Disconnect from database
  await config.adapter.disconnect();

  // Destroy plugins
  for (const plugin of config.plugins) {
    await plugin.destroy();
  }

  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully...');

  await config.adapter.disconnect();

  for (const plugin of config.plugins) {
    await plugin.destroy();
  }

  process.exit(0);
});

/**
 * Helper Functions
 */

async function generateJWT(payload: {
  userId: string;
  email: string;
  role: string;
}): Promise<string> {
  // Simplified JWT generation
  // In production, use auth plugin or jose library

  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);

  const jwtPayload = {
    ...payload,
    iat: now,
    exp: now + 7 * 24 * 60 * 60, // 7 days
    iss: 'forja-express-api',
  };

  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(jwtPayload)).toString('base64url');

  const crypto = await import('crypto');
  const signature = crypto
    .createHmac('sha256', process.env.JWT_SECRET!)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64url');

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

async function verifyJWT(token: string): Promise<{
  id: string;
  email: string;
  role: string;
}> {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid token format');
  }

  const [encodedHeader, encodedPayload, signature] = parts;

  // Verify signature
  const crypto = await import('crypto');
  const expectedSignature = crypto
    .createHmac('sha256', process.env.JWT_SECRET!)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64url');

  if (signature !== expectedSignature) {
    throw new Error('Invalid signature');
  }

  // Decode payload
  const payload = JSON.parse(
    Buffer.from(encodedPayload!, 'base64url').toString('utf-8')
  );

  // Check expiration
  if (payload.exp < Date.now() / 1000) {
    throw new Error('Token expired');
  }

  return {
    id: payload.userId,
    email: payload.email,
    role: payload.role,
  };
}

async function verifyPassword(
  password: string,
  hashedPassword: string
): Promise<boolean> {
  const crypto = await import('crypto');
  const util = await import('util');
  const pbkdf2 = util.promisify(crypto.pbkdf2);

  const [salt, storedHash] = hashedPassword.split(':');

  if (!salt || !storedHash) {
    return false;
  }

  const hash = await pbkdf2(password, salt, 100000, 64, 'sha512');

  return hash.toString('hex') === storedHash;
}

/**
 * Type Augmentation for Express Request
 */
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        role: string;
      };
    }
  }
}

/**
 * Start the server
 */
startServer();

/**
 * Export app for testing
 */
export default app;
