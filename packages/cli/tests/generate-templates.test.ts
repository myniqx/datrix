/**
 * Generator & Template Tests (issues 4.1–4.6)
 *
 * - 4.1 datrix generate config works for all adapters incl. mongodb
 * - 4.2 schema template keeps word boundaries (userProfile, not userprofile)
 * - 4.3 toPascalCase does not mangle camelCase input
 * - 4.4 dangling relation targets are stubbed so output compiles
 * - 4.5 json fields use a JsonValue union (objects, arrays, primitives)
 * - 4.6 enum values are escaped in generated types
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { SchemaDefinition } from "@datrix/core";
import {
	schemaTemplate,
	configTemplate,
	toPascalCase,
	toCamelCase,
	CONFIG_DB_TYPES,
} from "../src/utils/templates";
import { generateCommand } from "../src/commands/generate";
import { generateTypesFile } from "../src/type-generator/schema-types";
import { logger } from "../src/utils/logger";
import { CLIError } from "../src/types";

let outputDir: string;

beforeEach(async () => {
	outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "datrix-gen-"));
});

afterEach(async () => {
	vi.restoreAllMocks();
	await fs.rm(outputDir, { recursive: true, force: true });
});

describe("4.1 — generate config", () => {
	it("configTemplate produces a valid mongodb adapter block", () => {
		const content = configTemplate("mongodb");
		expect(content).toContain("createMongoDBAdapter");
		expect(content).toContain("@datrix/adapter-mongodb");
		expect(content).toContain("uri:");
		expect(content).not.toContain("undefined");
	});

	it("every supported db type renders an adapter", () => {
		for (const dbType of CONFIG_DB_TYPES) {
			const content = configTemplate(dbType);
			expect(content, dbType).toContain("defineConfig");
			// postgres-core is a bring-your-own-driver adapter: its template
			// legitimately calls `.then(() => undefined)` in the ping stub.
			if (dbType !== "postgres-core") {
				expect(content, dbType).not.toContain("undefined");
			}
		}
	});

	it("writes datrix.config.ts via generateCommand", async () => {
		const outputPath = path.join(outputDir, "datrix.config.ts");
		await generateCommand("config", "postgres", { output: outputPath });

		const content = await fs.readFile(outputPath, "utf-8");
		expect(content).toContain("createPostgresAdapter");
	});

	it("rejects an unknown db type", async () => {
		await expect(
			generateCommand("config", "oracle", { output: outputDir }),
		).rejects.toThrow(CLIError);
		await expect(
			generateCommand("config", "oracle", { output: outputDir }),
		).rejects.toThrow(/postgres, postgres-core, mysql, json, mongodb/);
	});

	it("refuses to overwrite without --force", async () => {
		const outputPath = path.join(outputDir, "datrix.config.ts");
		await generateCommand("config", "json", { output: outputPath });

		await expect(
			generateCommand("config", "json", { output: outputPath }),
		).rejects.toThrow(/--force/);

		await generateCommand("config", "mysql", {
			output: outputPath,
			force: true,
		});
		const content = await fs.readFile(outputPath, "utf-8");
		expect(content).toContain("createMySQLAdapter");
	});
});

describe("4.2 / 4.3 — name casing", () => {
	it("schema template keeps word boundaries", () => {
		const content = schemaTemplate("UserProfile");
		expect(content).toContain("name: 'userProfile'");
		expect(content).toContain("export const userProfileSchema");
		expect(content).not.toContain("userprofile");
	});

	it("toPascalCase preserves camelCase humps", () => {
		expect(toPascalCase("userProfile")).toBe("UserProfile");
		expect(toPascalCase("user_profile")).toBe("UserProfile");
		expect(toPascalCase("user-profile")).toBe("UserProfile");
		expect(toPascalCase("USER")).toBe("USER");
	});

	it("toCamelCase round-trips PascalCase", () => {
		expect(toCamelCase("UserProfile")).toBe("userProfile");
		expect(toCamelCase("user_profile")).toBe("userProfile");
	});
});

describe("4.4 — dangling relation targets", () => {
	it("emits unknown stubs for unregistered relation targets", () => {
		const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});

		const schema = {
			name: "post",
			tableName: "posts",
			fields: {
				title: { type: "string", required: true },
				author: { type: "relation", kind: "belongsTo", model: "ghostUser" },
			},
		} as unknown as SchemaDefinition;

		const output = generateTypesFile([schema]);

		expect(output).toContain(
			"export type GhostUser = unknown; // relation target not registered",
		);
		expect(warnSpy).toHaveBeenCalledOnce();
	});

	it("emits no stubs when all targets are registered", () => {
		const user = {
			name: "user",
			tableName: "users",
			fields: {
				posts: { type: "relation", kind: "hasMany", model: "post" },
			},
		} as unknown as SchemaDefinition;
		const post = {
			name: "post",
			tableName: "posts",
			fields: {
				author: { type: "relation", kind: "belongsTo", model: "user" },
			},
		} as unknown as SchemaDefinition;

		const output = generateTypesFile([user, post]);
		expect(output).not.toContain("relation target not registered");
	});
});

describe("4.5 / 4.6 — scalar field types", () => {
	it("json fields use the JsonValue union declared in the header", () => {
		const schema = {
			name: "doc",
			tableName: "docs",
			fields: {
				metadata: { type: "json" },
			},
		} as unknown as SchemaDefinition;

		const output = generateTypesFile([schema]);
		expect(output).toContain("export type JsonValue =");
		expect(output).toContain("metadata?: JsonValue;");
	});

	it("enum values with quotes/backslashes are escaped", () => {
		const schema = {
			name: "doc",
			tableName: "docs",
			fields: {
				kind: { type: "enum", values: ['say "hi"', "back\\slash"] },
			},
		} as unknown as SchemaDefinition;

		const output = generateTypesFile([schema]);
		expect(output).toContain(String.raw`"say \"hi\"" | "back\\slash"`);
	});
});
