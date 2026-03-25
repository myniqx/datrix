export const FORJA_VERSION = "v0.1";
export const FORJA_GITHUB_REPO = "myniqx/forja";
export const FORJA_GITHUB_URL = `https://github.com/${FORJA_GITHUB_REPO}`;
export const FORJA_NPM_INSTALL = "npm install @forja/core @forja/types";

export const FORJA_PACKAGES = [
	{
		name: "@forja/core",
		description:
			"Schema engine, query executor, migration system, and plugin runtime.",
		npm: "https://www.npmjs.com/package/@forja/core",
	},
	{
		name: "@forja/types",
		description:
			"Shared TypeScript types — ForjaEntry, QueryObject, adapters, plugins.",
		npm: "https://www.npmjs.com/package/@forja/types",
	},
	{
		name: "@forja/adapter-postgres",
		description:
			"PostgreSQL adapter with full query translation and relation support.",
		npm: "https://www.npmjs.com/package/@forja/adapter-postgres",
	},
	{
		name: "@forja/adapter-mysql",
		description: "MySQL and MariaDB adapter.",
		npm: "https://www.npmjs.com/package/@forja/adapter-mysql",
	},
	{
		name: "@forja/adapter-mongodb",
		description:
			"MongoDB adapter with full CRUD, relation population, and migration support.",
		npm: "https://www.npmjs.com/package/@forja/adapter-mongodb",
	},
	{
		name: "@forja/adapter-json",
		description: "JSON file-based adapter for local development and testing.",
		npm: "https://www.npmjs.com/package/@forja/adapter-json",
	},
	{
		name: "@forja/api",
		description:
			"HTTP layer with REST endpoints, JWT/session auth, and query parsing.",
		npm: "https://www.npmjs.com/package/@forja/api",
	},
	{
		name: "@forja/cli",
		description:
			"CLI for migrations, type generation, and resource scaffolding.",
		npm: "https://www.npmjs.com/package/@forja/cli",
	},
] as const;

export const FORJA_FRAMEWORKS = [
	{ name: "Next.js", icon: "/icons/nextjs.svg" },
	{ name: "Express", icon: "/icons/express.svg" },
	{ name: "Fastify", icon: "/icons/fastify.svg" },
	{ name: "NestJS", icon: "/icons/nestjs.svg" },
	{ name: "Hono", icon: "/icons/hono.svg" },
	{ name: "Bun", icon: "/icons/bun.svg" },
] as const;
