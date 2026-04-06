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
		include: ["tests/**/*.test.ts", "packages/**/tests/**/*.test.ts"],
		exclude: ["node_modules/", "dist/", "examples/"],
		pool: "forks",
		/*
    poolOptions: {
      forks: {
        singleFork: true, // Tek process, sıralı
      }
    } */
	},
	resolve: {
		alias: {
			// Monorepo package aliases
			"@forja/core": path.resolve(__dirname, "./packages/core/src"),
			"@forja/core/plugin/plugin": path.resolve(
				__dirname,
				"./packages/core/src/plugin/plugin.ts",
			),
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
