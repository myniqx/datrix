import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Marks the async call chain as originating from the active JsonTransaction.
 * Only calls made through `JsonTransaction` (executeQuery/createTable/etc.)
 * run inside this context — plain `adapter.executeQuery` calls do not, even
 * while a transaction is in progress, so they never see the transaction's
 * uncommitted cache (dirty reads).
 */
const storage = new AsyncLocalStorage<boolean>();

export function runInTransactionContext<T>(fn: () => T): T {
	return storage.run(true, fn);
}

export function isInTransactionContext(): boolean {
	return storage.getStore() === true;
}
