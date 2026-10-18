/**
 * Execution Sessions
 *
 * A session is what the executor runs queries on. `AdapterSession` runs on
 * the adapter and wraps every write in its own transaction. `TransactionSession`
 * runs everything on one caller-owned transaction (`datrix.transaction()`).
 */

import { DatabaseAdapter, QueryRunner, Transaction } from "../types/adapter";
import { AfterCommitCallback } from "../types/core/interfaces";
import { DatrixError } from "../types/errors";

export type AfterCommitErrorReporter = (error: unknown) => Promise<void>;

export interface Session {
	readonly runner: QueryRunner;

	/** Guards a whole CRUD operation (including nested hook operations). */
	run<T>(operation: () => Promise<T>): Promise<T>;

	/** Runs a write unit atomically. */
	write<T>(unit: (runner: QueryRunner) => Promise<T>): Promise<T>;

	/** Called once an operation has succeeded with the callbacks it registered. */
	afterCommit(callbacks: readonly AfterCommitCallback[]): Promise<void>;
}

export async function runAfterCommit(
	callbacks: readonly AfterCommitCallback[],
	report: AfterCommitErrorReporter,
): Promise<void> {
	for (const callback of callbacks) {
		try {
			await callback();
		} catch (error) {
			await report(error);
		}
	}
}

export class AdapterSession implements Session {
	constructor(
		private readonly getAdapter: () => DatabaseAdapter,
		private readonly report: AfterCommitErrorReporter,
	) {}

	get runner(): QueryRunner {
		return this.getAdapter();
	}

	run<T>(operation: () => Promise<T>): Promise<T> {
		return operation();
	}

	async write<T>(unit: (runner: QueryRunner) => Promise<T>): Promise<T> {
		const tx = await this.getAdapter().beginTransaction();
		try {
			const result = await unit(tx);
			await tx.commit();
			return result;
		} catch (error) {
			await tx.rollback();
			throw error;
		}
	}

	afterCommit(callbacks: readonly AfterCommitCallback[]): Promise<void> {
		return runAfterCommit(callbacks, this.report);
	}
}

export class TransactionSession implements Session {
	private state: "active" | "failed" | "closed" = "active";
	private failure: unknown;
	private readonly pending: AfterCommitCallback[] = [];

	constructor(
		private readonly tx: Transaction,
		private readonly report: AfterCommitErrorReporter,
	) {}

	get runner(): QueryRunner {
		return this.tx;
	}

	async run<T>(operation: () => Promise<T>): Promise<T> {
		this.assertActive();
		try {
			return await operation();
		} catch (error) {
			this.fail(error);
			throw error;
		}
	}

	write<T>(unit: (runner: QueryRunner) => Promise<T>): Promise<T> {
		return unit(this.tx);
	}

	async afterCommit(callbacks: readonly AfterCommitCallback[]): Promise<void> {
		for (const callback of callbacks) {
			this.enqueue(callback);
		}
	}

	enqueue(callback: AfterCommitCallback): void {
		this.assertActive();
		this.pending.push(callback);
	}

	/** Marks the transaction as failed; it will roll back even if the error is swallowed. */
	fail(error: unknown): void {
		if (this.state === "active") {
			this.state = "failed";
			this.failure = error;
		}
	}

	/** Rethrows a failure that the transaction callback may have swallowed. */
	throwIfFailed(): void {
		if (this.state === "failed") {
			throw this.failure;
		}
	}

	close(): void {
		this.state = "closed";
	}

	flushAfterCommit(): Promise<void> {
		return runAfterCommit(this.pending.splice(0), this.report);
	}

	private assertActive(): void {
		if (this.state === "failed") {
			throw new DatrixError(
				"Transaction is aborted: a previous operation in this transaction failed",
				{
					code: "TRANSACTION_ABORTED",
					operation: "transaction",
					cause: this.failure instanceof Error ? this.failure : undefined,
				},
			);
		}
		if (this.state === "closed") {
			throw new DatrixError("Transaction is already finished", {
				code: "TRANSACTION_CLOSED",
				operation: "transaction",
			});
		}
	}
}
