/**
 * Command-line argument parser
 *
 * Whitelist-based option parsing:
 * - Value-required options (`--config`, `--output`, `--resume`) always consume
 *   the next token, or take `--opt=value` syntax.
 * - Optional-value options (`--agree`, `--pack-files`) consume the next token
 *   only when it matches the option's expected value set/format.
 * - Every other `--option` is a boolean flag and never consumes a token.
 * - Single-dash options are rejected (with `-h`/`-v` aliased to help/version).
 */

import type { ParsedArgs } from "../types";
import { CLIError } from "../types";

/**
 * Options that always take a value
 */
const VALUE_REQUIRED_OPTIONS: ReadonlySet<string> = new Set([
	"config",
	"output",
	"resume",
]);

/**
 * Valid scoped values for --agree
 */
export const AGREE_SCOPES = ["drop-db", "missing-files"] as const;

export type AgreeScope = (typeof AGREE_SCOPES)[number];

function isAgreeScope(value: string): value is AgreeScope {
	return (AGREE_SCOPES as readonly string[]).includes(value);
}

/**
 * Size format for --pack-files: positive integer with optional kb/mb/gb suffix
 */
const SIZE_PATTERN = /^(\d+)(kb|mb|gb)?$/i;

const SIZE_MULTIPLIERS: Record<string, number> = {
	kb: 1024,
	mb: 1024 * 1024,
	gb: 1024 * 1024 * 1024,
};

/**
 * Parse a size string ("500", "500mb", "1gb") into bytes.
 * The value must already match SIZE_PATTERN (parseArgs validates it).
 */
export function parseSize(value: string): number {
	const match = SIZE_PATTERN.exec(value);

	if (!match || match[1] === undefined) {
		throw new CLIError(
			`Invalid size value: '${value}'. Expected a positive integer with optional kb/mb/gb suffix (e.g. 500mb).`,
			"MISSING_ARGUMENT",
		);
	}

	const amount = parseInt(match[1], 10);
	const suffix = match[2]?.toLowerCase();
	const multiplier = suffix ? (SIZE_MULTIPLIERS[suffix] ?? 1) : 1;
	const bytes = amount * multiplier;

	if (bytes <= 0) {
		throw new CLIError(
			`Invalid size value: '${value}'. Size must be greater than zero.`,
			"MISSING_ARGUMENT",
		);
	}

	return bytes;
}

/**
 * Validate an explicit value given to an optional-value option
 * (via `--opt=value`). Throws on invalid values.
 */
function validateOptionalValue(option: string, value: string): void {
	if (option === "agree") {
		if (!isAgreeScope(value)) {
			throw new CLIError(
				`Invalid value for --agree: '${value}'. Valid values: ${AGREE_SCOPES.join(", ")} (or omit the value to agree to all prompts).`,
				"MISSING_ARGUMENT",
			);
		}
		return;
	}

	if (option === "pack-files") {
		// parseSize throws with a descriptive message on invalid format
		parseSize(value);
		return;
	}

	throw new CLIError(
		`Option --${option} does not take a value.`,
		"MISSING_ARGUMENT",
	);
}

/**
 * Check whether a token is a valid inline value for an optional-value option.
 * Only matching tokens are consumed; anything else stays positional.
 */
function matchesOptionalValue(option: string, token: string): boolean {
	if (option === "agree") {
		return isAgreeScope(token);
	}

	if (option === "pack-files") {
		return SIZE_PATTERN.test(token);
	}

	return false;
}

function isOptionalValueOption(option: string): boolean {
	return option === "agree" || option === "pack-files";
}

/**
 * Single-dash aliases
 */
const SHORT_ALIASES: Record<string, string> = {
	"-h": "help",
	"-v": "version",
};

/**
 * Parse command-line arguments.
 *
 * Throws CLIError on malformed input (unknown single-dash options,
 * missing/invalid option values).
 */
export function parseArgs(args: readonly string[]): ParsedArgs {
	const first = args[0];
	const hasCommand = first !== undefined && !first.startsWith("-");
	const command = hasCommand ? first : undefined;
	const subcommand =
		command === "generate" ? (args[1] ?? undefined) : undefined;
	const restArgs: string[] = [];
	const options: Record<string, string | boolean> = {};

	const start = !hasCommand ? 0 : command === "generate" ? 2 : 1;

	for (let i = start; i < args.length; i++) {
		const arg = args[i];

		if (arg === undefined) {
			continue;
		}

		if (arg.startsWith("--")) {
			const body = arg.slice(2);
			const eqIndex = body.indexOf("=");

			if (eqIndex !== -1) {
				// --opt=value syntax
				const option = body.slice(0, eqIndex);
				const value = body.slice(eqIndex + 1);

				if (VALUE_REQUIRED_OPTIONS.has(option)) {
					options[option] = value;
				} else if (isOptionalValueOption(option)) {
					validateOptionalValue(option, value);
					options[option] = value;
				} else {
					throw new CLIError(
						`Option --${option} does not take a value.`,
						"MISSING_ARGUMENT",
					);
				}
				continue;
			}

			const option = body;

			if (VALUE_REQUIRED_OPTIONS.has(option)) {
				const nextArg = args[i + 1];

				if (nextArg === undefined || nextArg.startsWith("-")) {
					throw new CLIError(
						`Option --${option} requires a value.`,
						"MISSING_ARGUMENT",
					);
				}

				options[option] = nextArg;
				i++;
				continue;
			}

			if (isOptionalValueOption(option)) {
				const nextArg = args[i + 1];

				if (nextArg !== undefined && matchesOptionalValue(option, nextArg)) {
					options[option] = nextArg;
					i++;
				} else {
					options[option] = true;
				}
				continue;
			}

			// Everything else is a boolean flag; never consumes the next token
			options[option] = true;
		} else if (arg.startsWith("-") && arg.length > 1) {
			const alias = SHORT_ALIASES[arg];

			if (alias) {
				options[alias] = true;
				continue;
			}

			throw new CLIError(
				`Unknown option: ${arg} (did you mean --${arg.slice(1)}?)`,
				"INVALID_COMMAND",
			);
		} else {
			restArgs.push(arg);
		}
	}

	return {
		command,
		subcommand,
		args: restArgs,
		options,
	};
}
