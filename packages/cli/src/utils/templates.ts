/**
 * Code Templates Utility
 *
 * Generates code templates for schemas, migrations, and config files.
 */

/**
 * Generate schema template
 *
 * Note: Forja automatically adds id, createdAt, updatedAt fields.
 * Do not define them manually in the schema.
 */
export function schemaTemplate(name: string): string {
	const schemaVarName = name.charAt(0).toLowerCase() + name.slice(1);
	const schemaNameLower = name.toLowerCase();

	return `import { defineSchema } from '@forja/types//core/schema';

export const ${schemaVarName}Schema = defineSchema({
  name: '${schemaNameLower}',

  fields: {
    // Add your fields here
    // Note: id, createdAt, updatedAt are automatically added by Forja

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

  // permission: Only needed if you are using @forja/api for HTTP access control.
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
 * Generate config template
 */
export function configTemplate(dbType: "postgres" | "mysql" | "json"): string {
	const adapterImport: Record<string, string> = {
		postgres:
			"import { createPostgresAdapter } from '@forja/adapter-postgres';",
		mysql: "import { createMySqlAdapter } from '@forja/adapter-mysql';",
		json: "import { createJsonAdapter } from '@forja/adapter-json';",
	};

	const connectionConfig: Record<string, string> = {
		postgres: `createPostgresAdapter({
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME ?? 'myapp',
    user: process.env.DB_USER ?? 'postgres',
    password: process.env.DB_PASSWORD ?? 'password',
  })`,
		mysql: `createMySqlAdapter({
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    database: process.env.DB_NAME ?? 'myapp',
    user: process.env.DB_USER ?? 'root',
    password: process.env.DB_PASSWORD ?? 'password',
  })`,
		json: `createJsonAdapter({
    directory: './data',
  })`,
	};

	const importLine = adapterImport[dbType];
	const adapterConfig = connectionConfig[dbType];

	return `${importLine}
import { createForja } from '@forja/core';

// Import your schemas here
// import { userSchema } from './schemas/user.schema';

export default async function createApp() {
  const adapter = ${adapterConfig};

  const forja = await createForja({
    adapter,
    schemas: [
      // Add your schemas here
      // userSchema,
    ],
    migration: {
      tableName: 'forja_migrations',
      autoRun: false,
    },
  });

  return forja;
}
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
	return str
		.split(/[\s_-]+/)
		.map(
			(word): string =>
				word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
		)
		.join("");
}

/**
 * Convert string to camelCase
 */
export function toCamelCase(str: string): string {
	const pascal = toPascalCase(str);
	return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}
