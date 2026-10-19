import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SimpleLock } from "../src/lock";

async function runExclusive(
	locks: SimpleLock[],
	rounds: number,
): Promise<number> {
	let holders = 0;
	let maxHolders = 0;

	await Promise.all(
		Array.from({ length: rounds }, async (_, i) => {
			const lock = locks[i % locks.length]!;
			await lock.acquire();
			holders++;
			maxHolders = Math.max(maxHolders, holders);
			await new Promise((resolve) => setTimeout(resolve, 2));
			holders--;
			await lock.release();
		}),
	);

	return maxHolders;
}

describe("SimpleLock", () => {
	let root: string;
	let lockPath: string;

	beforeEach(async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), "datrix-lock-"));
		lockPath = path.join(root, "db.lock");
	});

	afterEach(async () => {
		await fs.rm(root, { recursive: true, force: true });
	});

	it("gives the lock to one acquirer at a time within an instance", async () => {
		const lock = new SimpleLock(root, 5000, 30000);

		expect(await runExclusive([lock], 30)).toBe(1);
		await expect(fs.access(lockPath)).rejects.toThrow();
	});

	it("gives the lock to one acquirer at a time across instances", async () => {
		const locks = [
			new SimpleLock(root, 5000, 30000),
			new SimpleLock(root, 5000, 30000),
			new SimpleLock(root, 5000, 30000),
		];

		expect(await runExclusive(locks, 30)).toBe(1);
	});

	it("does not break a fresh empty lock file", async () => {
		await fs.writeFile(lockPath, "");
		const lock = new SimpleLock(root, 200, 30000);

		await expect(lock.acquire()).rejects.toThrow(/lock/i);
		expect(await fs.readFile(lockPath, "utf-8")).toBe("");
	});

	it("breaks an unreadable lock file once it is older than staleTimeout", async () => {
		await fs.writeFile(lockPath, "garbage");
		const past = new Date(Date.now() - 10_000);
		await fs.utimes(lockPath, past, past);
		const lock = new SimpleLock(root, 1000, 500);

		await lock.acquire();
		await lock.release();
	});

	it("lets the next acquirer in after a queued acquire times out", async () => {
		const holder = new SimpleLock(root, 100, 30000);
		await holder.acquire();

		await expect(holder.acquire()).rejects.toThrow(/lock/i);

		await holder.release();
		await holder.acquire();
		await holder.release();
	});
});
