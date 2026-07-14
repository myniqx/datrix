/**
 * Offline `generate types` Tests (issue 5.1)
 *
 * Type generation must work without a reachable database:
 * - defineConfig's factory forwards DatrixInitOptions
 * - { skipConnection: true } initializes the registry without connecting
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { defineConfig, defineSchema } from "@datrix/core";
import type { DatabaseAdapter } from "@datrix/core";
import { generateCommand } from "../src/commands/generate";

const userSchema = defineSchema({
	name: "user",
	fields: {
		name: { type: "string", required: true },
		settings: { type: "json" },
	},
} as const);

function fakeAdapter(connect: ReturnType<typeof vi.fn>): DatabaseAdapter {
	return {
		name: "fake",
		config: {},
		connect,
		disconnect: vi.fn().mockResolvedValue(undefined),
		executeQuery: vi.fn(),
		exportData: vi.fn(),
		importData: vi.fn(),
	} as unknown as DatabaseAdapter;
}

function unreachableAdapter(): {
	adapter: DatabaseAdapter;
	connect: ReturnType<typeof vi.fn>;
} {
	const connect = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
	return { adapter: fakeAdapter(connect), connect };
}

let outputDir: string;

beforeEach(async () => {
	outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "datrix-offline-"));
});

afterEach(async () => {
	await fs.rm(outputDir, { recursive: true, force: true });
});

describe("5.1 — generate types without a database connection", () => {
	it("skipConnection initializes without calling adapter.connect", async () => {
		const { adapter, connect } = unreachableAdapter();
		const factory = defineConfig(() => ({
			adapter,
			schemas: [userSchema],
		}));

		const datrix = await factory({ skipConnection: true });

		expect(connect).not.toHaveBeenCalled();
		expect(datrix.getAllSchemas().length).toBeGreaterThan(0);
	});

	it("generates the types file end-to-end with an unreachable DB", async () => {
		const { adapter } = unreachableAdapter();
		const factory = defineConfig(() => ({
			adapter,
			schemas: [userSchema],
		}));

		const datrix = await factory({ skipConnection: true });
		const outputPath = path.join(outputDir, "generated.ts");

		await generateCommand("types", "", { output: outputPath }, datrix);

		const content = await fs.readFile(outputPath, "utf-8");
		expect(content).toContain("export interface UserBase");
		expect(content).toContain("settings?: JsonValue;");
	});

	it("still connects when no init options are given", async () => {
		const connect = vi.fn().mockResolvedValue(undefined);
		const adapter = fakeAdapter(connect);

		const factory = defineConfig(() => ({
			adapter,
			schemas: [userSchema],
		}));

		await factory();

		expect(connect).toHaveBeenCalledOnce();
	});
});
