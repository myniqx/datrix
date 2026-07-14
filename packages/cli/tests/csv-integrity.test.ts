/**
 * CSV / Zip Data Integrity Tests (issues 2.1–2.7)
 *
 * Regression tests that trigger the original bugs:
 * - 2.1 string fields holding ISO dates must round-trip as strings
 * - 2.2 the literal string "\N" must not decode to null
 * - 2.3 embedded newlines must not tear records apart
 * - 2.4 chunk files missing from the zip must fail loudly
 * - 2.5 header rows must be parsed quote-aware (commas in field names)
 * - 2.6 finalize() must create the output dir and clean the temp dir
 * - 2.7 corrupt numeric cells must throw instead of importing NaN
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import AdmZip from "adm-zip";
import type { SchemaDefinition } from "@datrix/core";
import {
	encodeRow,
	encodeHeader,
	decodeLine,
	parseLine,
	splitRecords,
} from "../src/export-import/csv";
import { ZipExportWriter } from "../src/export-import/zip-writer";
import { ZipImportReader } from "../src/export-import/zip-reader";

const schema = {
	name: "note",
	tableName: "notes",
	fields: {
		id: { type: "number" },
		title: { type: "string" },
		body: { type: "string" },
		score: { type: "number" },
	},
} as unknown as SchemaDefinition;

let workDir: string;

beforeEach(async () => {
	workDir = await fs.mkdtemp(path.join(os.tmpdir(), "datrix-csv-"));
});

afterEach(async () => {
	await fs.rm(workDir, { recursive: true, force: true });
});

async function buildZip(
	rows: Record<string, unknown>[],
	zipName = "export.zip",
): Promise<string> {
	const zipPath = path.join(workDir, zipName);
	const writer = new ZipExportWriter(zipPath);
	await writer.writeMeta({ version: 1, exportedAt: new Date().toISOString() });
	await writer.writeSchema(schema);
	await writer.writeChunk("notes", rows);
	await writer.finalize();
	return zipPath;
}

async function readAllRows(
	zipPath: string,
): Promise<Record<string, unknown>[]> {
	const reader = new ZipImportReader(zipPath);
	const rows: Record<string, unknown>[] = [];
	for await (const chunk of reader.readChunks("notes")) {
		rows.push(...chunk);
	}
	return rows;
}

describe("2.1 — ISO date strings in string fields stay strings", () => {
	it("round-trips an ISO-looking string as a string", () => {
		const headers = ["title"];
		const line = encodeRow(headers, { title: "2024-01-01T10:00:00" });
		const decoded = decodeLine(line, headers, schema);

		expect(decoded["title"]).toBe("2024-01-01T10:00:00");
		expect(decoded["title"]).not.toBeInstanceOf(Date);
	});

	it("still auto-detects dates when there is no schema info", () => {
		const decoded = decodeLine("2024-01-01T10:00:00", ["anything"]);
		expect(decoded["anything"]).toBeInstanceOf(Date);
	});
});

describe('2.2 — literal string "\\N" does not decode to null', () => {
	it("quotes the NULL token when it appears as a string value", () => {
		const headers = ["title"];
		const line = encodeRow(headers, { title: "\\N" });
		expect(line).toBe('"\\N"');

		const decoded = decodeLine(line, headers, schema);
		expect(decoded["title"]).toBe("\\N");
	});

	it("unquoted \\N still decodes to null", () => {
		const decoded = decodeLine("\\N", ["title"], schema);
		expect(decoded["title"]).toBeNull();
	});
});

describe("2.3 — embedded newlines survive record splitting", () => {
	it("splitRecords keeps quoted newlines inside one record", () => {
		const headers = ["id", "body"];
		const content = [
			encodeHeader(headers),
			encodeRow(headers, { id: 1, body: "line1\nline2" }),
			encodeRow(headers, { id: 2, body: "plain" }),
		].join("\n");

		const records = splitRecords(content);
		expect(records).toHaveLength(3);

		const decoded = decodeLine(records[1]!, headers, schema);
		expect(decoded["body"]).toBe("line1\nline2");
	});

	it("full zip round-trip preserves multiline strings and following rows", async () => {
		const rows = [
			{
				id: 1,
				title: "a",
				body: 'multi\nline\r\nvalue, with "quotes"',
				score: 5,
			},
			{ id: 2, title: "b", body: "after multiline", score: 7 },
		];

		const zipPath = await buildZip(rows);
		const imported = await readAllRows(zipPath);

		expect(imported).toHaveLength(2);
		expect(imported[0]!["body"]).toBe('multi\nline\r\nvalue, with "quotes"');
		expect(imported[1]!["body"]).toBe("after multiline");
		expect(imported[1]!["score"]).toBe(7);
	});
});

describe("2.4 — missing chunk file fails loudly", () => {
	it("throws when a chunk listed in metadata.json is absent", async () => {
		// Build a zip whose metadata lists a chunk file that was never added
		const zipPath = path.join(workDir, "truncated.zip");
		const zip = new AdmZip();
		zip.addFile(
			"metadata.json",
			Buffer.from(
				JSON.stringify({
					meta: { version: 1, exportedAt: "" },
					schemas: [schema],
					chunks: { notes: ["notes_0.csv"] },
				}),
			),
		);
		zip.writeZip(zipPath);

		await expect(readAllRows(zipPath)).rejects.toThrow(/Corrupt export/);
		await expect(readAllRows(zipPath)).rejects.toThrow(/notes_0\.csv/);
	});
});

describe("2.5 — header row is parsed quote-aware", () => {
	it("parseLine handles field names containing commas", () => {
		const header = encodeHeader(["weird,name", "plain"]);
		const cells = parseLine(header);

		expect(cells.map((c) => c.value)).toEqual(["weird,name", "plain"]);
	});
});

describe("2.6 — finalize() output dir + temp dir lifecycle", () => {
	it("creates a missing output directory", async () => {
		const nested = path.join(workDir, "does", "not", "exist", "out.zip");
		const writer = new ZipExportWriter(nested);
		await writer.writeMeta({ version: 1, exportedAt: "" });
		await writer.writeSchema(schema);
		await writer.writeChunk("notes", [
			{ id: 1, title: "t", body: "b", score: 0 },
		]);
		await writer.finalize();

		await expect(fs.access(nested)).resolves.toBeUndefined();
	});

	it("leaves no temp directory behind after finalize", async () => {
		await buildZip([{ id: 1, title: "t", body: "b", score: 0 }]);

		const leftovers = (await fs.readdir(workDir)).filter((f) =>
			f.startsWith("temp_"),
		);
		expect(leftovers).toEqual([]);
	});

	it("cleanup() removes the temp directory on demand", async () => {
		const writer = new ZipExportWriter(path.join(workDir, "never.zip"));
		await writer.writeMeta({ version: 1, exportedAt: "" });

		expect(
			(await fs.readdir(workDir)).filter((f) => f.startsWith("temp_")),
		).toHaveLength(1);

		await writer.cleanup();

		expect(
			(await fs.readdir(workDir)).filter((f) => f.startsWith("temp_")),
		).toEqual([]);
	});
});

describe("2.7 — corrupt numeric cells throw", () => {
	it("throws with column context instead of yielding NaN", () => {
		expect(() => decodeLine("not-a-number", ["score"], schema)).toThrow(
			/score/,
		);
		expect(() => decodeLine("not-a-number", ["score"], schema)).toThrow(
			/not-a-number/,
		);
	});

	it("valid numbers still decode", () => {
		const decoded = decodeLine("42", ["score"], schema);
		expect(decoded["score"]).toBe(42);
	});
});
