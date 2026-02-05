import { defineConfig } from "tsup";

export default defineConfig({
	entry: [
		"src/adapter.ts",
		"src/plugin.ts",
		"src/core/schema.ts",
		"src/core/validator.ts",
		"src/core/query-builder.ts",
		"src/core/migration.ts",
		"src/api/handler.ts",
		"src/api/parser.ts",
		"src/api/serializer.ts",
		"src/utils.ts",
		"src/cli.ts",
	],
	format: ["cjs", "esm"],
	dts: true,
	splitting: false,
	sourcemap: true,
	clean: true,
});
