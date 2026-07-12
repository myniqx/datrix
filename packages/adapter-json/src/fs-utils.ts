import fs from "node:fs/promises";
import crypto from "node:crypto";

/**
 * Write a file atomically: write to a uniquely-named temp file in the same
 * directory, then `fs.rename` over the target. `rename` is atomic on the same
 * volume (including on Windows/NTFS via `MoveFileEx` semantics used by Node),
 * so readers only ever see either the old complete content or the new
 * complete content — never a truncated/torn write, and a crash mid-write
 * leaves the original file untouched.
 */
export async function atomicWriteFile(
	filePath: string,
	content: string,
): Promise<void> {
	const tmpPath = `${filePath}.${crypto.randomUUID()}.tmp`;
	try {
		await fs.writeFile(tmpPath, content, "utf-8");
		await fs.rename(tmpPath, filePath);
	} catch (err) {
		try {
			await fs.unlink(tmpPath);
		} catch {
			// tmp file may not have been created, or rename already moved it
		}
		throw err;
	}
}
