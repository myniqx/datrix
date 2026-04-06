export const FORJA_VERSION = "v0.1";
export const FORJA_GITHUB_REPO = "myniqx/datrix";
export const FORJA_GITHUB_URL = `https://github.com/${FORJA_GITHUB_REPO}`;
export const FORJA_NPM_INSTALL = "npm install @datrix/core";

export const FORJA_PACKAGES = [
	{
		name: "@datrix/core",
		description:
			"Schema engine, query executor, migration system, and plugin runtime.",
		npm: "https://www.npmjs.com/package/@datrix/core",
	},
	{
		name: "@datrix/adapter-postgres",
		description:
			"PostgreSQL adapter with full query translation and relation support.",
		npm: "https://www.npmjs.com/package/@datrix/adapter-postgres",
	},
	{
		name: "@datrix/adapter-mysql",
		description: "MySQL and MariaDB adapter.",
		npm: "https://www.npmjs.com/package/@datrix/adapter-mysql",
	},
	{
		name: "@datrix/adapter-mongodb",
		description:
			"MongoDB adapter with full CRUD, relation population, and migration support.",
		npm: "https://www.npmjs.com/package/@datrix/adapter-mongodb",
	},
	{
		name: "@datrix/adapter-json",
		description: "JSON file-based adapter for local development and testing.",
		npm: "https://www.npmjs.com/package/@datrix/adapter-json",
	},
	{
		name: "@datrix/api",
		description:
			"HTTP layer with REST endpoints, JWT/session auth, and query parsing.",
		npm: "https://www.npmjs.com/package/@datrix/api",
	},
	{
		name: "@datrix/cli",
		description:
			"CLI for migrations, type generation, and resource scaffolding.",
		npm: "https://www.npmjs.com/package/@datrix/cli",
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
