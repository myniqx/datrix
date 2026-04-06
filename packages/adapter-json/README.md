# forja-adapter-json

A file-based JSON database adapter for Forja framework. Perfect for development, testing, static sites, and small-scale applications.

## Features

- **File-based storage** - Each table stored as a single JSON file
- **Full CRUD operations** - Create, read, update, delete with type safety
- **Relations support** - belongsTo, hasMany, hasOne, manyToMany with eager loading
- **Query features** - WHERE clauses, SELECT projection, ORDER BY, LIMIT, OFFSET, DISTINCT
- **Schema-based validation** - Automatic validation using Forja schemas
- **Migration support** - Create, alter tables, add indexes
- **Cache mechanism** - mtime-based caching for performance
- **Thread-safe** - File-level locking for concurrent operations
- **Zero dependencies** - Only requires Node.js fs module

## Installation

```bash
# pnpm
pnpm add forja-adapter-json

# yarn
yarn add forja-adapter-json

# npm
npm install forja-adapter-json
```

## Quick Start with Forja

```typescript
import { defineConfig } from "forja-core";
import { JsonAdapter } from "forja-adapter-json";

// Create Forja configuration
const config = defineConfig(() => ({
	adapter: new JsonAdapter({
		root: "./data",
	}),

	schemas: [
		// Your schemas here (see Forja documentation)
	],

	plugins: [
		// Your plugins here
	],
}));
```

## Configuration Options

### `JsonAdapterConfig`

```typescript
interface JsonAdapterConfig {
	/**
	 * Root directory for JSON files (required)
	 * Each table will be stored as {root}/{tableName}.json
	 */
	root: string;

	/**
	 * Lock acquisition timeout in milliseconds (optional)
	 * Default: 5000ms (5 seconds)
	 *
	 * When a write operation is attempted, the adapter will wait this long
	 * for the lock to be acquired before throwing an error.
	 */
	lockTimeout?: number;

	/**
	 * Stale lock timeout in milliseconds (optional)
	 * Default: 30000ms (30 seconds)
	 *
	 * If a lock file is older than this duration, it's considered stale
	 * and will be automatically removed. Prevents deadlocks from crashed processes.
	 */
	staleTimeout?: number;

	/**
	 * Enable in-memory cache (optional)
	 * Default: true
	 *
	 * Caches parsed JSON data in memory with mtime validation.
	 * Cache is invalidated when file modification time changes.
	 * Significantly improves read performance for repeated queries.
	 */
	cache?: boolean;

	/**
	 * Require lock for read operations (optional)
	 * Default: false
	 *
	 * Enable if you need strict read consistency in scenarios with
	 * concurrent writes. Adds overhead but ensures reads don't happen
	 * during writes.
	 */
	readLock?: boolean;
}
```

### Example

```typescript
const adapter = new JsonAdapter({
	root: "./database",
	lockTimeout: 10000, // Wait 10s for locks
	staleTimeout: 60000, // Consider locks stale after 1min
	cache: true, // Enable caching (default)
	readLock: false, // Don't lock on reads (default)
});
```

## Use Cases

### ✅ Good For

- **Development & Testing** - Fast setup, easy inspection, no external dependencies
- **Static Site Generation** - Build-time data fetching, no runtime database needed
- **Prototyping** - Quick POC without database setup
- **Small Applications** - <10k records per table, low concurrent writes
- **Content Management** - Blog posts, static content with relations
- **Dev Environment** - Local development with production-like data structure

### ❌ Not Suitable For

- **Production Applications** - High traffic, concurrent writes
- **Large Datasets** - >10k records per table (performance degrades)
- **Real-time Applications** - File I/O overhead too high
- **High Concurrency** - File-level locking limits throughput
- **Transactional Workloads** - Limited transaction support

## Performance Characteristics

- **Read Operations** - Fast with caching (~1-5ms for cached, ~10-50ms for uncached)
- **Write Operations** - Slower due to full file rewrite (~50-200ms depending on file size)
- **Populate Operations** - Efficient with cache, multiple file reads needed
- **Concurrent Writes** - Serialized with file locking, not suitable for high concurrency
- **Memory Usage** - Entire table loaded in memory during operations
- **File Size Impact** - Linear degradation (1k records ≈ 100KB, 10k records ≈ 1MB)

## File Structure

```
data/
├── users.json           # User table
├── posts.json           # Post table
├── categories.json      # Category table
└── post_categories.json # Junction table (manyToMany)
```

Each file contains:

```json
{
	"meta": {
		"version": 1,
		"name": "users",
		"lastInsertId": 3,
		"updatedAt": "2026-01-27T10:30:00.000Z"
	},
	"data": [
		{ "id": 1, "name": "Alice", "email": "alice@example.com" },
		{ "id": 2, "name": "Bob", "email": "bob@example.com" }
	]
}
```

## Standalone Usage

For using JsonAdapter without Forja framework, see the comprehensive guide:

Check **[HOW_TO_USE.md](./HOW_TO_USE.md)**

Covers:

- Manual setup and schema definition
- Direct CRUD operations
- Complex queries and filters
- Best practices and naming conventions

## Relations & Populate

JsonAdapter supports all Forja relation types:

| Type           | Description  | FK Location    | Result                |
| -------------- | ------------ | -------------- | --------------------- |
| **belongsTo**  | Many-to-one  | Source table   | Single object or null |
| **hasMany**    | One-to-many  | Target table   | Array (can be empty)  |
| **hasOne**     | One-to-one   | Target table   | Single object or null |
| **manyToMany** | Many-to-many | Junction table | Array (can be empty)  |

### Populate Syntax

```typescript
// Simple - all fields
populate: { author: "*" }

// With field selection
populate: {
  author: {
    select: ["name", "email"]
  }
}

// Nested populate
populate: {
  author: {
    populate: {
      profile: "*"
    }
  }
}

// Multiple relations
populate: {
  author: "*",
  comments: { select: ["text"] },
  tags: "*"
}
```

**Note:** Populate is handled by Forja core. See Forja documentation for query API details.

## Error Handling

Operations throw `ForjaAdapterError` on failure:

```typescript
import { ForjaAdapterError } from "@forja/core/types/errors";

try {
	const result = await adapter.executeQuery({
		type: "select",
		table: "users",
	});
	console.log(result.rows);
} catch (error) {
	if (error instanceof ForjaAdapterError) {
		console.error(error.code); // "ADAPTER_QUERY_ERROR"
		console.error(error.message); // Detailed message
	}
}
```

## License

MIT © Forja Contributors

## Links

- [Forja Documentation](https://tryforja.com) - Configuration, schemas, migrations
- [How to Use Guide](./HOW_TO_USE.md) - Standalone usage without Forja
- [GitHub Repository](https://github.com/myniqx/forja)
