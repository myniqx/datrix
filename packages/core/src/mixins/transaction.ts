/**
 * Transaction CRUD
 *
 * The `tx` handle passed to `datrix.transaction()` callbacks. Every operation
 * runs on the caller-owned transaction through a TransactionSession.
 */

import { ISchemaRegistry } from "../types/core/schema";
import {
	AfterCommitCallback,
	DatrixTransaction,
} from "../types/core/interfaces";
import { DatrixTransactionRollbackError } from "../types/errors";
import { Dispatcher } from "../dispatcher";
import { TransactionSession } from "../session";
import { CrudOperations } from "./crud";

export class TransactionCrud
	extends CrudOperations
	implements DatrixTransaction
{
	readonly raw: CrudOperations;

	constructor(
		schemas: ISchemaRegistry,
		private readonly session: TransactionSession,
		getDispatcher: () => Dispatcher,
	) {
		super(schemas, session, getDispatcher);
		this.raw = new CrudOperations(schemas, session, null);
	}

	afterCommit(callback: AfterCommitCallback): void {
		this.session.enqueue(callback);
	}

	rollback(): never {
		const error = new DatrixTransactionRollbackError();
		this.session.fail(error);
		throw error;
	}
}
