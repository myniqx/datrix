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
			"@datrix/core": path.resolve(
				__dirname,
				"./packages/core/src/types/utils/index.ts",
			),
			"@datrix/core": path.resolve(
				__dirname,
				"./packages/core/src/types/core/index.ts",
			),
			"@datrix/core": path.resolve(__dirname, "./packages/core/src"),
			"@datrix/adapter-postgres": path.resolve(
				__dirname,
				"./packages/adapter-postgres/src",
			),
			"@datrix/adapter-mysql": path.resolve(
				__dirname,
				"./packages/adapter-mysql/src",
			),
			"@datrix/api": path.resolve(__dirname, "./packages/api/src"),
			"@datrix/api-upload": path.resolve(__dirname, "./packages/api-upload/src"),
		},
	},
});
