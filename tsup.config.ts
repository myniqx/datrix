import { defineConfig } from "tsup";

export default defineConfig({
	// Multiple entry points for different exports
	entry: {
		index: "src/index.ts",
		"cli/index": "src/cli/index.ts",
		"adapters/index": "src/adapters/index.ts",
		"plugins/index": "src/plugins/index.ts",
	},

	// Output both CommonJS and ESM formats
	format: ["cjs", "esm"],

	// Generate TypeScript declaration files
	dts: true,

	// Don't split chunks (better for library distribution)
	splitting: false,

	// Generate sourcemaps for debugging
	sourcemap: true,

	// Clean output directory before build
	clean: true,

	// Enable tree-shaking
	treeshake: true,

	// Don't minify (library code should be readable)
	minify: false,

	// Target modern Node.js
	target: "es2022",

	// Output directory
	outDir: "dist",

	// Platform is Node.js
	platform: "node",

	// Use shims for CommonJS compatibility
	shims: true,

	// External dependencies (don't bundle these)
	external: ["pg", "mysql2", "mongodb"],
});
