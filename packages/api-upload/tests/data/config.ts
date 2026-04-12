/**
 * Upload Test Configuration
 *
 * Wires up Datrix with ApiPlugin (upload enabled) backed by LocalStorageProvider.
 * Uses adapter-json for fast, dependency-free test runs.
 */

import path from "node:path";
import { defineConfig } from "@datrix/core";
import { ApiPlugin } from "@datrix/api";
import { Upload, LocalStorageProvider } from "@datrix/api-upload";
import { JsonAdapter } from "../../../adapter-json/src/index";
import type { DatrixConfig } from "@datrix/core";

/** Resolution names used across upload tests */
export type TestResolutions = "thumbnail" | "small" | "medium";

/**
 * Build a test Datrix instance with upload configured.
 *
 * @param tmpDir   - Base directory for both DB files and uploaded files
 * @param options  - Override defaults for specific test scenarios
 */
export async function createUploadTestConfig(
	tmpDir: string,
	options: {
		maxSize?: number;
		allowedMimeTypes?: readonly string[];
		format?: "webp" | "jpeg" | "png" | "avif";
		withResolutions?: boolean;
	} = {},
) {
	const uploadDir = path.join(tmpDir, "uploads");

	const provider = new LocalStorageProvider({
		basePath: uploadDir,
		baseUrl: "http://localhost:3000/uploads",
		ensureDirectory: true,
	});

	const resolutions = options.withResolutions
		? ({
				thumbnail: { width: 150, height: 150, fit: "cover" as const },
				small: { width: 320 },
				medium: { width: 640 },
			} satisfies Record<
				TestResolutions,
				{ width: number; height?: number; fit?: "cover" }
			>)
		: undefined;

	const upload = new Upload({
		provider,
		permission: { create: true, read: true, update: true, delete: true },
		maxSize: options.maxSize ?? 1 * 1024 * 1024, // default 1MB
		allowedMimeTypes: options.allowedMimeTypes ?? ["image/*"],
		...(options.format !== undefined && { format: options.format }),
		...(resolutions !== undefined && { resolutions }),
	});

	const adapter = new JsonAdapter({
		root: path.join(tmpDir, "db"),
		cache: true,
		readLock: false,
		lockTimeout: 5000,
		staleTimeout: 10000,
	});

	return defineConfig(() => {
		const config: DatrixConfig = {
			adapter: adapter as unknown as DatrixConfig["adapter"],
			schemas: [],
			plugins: [
				new ApiPlugin({
					enabled: true,
					prefix: "/api",
					defaultPageSize: 25,
					maxPageSize: 100,
					maxPopulateDepth: 3,
					autoRoutes: true,
					excludeSchemas: [],
					upload,
				}),
			],
		};
		return config;
	});
}
