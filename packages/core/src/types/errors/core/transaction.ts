import { DatrixError } from "../datrix-error";

export class DatrixTransactionRollbackError extends DatrixError {
	constructor() {
		super("Transaction was rolled back", {
			code: "TRANSACTION_ROLLBACK",
			operation: "transaction",
		});
	}
}
