/**
 * Argument Parser Tests (issues 1.1, 1.2, 1.3, 1.4, 3.11)
 *
 * Regression tests for the CLI argument parser:
 * - scoped --agree values must survive parsing (not coerced to boolean)
 * - boolean flags must never swallow the next positional argument
 * - single-dash options must fail loudly (with -h/-v aliases)
 * - --pack-files values must be validated at parse time
 */

import { describe, it, expect } from "vitest";
import { parseArgs, parseSize } from "../src/utils/args";
import { CLI_VERSION } from "../src/utils/version";
import { CLIError } from "../src/types";
import { hasAgreed } from "../src/commands/import";
import packageJson from "../package.json";

describe("parseArgs — scoped --agree (issue 1.1)", () => {
	it("keeps 'missing-files' as a string value", () => {
		const parsed = parseArgs([
			"import",
			"file.zip",
			"--agree",
			"missing-files",
		]);
		expect(parsed.options["agree"]).toBe("missing-files");
		expect(parsed.args).toEqual(["file.zip"]);
	});

	it("keeps 'drop-db' as a string value", () => {
		const parsed = parseArgs(["import", "file.zip", "--agree", "drop-db"]);
		expect(parsed.options["agree"]).toBe("drop-db");
	});

	it("bare --agree is boolean true", () => {
		const parsed = parseArgs(["import", "file.zip", "--agree"]);
		expect(parsed.options["agree"]).toBe(true);
	});

	it("rejects an invalid explicit value (--agree=bogus)", () => {
		expect(() => parseArgs(["import", "file.zip", "--agree=bogus"])).toThrow(
			CLIError,
		);
		expect(() => parseArgs(["import", "file.zip", "--agree=bogus"])).toThrow(
			/drop-db, missing-files/,
		);
	});

	it("hasAgreed: scoped consent does not cover the other scope", () => {
		expect(hasAgreed("missing-files", "drop-db")).toBe(false);
		expect(hasAgreed("missing-files", "missing-files")).toBe(true);
		expect(hasAgreed("drop-db", "missing-files")).toBe(false);
		expect(hasAgreed("drop-db", "drop-db")).toBe(true);
		expect(hasAgreed(true, "drop-db")).toBe(true);
		expect(hasAgreed(true, "missing-files")).toBe(true);
		expect(hasAgreed(undefined, "drop-db")).toBe(false);
		expect(hasAgreed(false, "drop-db")).toBe(false);
	});
});

describe("parseArgs — boolean flags never consume positionals (issue 1.2)", () => {
	it("--agree before the file path leaves the path positional", () => {
		const parsed = parseArgs(["import", "--agree", "file.zip"]);
		expect(parsed.options["agree"]).toBe(true);
		expect(parsed.args).toEqual(["file.zip"]);
	});

	it("--verbose does not swallow the next token", () => {
		const parsed = parseArgs(["import", "--verbose", "file.zip"]);
		expect(parsed.options["verbose"]).toBe(true);
		expect(parsed.args).toEqual(["file.zip"]);
	});

	it("--with-files / --only-files / --include-files stay boolean", () => {
		const parsed = parseArgs([
			"import",
			"--with-files",
			"./backup",
			"--only-files",
		]);
		expect(parsed.options["with-files"]).toBe(true);
		expect(parsed.options["only-files"]).toBe(true);
		expect(parsed.args).toEqual(["./backup"]);
	});

	it("value-taking options consume their value", () => {
		const parsed = parseArgs([
			"export",
			"--output",
			"backup.zip",
			"--config",
			"./my.config.ts",
			"--resume",
			"./dir",
		]);
		expect(parsed.options["output"]).toBe("backup.zip");
		expect(parsed.options["config"]).toBe("./my.config.ts");
		expect(parsed.options["resume"]).toBe("./dir");
		expect(parsed.args).toEqual([]);
	});

	it("supports --opt=value syntax", () => {
		const parsed = parseArgs(["export", "--output=backup.zip"]);
		expect(parsed.options["output"]).toBe("backup.zip");
	});

	it("rejects a value-taking option without a value", () => {
		expect(() => parseArgs(["export", "--output"])).toThrow(
			/--output requires a value/,
		);
		expect(() => parseArgs(["export", "--output", "--verbose"])).toThrow(
			/--output requires a value/,
		);
	});

	it("rejects =value on a boolean option", () => {
		expect(() => parseArgs(["export", "--verbose=yes"])).toThrow(
			/--verbose does not take a value/,
		);
	});

	it("--pack-files consumes only size-shaped tokens", () => {
		const withSize = parseArgs(["export", "--pack-files", "500mb"]);
		expect(withSize.options["pack-files"]).toBe("500mb");

		const withoutSize = parseArgs(["export", "--pack-files", "somefile"]);
		expect(withoutSize.options["pack-files"]).toBe(true);
		expect(withoutSize.args).toEqual(["somefile"]);
	});
});

describe("parseArgs — single-dash options (issue 1.3)", () => {
	it("rejects unknown single-dash options", () => {
		expect(() => parseArgs(["migrate", "-config"])).toThrow(
			/Unknown option: -config/,
		);
		expect(() => parseArgs(["migrate", "-config"])).toThrow(/--config/);
	});

	it("aliases -h to help and -v to version", () => {
		expect(parseArgs(["migrate", "-h"]).options["help"]).toBe(true);
		expect(parseArgs(["-v"]).options["version"]).toBe(true);
	});
});

describe("CLI version (issue 1.4)", () => {
	it("exposes the package.json version", () => {
		expect(CLI_VERSION).toBe(packageJson.version);
		expect(CLI_VERSION).toMatch(/^\d+\.\d+\.\d+/);
	});
});

describe("parseSize — --pack-files validation (issue 3.11)", () => {
	it("parses plain bytes and kb/mb/gb suffixes", () => {
		expect(parseSize("512")).toBe(512);
		expect(parseSize("2kb")).toBe(2048);
		expect(parseSize("500mb")).toBe(500 * 1024 * 1024);
		expect(parseSize("1GB")).toBe(1024 * 1024 * 1024);
	});

	it("rejects invalid values instead of producing NaN", () => {
		expect(() => parseSize("abc")).toThrow(CLIError);
		expect(() => parseSize("-5")).toThrow(CLIError);
		expect(() => parseSize("0")).toThrow(/greater than zero/);
	});

	it("rejects invalid --pack-files= values at parse time", () => {
		expect(() => parseArgs(["export", "--pack-files=abc"])).toThrow(CLIError);
	});
});
