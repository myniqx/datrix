/**
 * Ledger — shared progress-ledger implementation for file export/import.
 *
 * File format, one entry per line:
 *   <id_or_variant_id> <key> <status>     — full entry (key may contain spaces)
 *   <id_or_variant_id> <status>           — journal line (status update)
 *
 * Entries are held in a Map loaded once; status updates are appended as
 * journal lines instead of rewriting the whole file (O(n) instead of O(n²)).
 * Readers apply journal lines over base entries in file order.
 *
 * Parsing is token-based: id = first token, status = last token, key = the
 * middle tokens re-joined — keys containing spaces survive the round-trip.
 */

import fs from "node:fs/promises";

export interface LedgerRecord<S extends string> {
	readonly id: string;
	readonly key: string;
	readonly status: S;
}

export class Ledger<S extends string> {
	private readonly filePath: string;
	private readonly validStatuses: ReadonlySet<string>;
	private cache: Map<string, LedgerRecord<S>> | null = null;

	constructor(filePath: string, validStatuses: readonly S[]) {
		this.filePath = filePath;
		this.validStatuses = new Set(validStatuses);
	}

	private isValidStatus(status: string): status is S {
		return this.validStatuses.has(status);
	}

	private async load(): Promise<Map<string, LedgerRecord<S>>> {
		if (this.cache) return this.cache;

		const map = new Map<string, LedgerRecord<S>>();

		let content: string;
		try {
			content = await fs.readFile(this.filePath, "utf-8");
		} catch {
			this.cache = map;
			return map;
		}

		for (const rawLine of content.split("\n")) {
			const line = rawLine.trim();
			if (line === "") continue;

			const tokens = line.split(" ");

			if (tokens.length === 2) {
				// Journal line: <id> <status>
				const [id, status] = tokens as [string, string];
				const existing = map.get(id);
				if (existing && this.isValidStatus(status)) {
					map.set(id, { ...existing, status });
				}
				continue;
			}

			if (tokens.length >= 3) {
				const id = tokens[0]!;
				const status = tokens[tokens.length - 1]!;
				const key = tokens.slice(1, -1).join(" ");
				if (!id || !key || !this.isValidStatus(status)) continue;
				map.set(id, { id, key, status });
			}
		}

		this.cache = map;
		return map;
	}

	async read(): Promise<LedgerRecord<S>[]> {
		return [...(await this.load()).values()];
	}

	async has(id: string): Promise<boolean> {
		return (await this.load()).has(id);
	}

	/**
	 * Append new entries. Ids already present (in the file or the same batch)
	 * are skipped, preserving resume semantics.
	 */
	async append(records: readonly LedgerRecord<S>[]): Promise<void> {
		if (records.length === 0) return;

		const map = await this.load();
		const lines: string[] = [];

		for (const record of records) {
			if (map.has(record.id)) continue;
			map.set(record.id, record);
			lines.push(`${record.id} ${record.key} ${record.status}`);
		}

		if (lines.length > 0) {
			await fs.appendFile(this.filePath, lines.join("\n") + "\n", "utf-8");
		}
	}

	/**
	 * Update an entry's status by appending a journal line.
	 * Unknown ids are ignored.
	 */
	async markStatus(id: string, status: S): Promise<void> {
		const map = await this.load();
		const existing = map.get(id);
		if (!existing) return;

		map.set(id, { ...existing, status });
		await fs.appendFile(this.filePath, `${id} ${status}\n`, "utf-8");
	}

	async exists(): Promise<boolean> {
		try {
			await fs.access(this.filePath);
			return true;
		} catch {
			return false;
		}
	}
}
