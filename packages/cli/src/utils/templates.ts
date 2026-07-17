/**
 * Code Templates Utility
 *
 * Generates code templates for schemas, migrations, and config files.
 */

/**
 * Generate schema template
 *
 * Note: Datrix automatically adds id, createdAt, updatedAt fields.
 * Do not define them manually in the schema.
 */
export function schemaTemplate(name: string): string {
	// camelCase keeps word boundaries ("UserProfile" → "userProfile");
	// lowercasing would lose them forever (type names, FK names, pluralization)
	const schemaVarName = toCamelCase(name);

	return `import { defineSchema } from '@datrix/core';

export const ${schemaVarName}Schema = defineSchema({
  name: '${schemaVarName}',

  fields: {
    // Add your fields here
    // Note: id, createdAt, updatedAt are automatically added by Datrix

    // String field example:
    // name: {
    //   type: 'string',
    //   required: true,
    //   minLength: 2,
    //   maxLength: 100,
    // },

    // Email field example:
    // email: {
    //   type: 'string',
    //   required: true,
    //   unique: true,
    //   pattern: /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/,
    // },

    // Number field example:
    // age: {
    //   type: 'number',
    //   min: 0,
    //   max: 150,
    // },

    // Boolean field example:
    // isActive: {
    //   type: 'boolean',
    //   default: true,
    // },

    // Enum field example:
    // status: {
    //   type: 'enum',
    //   values: ['draft', 'published', 'archived'] as const,
    //   default: 'draft',
    // },

    // JSON field example:
    // metadata: {
    //   type: 'json',
    // },

    // Relation examples:
    // belongsTo (N:1) - Foreign key is auto-generated as {fieldName}Id
    // author: {
    //   type: 'relation',
    //   kind: 'belongsTo',
    //   model: 'user',
    // },

    // hasMany (1:N) - Inverse of belongsTo
    // posts: {
    //   type: 'relation',
    //   kind: 'hasMany',
    //   model: 'post',
    //   foreignKey: 'authorId',
    // },

    // manyToMany (N:N) - Junction table is auto-created
    // tags: {
    //   type: 'relation',
    //   kind: 'manyToMany',
    //   model: 'tag',
    // },
  },

  indexes: [
    // Add indexes here
    // { fields: ['email'], unique: true },
    // { fields: ['name'] },
  ],

  // permission: Only needed if you are using @datrix/api for HTTP access control.
  // permission: {
  //   create: true,
  //   read: true,
  //   update: true,
  //   delete: true,
  // },
} as const);
`;
}

/**
 * Supported database types for `datrix generate config`
 */
export const CONFIG_DB_TYPES = [
	"postgres",
	"postgres-core",
	"mysql",
	"json",
	"mongodb",
] as const;

export type ConfigDbType = (typeof CONFIG_DB_TYPES)[number];

export function isConfigDbType(value: string): value is ConfigDbType {
	return (CONFIG_DB_TYPES as readonly string[]).includes(value);
}

/**
 * Generate config template
 */
export function configTemplate(dbType: ConfigDbType): string {
	const adapterImport: Record<ConfigDbType, string> = {
		postgres:
			"import { createPostgresAdapter } from '@datrix/adapter-postgres';",
		"postgres-core":
			"import { createPostgresCoreAdapter } from '@datrix/adapter-postgres-core';",
		mysql: "import { createMySQLAdapter } from '@datrix/adapter-mysql';",
		json: "import { JsonAdapter } from '@datrix/adapter-json';",
		mongodb: "import { createMongoDBAdapter } from '@datrix/adapter-mongodb';",
	};

	const connectionConfig: Record<ConfigDbType, string> = {
		postgres: `createPostgresAdapter({
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME ?? 'myapp',
    user: process.env.DB_USER ?? 'postgres',
    password: process.env.DB_PASSWORD ?? 'password',
  })`,
		"postgres-core": `createPostgresCoreAdapter({
    // Bring your own driver (pg, postgres.js, Neon serverless, etc.)
    // implementing PgRunner/PgConnection.
    runner: pgRunner,
    connect: () => pgRunner.connect(),
    ping: () => pgRunner.query('SELECT 1').then(() => undefined),
    end: () => pgRunner.end(),
  })`,
		mysql: `createMySQLAdapter({
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    database: process.env.DB_NAME ?? 'myapp',
    user: process.env.DB_USER ?? 'root',
    password: process.env.DB_PASSWORD ?? 'password',
  })`,
		json: `new JsonAdapter({
    root: './data',
  })`,
		mongodb: `createMongoDBAdapter({
    uri: process.env.MONGODB_URI ?? 'mongodb://localhost:27017',
    database: process.env.DB_NAME ?? 'myapp',
  })`,
	};

	const importLine = adapterImport[dbType];
	const adapterConfig = connectionConfig[dbType];

	return `${importLine}
import { defineConfig } from '@datrix/core';

// Import your schemas here
// import { userSchema } from './schemas/user.schema';

export default defineConfig(() => ({
  adapter: ${adapterConfig},
  schemas: [
    // Add your schemas here
    // userSchema,
  ],
}));
`;
}

/**
 * Convert string to kebab-case
 */
export function toKebabCase(str: string): string {
	return str
		.replace(/([a-z])([A-Z])/g, "$1-$2")
		.replace(/[\s_]+/g, "-")
		.toLowerCase();
}

/**
 * Convert string to PascalCase
 */
export function toPascalCase(str: string): string {
	// Do NOT lowercase the remainder — "userProfile" must become
	// "UserProfile", not "Userprofile"
	return str
		.split(/[\s_-]+/)
		.map((word): string => word.charAt(0).toUpperCase() + word.slice(1))
		.join("");
}

/**
 * Convert string to camelCase
 */
export function toCamelCase(str: string): string {
	const pascal = toPascalCase(str);
	return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}
