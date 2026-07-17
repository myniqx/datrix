/**
 * Local file naming for exported media files.
 *
 * Storage keys may contain path separators (a/1.jpg, b/1.jpg); storing them
 * under path.basename(key) makes different keys collide. keyToFileName maps
 * every unsafe character to "__" so distinct keys get distinct file names.
 */

import path from "node:path";
import fsSync from "node:fs";

export function keyToFileName(key: string): string {
	return key.replace(/[\\/:*?"<>|]/g, "__");
}

/**
 * Resolve the local file for a storage key. Old exports stored files under
 * path.basename(key) — fall back to it for backward compatibility.
 * Returns null when neither exists.
 */
export function findLocalFile(filesDir: string, key: string): string | null {
	const sanitized = path.join(filesDir, keyToFileName(key));
	if (fsSync.existsSync(sanitized)) return sanitized;

	const legacy = path.join(filesDir, path.basename(key));
	if (fsSync.existsSync(legacy)) return legacy;

	return null;
}
