import { ForjaEntry } from "@forja/core";
import {
	QueryCountObject,
	QueryInsertObject,
	QueryObject,
	QuerySelectObject,
	QueryUpdateObject,
} from "@forja/core";
import { JsonQueryRunner } from "./runner";
import { JsonPopulator } from "./populate";
import {
	applyDefaultValues,
	applyOnDeleteActions,
	applySelectRecursive,
	checkForeignKeyConstraints,
	checkUniqueConstraints,
} from "./table-utils";
import type { JsonAdapter } from "./adapter";
import type { ExecuteQueryOptions } from "./types";
import { throwQueryMissingData } from "@forja/core";

export type QueryHandlerResult<T extends ForjaEntry> = {
	rows: T[];
	metadata: {
		rowCount: number;
		affectedRows: number;
		insertIds?: number[];
		count?: number;
	};
	shouldWrite: boolean;
	earlyReturn?: boolean;
};

export async function handleSelect<T extends ForjaEntry>(ctx: {
	runner: JsonQueryRunner;
	query: QuerySelectObject<T>;
	adapter: JsonAdapter;
}): Promise<QueryHandlerResult<T>> {
	const { runner, query, adapter } = ctx;

	let rows: T[];

	if (query.populate) {
		rows = await runner.filterAndSort(query);
		const populator = new JsonPopulator(adapter);
		rows = await populator.populate(rows, query);
		rows = applySelectRecursive<T>(rows, query.select, query.populate) as T[];
	} else {
		rows = (await runner.run(query)) as T[];
	}

	return {
		rows,
		metadata: { rowCount: rows.length, affectedRows: 0 },
		shouldWrite: false,
	};
}

export async function handleCount<T extends ForjaEntry>(ctx: {
	runner: JsonQueryRunner;
	query: QueryCountObject<T>;
}): Promise<QueryHandlerResult<T>> {
	const { runner, query } = ctx;
	const rows = (await runner.run(query)) as T[];

	return {
		rows: [] as T[],
		metadata: { rowCount: 0, affectedRows: 0, count: rows.length },
		shouldWrite: false,
		earlyReturn: true,
	};
}

export async function handleInsert<T extends ForjaEntry>(ctx: {
	runner: JsonQueryRunner;
	query: QueryInsertObject<T>;
}): Promise<QueryHandlerResult<T>> {
	const { runner, query } = ctx;
	const tableData = runner.tableData;
	const tableSchema = runner.tableSchema;
	const adapter = runner.adapterRef;

	if (!query.data || !Array.isArray(query.data)) {
		throwQueryMissingData({
			queryType: "insert",
			table: query.table,
			adapter: "json",
		});
	}

	const insertedIds: number[] = [];
	const isJunctionTable =
		(tableSchema as unknown as { _isJunctionTable?: boolean })
			?._isJunctionTable === true;

	for (const item of query.data) {
		const newItem = { ...item };

		if (isJunctionTable) {
			const alreadyExists = tableData.data.some((row) =>
				Object.keys(newItem).every(
					(key) => key === "id" || row[key] === newItem[key],
				),
			);
			if (alreadyExists) continue;
		}

		if (!newItem["id"]) {
			tableData.meta.lastInsertId = (tableData.meta.lastInsertId ?? 0) + 1;
			newItem["id"] = tableData.meta.lastInsertId;
		} else {
			const manualId = Number(newItem["id"]);
			if (!isNaN(manualId) && manualId > (tableData.meta.lastInsertId ?? 0)) {
				tableData.meta.lastInsertId = manualId;
			}
		}

		applyDefaultValues(tableSchema, newItem);
		await checkForeignKeyConstraints(tableSchema, newItem, adapter);
		checkUniqueConstraints(tableData, tableSchema, newItem);
		tableData.data.push(newItem);
		insertedIds.push(newItem["id"] as number);
	}

	const rows = insertedIds.map((id) => ({ id })) as T[];

	return {
		rows,
		metadata: {
			rowCount: insertedIds.length,
			affectedRows: insertedIds.length,
			insertIds: insertedIds,
		},
		shouldWrite: true,
	};
}

export async function handleUpdate<T extends ForjaEntry>(ctx: {
	runner: JsonQueryRunner;
	query: QueryUpdateObject<T>;
}): Promise<QueryHandlerResult<T>> {
	const { runner, query } = ctx;
	const tableData = runner.tableData;
	const tableSchema = runner.tableSchema;
	const adapter = runner.adapterRef;

	if (!query.data) {
		throwQueryMissingData({
			queryType: "update",
			table: query.table,
			adapter: "json",
		});
	}

	const updateQuery: QuerySelectObject<T> = {
		...(query as unknown as QuerySelectObject<T>),
		limit: undefined,
		offset: undefined,
		orderBy: undefined,
	};
	const rowsToUpdate = await runner.filterAndSort(updateQuery);

	for (const row of rowsToUpdate) {
		const updatedData = { ...row, ...query.data };
		await checkForeignKeyConstraints(tableSchema, updatedData, adapter);
		checkUniqueConstraints(
			tableData,
			tableSchema,
			updatedData,
			row["id"] as number,
		);
	}

	for (const row of rowsToUpdate) {
		Object.assign(row, query.data);
	}

	const updatedIds = rowsToUpdate.map((r) => r["id"] as number);
	const rows = updatedIds.map((id) => ({ id })) as T[];

	return {
		rows,
		metadata: { rowCount: updatedIds.length, affectedRows: updatedIds.length },
		shouldWrite: true,
	};
}

export async function handleDelete<T extends ForjaEntry>(ctx: {
	runner: JsonQueryRunner;
	query: QueryObject<T>;
	adapter: JsonAdapter;
	queryOptions?: ExecuteQueryOptions;
}): Promise<QueryHandlerResult<T>> {
	const { runner, query, adapter, queryOptions } = ctx;
	const tableData = runner.tableData;

	const deleteQuery: QuerySelectObject<T> = {
		...(query as unknown as QuerySelectObject<T>),
		limit: undefined,
		offset: undefined,
		orderBy: undefined,
	};
	const rowsToDelete = await runner.filterAndSort(deleteQuery);
	const idsToDelete = rowsToDelete.map((r) => r.id as number);

	// Apply ON DELETE actions (restrict/setNull/cascade) before deleting
	// Pass queryOptions to avoid re-acquiring the already-held lock
	await applyOnDeleteActions(query.table, idsToDelete, adapter, queryOptions);

	const idsSet = new Set(idsToDelete);
	const originalLength = tableData.data.length;
	tableData.data = tableData.data.filter((d) => !idsSet.has(d["id"] as number));

	const deletedIds = rowsToDelete.map((r) => r["id"] as number);
	const rows = deletedIds.map((id) => ({ id })) as T[];

	return {
		rows,
		metadata: {
			rowCount: deletedIds.length,
			affectedRows: originalLength - tableData.data.length,
		},
		shouldWrite: true,
	};
}
