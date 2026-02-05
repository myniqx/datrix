/**
 * Code Templates Utility (~200 LOC)
 *
 * Generates code templates for schemas, migrations, and config files.
 */

/**
 * Generate schema template
 */
export function schemaTemplate(name: string): string {
	const schemaVarName = name.charAt(0).toLowerCase() + name.slice(1);

	return `import { defineSchema } from 'forja';

export const ${schemaVarName}Schema = defineSchema({
  name: '${name}',

  fields: {
    id: {
      type: 'string',
      required: true,
      unique: true,
    },

    // Add your fields here
    // Example string field:
    // name: {
    //   type: 'string',
    //   required: true,
    //   minLength: 2,
    //   maxLength: 50,
    // },

    // Example number field:
    // age: {
    //   type: 'number',
    //   min: 0,
    //   max: 120,
    // },

    // Example email field:
    // email: {
    //   type: 'string',
    //   required: true,
    //   unique: true,
    //   pattern: /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/,
    // },

    // Example enum field:
    // status: {
    //   type: 'enum',
    //   values: ['active', 'inactive', 'pending'] as const,
    //   default: 'pending',
    // },

    // Example relation field:
    // userId: {
    //   type: 'relation',
    //   model: 'User',
    //   kind: 'belongsTo',
    //   foreignKey: 'userId',
    // },

    createdAt: {
      type: 'date',
      autoCreate: true,
    },

    updatedAt: {
      type: 'date',
      autoUpdate: true,
    },
  },

  indexes: [
    // Add indexes here
    // Example:
    // { fields: ['email'], unique: true },
  ],
} as const);

export type ${name} = typeof ${schemaVarName}Schema['__type'];
`;
}

/**
 * Generate migration template
 */
export function migrationTemplate(name: string, timestamp: string): string {
	return `import type { Migration } from '@core/migration/types';

export const migration: Migration = {
  metadata: {
    name: '${name}',
    version: '${timestamp}',
    timestamp: ${Date.now()},
    description: '${name}',
  },

  up: [
    // Add migration operations here
    // Example - Create table:
    // {
    //   type: 'createTable',
    //   schema: {
    //     name: 'users',
    //     fields: {
    //       id: { type: 'string', required: true, unique: true },
    //       email: { type: 'string', required: true, unique: true },
    //       name: { type: 'string', required: true },
    //       createdAt: { type: 'date', autoCreate: true },
    //     },
    //     indexes: [
    //       { fields: ['email'], unique: true },
    //     ],
    //   },
    // },

    // Example - Add column:
    // {
    //   type: 'alterTable',
    //   tableName: 'users',
    //   operations: [
    //     {
    //       type: 'addColumn',
    //       name: 'age',
    //       definition: { type: 'number', min: 0 },
    //     },
    //   ],
    // },

    // Example - Create index:
    // {
    //   type: 'createIndex',
    //   tableName: 'users',
    //   index: { fields: ['email'], unique: true },
    // },
  ],

  down: [
    // Add rollback operations here (reverse of up)
    // Example - Drop table:
    // {
    //   type: 'dropTable',
    //   tableName: 'users',
    // },

    // Example - Remove column:
    // {
    //   type: 'alterTable',
    //   tableName: 'users',
    //   operations: [
    //     {
    //       type: 'dropColumn',
    //       name: 'age',
    //     },
    //   ],
    // },

    // Example - Drop index:
    // {
    //   type: 'dropIndex',
    //   tableName: 'users',
    //   indexName: 'users_email_unique',
    // },
  ],
};
`;
}

/**
 * Generate config template
 */
export function configTemplate(
	dbType: "postgres" | "mysql" | "mongodb",
): string {
	const connectionConfig: Record<string, string> = {
		postgres: `{
      host: 'localhost',
      port: 5432,
      database: 'myapp',
      user: 'postgres',
      password: 'password',
    }`,
		mysql: `{
      host: 'localhost',
      port: 3306,
      database: 'myapp',
      user: 'root',
      password: 'password',
    }`,
		mongodb: `{
      url: 'mongodb://localhost:27017/myapp',
    }`,
	};

	const config = connectionConfig[dbType];

	return `import { defineConfig } from 'forja';

export default defineConfig({
  database: {
    adapter: '${dbType}',
    connection: ${config}
  },

  schemas: {
    path: './schemas/**/*.schema.ts',
  },

  plugins: [
    // Uncomment plugins you want to use:
    // 'auth',
    // 'upload',
    // 'hooks',
    // 'soft-delete',
  ],

  api: {
    prefix: '/api',
    defaultPageSize: 25,
    maxPageSize: 100,
  },

  migration: {
    directory: './migrations',
    auto: false,
  },
});
`;
}

/**
 * Generate timestamp for migration filename
 */
export function generateTimestamp(): string {
	const now = new Date();
	const year = now.getFullYear();
	const month = String(now.getMonth() + 1).padStart(2, "0");
	const day = String(now.getDate()).padStart(2, "0");
	const hours = String(now.getHours()).padStart(2, "0");
	const minutes = String(now.getMinutes()).padStart(2, "0");
	const seconds = String(now.getSeconds()).padStart(2, "0");

	return `${year}${month}${day}${hours}${minutes}${seconds}`;
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
