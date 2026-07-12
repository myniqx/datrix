import { throwLockTimeout } from "@datrix/core";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

interface LockContent {
	token: string;
	pid: number;
	timestamp: number;
}

export class SimpleLock {
	private lockPath: string;
	private lockTimeout: number; // How long to wait to acquire lock
	private staleTimeout: number; // How long a lock is valid
	private token: string | null = null;
	private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

	constructor(
		root: string,
		lockTimeout: number = 5000,
		staleTimeout: number = 30000,
	) {
		this.lockPath = path.join(root, "db.lock");
		this.lockTimeout = lockTimeout;
		this.staleTimeout = staleTimeout;
	}

	async acquire(): Promise<void> {
		const start = Date.now();
		const token = crypto.randomUUID();

		while (true) {
			try {
				// Try to create the lock file (fails if exists)
				// "wx" flag: Open file for writing. The file is created (if it does not exist) or fails (if it exists).
				const content: LockContent = {
					token,
					pid: process.pid,
					timestamp: Date.now(),
				};
				await fs.writeFile(this.lockPath, JSON.stringify(content), {
					flag: "wx",
				});
				this.token = token;
				this.startHeartbeat();
				return; // Acquired!
			} catch (error: any) {
				if (error.code !== "EEXIST") {
					throw error; // Unexpected error
				}

				// Lock exists. Check if stale.
				const isStale = await this.checkStale();
				if (isStale) {
					try {
						await fs.unlink(this.lockPath);
						continue; // Retry immediately
					} catch (unlinkError) {
						// Could happen if another process released it just now.
						// Just continue loop to try acquiring again.
					}
				}

				// Check timeout
				if (Date.now() - start > this.lockTimeout) {
					throwLockTimeout({ adapter: "json", lockTimeout: this.lockTimeout });
				}

				// Wait a bit before retrying
				await new Promise((resolve) => setTimeout(resolve, 10)); // 10ms poll
			}
		}
	}

	async release(): Promise<void> {
		this.stopHeartbeat();

		const myToken = this.token;
		this.token = null;

		if (!myToken) return;

		try {
			const current = await this.readLockContent();
			// Only unlink if we still own the lock — otherwise another process
			// acquired it after ours was considered stale, and deleting it here
			// would steal that process's lock out from under it.
			if (current?.token === myToken) {
				await fs.unlink(this.lockPath);
			}
		} catch (error: any) {
			// Ignore if file doesn't exist (maybe already released or stolen)
			if (error.code !== "ENOENT") {
				// warning?
			}
		}
	}

	/**
	 * Refresh the lock's timestamp periodically while held, so a legitimately
	 * long-running transaction is never mistaken for a stale/crashed holder.
	 */
	private startHeartbeat(): void {
		const myToken = this.token;
		const interval = Math.max(1000, Math.floor(this.staleTimeout / 3));

		this.heartbeatTimer = setInterval(() => {
			void this.refreshLock(myToken);
		}, interval);
		this.heartbeatTimer.unref?.();
	}

	private stopHeartbeat(): void {
		if (this.heartbeatTimer) {
			clearInterval(this.heartbeatTimer);
			this.heartbeatTimer = null;
		}
	}

	private async refreshLock(myToken: string | null): Promise<void> {
		if (!myToken || this.token !== myToken) return;

		try {
			const current = await this.readLockContent();
			if (current?.token !== myToken) return; // no longer ours — stop touching it

			const content: LockContent = {
				token: myToken,
				pid: process.pid,
				timestamp: Date.now(),
			};
			await fs.writeFile(this.lockPath, JSON.stringify(content));
		} catch {
			// Best-effort — if the file is gone or unreadable, the next
			// acquire/release cycle will sort out ownership.
		}
	}

	private async readLockContent(): Promise<LockContent | null> {
		try {
			const raw = await fs.readFile(this.lockPath, "utf-8");
			return JSON.parse(raw) as LockContent;
		} catch {
			return null;
		}
	}

	private async checkStale(): Promise<boolean> {
		const content = await this.readLockContent();
		if (!content || typeof content.timestamp !== "number") return true; // corrupt lock

		const age = Date.now() - content.timestamp;
		return age > this.staleTimeout;
	}
}
