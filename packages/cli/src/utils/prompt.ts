/**
 * Shared interactive prompt helpers
 *
 * Single readline-based implementation used by all commands.
 */

import * as readline from "readline";

/**
 * Whether stdin can be prompted interactively
 */
export function isInteractive(): boolean {
	return process.stdin.isTTY === true;
}

/**
 * Ask a free-form question; resolves with the trimmed answer.
 */
export async function ask(question: string): Promise<string> {
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	return new Promise((resolve) => {
		rl.question(question, (answer) => {
			rl.close();
			resolve(answer.trim());
		});
	});
}

/**
 * Ask a yes/no question. Empty answer resolves to defaultYes.
 * On non-TTY stdin resolves to defaultYes immediately instead of hanging.
 */
export async function confirm(
	question: string,
	defaultYes: boolean = false,
): Promise<boolean> {
	if (!isInteractive()) {
		return defaultYes;
	}

	const answer = await ask(question);

	if (answer === "") {
		return defaultYes;
	}

	return answer.toLowerCase() === "y";
}
