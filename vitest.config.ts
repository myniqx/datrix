import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		coverage: {
			provider: "v8",
			reporter: ["text", "json", "html", "lcov"],
			exclude: [
				"node_modules/",
				"dist/",
				"tests/",
				"**/*.test.ts",
				"**/*.spec.ts",
				"**/types.ts",
				"examples/",
				"**/*.config.ts",
			],
			thresholds: {
				lines: 80,
				functions: 80,
				branches: 80,
				statements: 80,
			},
		},
		exclude: [
			"packages/**/node_modules/",
			"dist/",
			"examples/",
			"packages/**/adapter-*/*",
		],
		include: [
			"tests/**/*.test.ts",
			"packages/api/tests/**/*.test.ts",
			"packages/api-upload/tests/**/*.test.ts",
			"packages/core/**/*.test.ts",
			"packages/cli/tests/**/*.test.ts",
		],
		pool: "forks",
	},
	resolve: {
		alias: {
			// Monorepo package aliases
			"@forja/core/types/api": path.resolve(
				__dirname,
				"./packages/core/src/types/api/index.ts",
			),
			"@forja/core/types/cli": path.resolve(
				__dirname,
				"./packages/core/src/types/cli/index.ts",
			),
			"@forja/core/types/adapter": path.resolve(
				__dirname,
				"./packages/core/src/types/adapter/index.ts",
			),
			"@forja/core/types/errors": path.resolve(
				__dirname,
				"./packages/core/src/types/errors/index.ts",
			),
			"@forja/core/types/utils": path.resolve(
				__dirname,
				"./packages/core/src/types/utils/index.ts",
			),
			"@forja/core/types": path.resolve(
				__dirname,
				"./packages/core/src/types/core/index.ts",
			),
			"@forja/core/plugin/plugin": path.resolve(
				__dirname,
				"./packages/core/src/plugin/plugin.ts",
			),
			"@forja/core": path.resolve(__dirname, "./packages/core/src"),
			"@forja/adapter-postgres": path.resolve(
				__dirname,
				"./packages/adapter-postgres/src",
			),
			"@forja/adapter-mysql": path.resolve(
				__dirname,
				"./packages/adapter-mysql/src",
			),
			"@forja/api": path.resolve(__dirname, "./packages/api/src"),
			"@forja/api-upload": path.resolve(__dirname, "./packages/api-upload/src"),
		},
	},
});
