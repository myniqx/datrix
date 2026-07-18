/**
 * Generate Schema --force Tests (issue 1.6)
 *
 * The "Use --force to overwrite" error message must be backed by a real
 * --force option that reaches writeFileSafe.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { generateCommand } from "../src/commands/generate";
import { CLIError } from "../src/types";

let outputDir: string;

beforeEach(async () => {
	outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "datrix-generate-"));
});

afterEach(async () => {
	await fs.rm(outputDir, { recursive: true, force: true });
});

async function schemaFiles(): Promise<string[]> {
	return (await fs.readdir(outputDir)).filter((f) => f.endsWith(".schema.ts"));
}

describe("generate schema --force", () => {
	it("creates the schema file on first run", async () => {
		await generateCommand("schema", "TestModel", { output: outputDir });

		const files = await schemaFiles();
		expect(files).toHaveLength(1);
	});

	it("refuses to overwrite without --force", async () => {
		await generateCommand("schema", "TestModel", { output: outputDir });

		await expect(
			generateCommand("schema", "TestModel", { output: outputDir }),
		).rejects.toThrow(CLIError);
		await expect(
			generateCommand("schema", "TestModel", { output: outputDir }),
		).rejects.toThrow(/--force/);
	});

	it("overwrites with --force", async () => {
		await generateCommand("schema", "TestModel", { output: outputDir });

		const [file] = await schemaFiles();
		const filePath = path.join(outputDir, file!);
		await fs.writeFile(filePath, "// stale content", "utf-8");

		await generateCommand("schema", "TestModel", {
			output: outputDir,
			force: true,
		});

		const content = await fs.readFile(filePath, "utf-8");
		expect(content).not.toBe("// stale content");
		expect(content).toContain("defineSchema");
	});
});
