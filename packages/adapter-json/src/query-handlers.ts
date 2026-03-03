import { ForjaEntry } from "forja-types/core/schema";
import { QueryObject, QuerySelectObject } from "forja-types/core/query-builder";
import { JsonQueryRunner } from "./runner";
import { JsonPopulator } from "./populate";
import {
	applyDefaultValues,
	applySelectRecursive,
	checkForeignKeyConstraints,
	checkUniqueConstraints,
} from "./table-utils";
import { throwQueryMissingData } from "./error-helper";
import type { JsonAdapter } from "./adapter";

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
	query: QuerySelectObject<T>;
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
	query: QueryObject<T>;
}): Promise<QueryHandlerResult<T>> {
	const { runner, query } = ctx;
	const tableData = runner.tableData;
	const tableSchema = runner.tableSchema;
	const adapter = runner.adapterRef;

	if (!query.data || !Array.isArray(query.data)) {
		throwQueryMissingData("insert", query.table);
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
	query: QueryObject<T>;
}): Promise<QueryHandlerResult<T>> {
	const { runner, query } = ctx;
	const tableData = runner.tableData;
	const tableSchema = runner.tableSchema;
	const adapter = runner.adapterRef;

	if (!query.data) {
		throwQueryMissingData("update", query.table);
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
}): Promise<QueryHandlerResult<T>> {
	const { runner, query } = ctx;
	const tableData = runner.tableData;

	const deleteQuery: QuerySelectObject<T> = {
		...(query as unknown as QuerySelectObject<T>),
		limit: undefined,
		offset: undefined,
		orderBy: undefined,
	};
	const rowsToDelete = await runner.filterAndSort(deleteQuery);
	const idsToDelete = new Set(rowsToDelete.map((r) => r.id));

	const originalLength = tableData.data.length;
	tableData.data = tableData.data.filter(
		(d) => !idsToDelete.has(d["id"] as number),
	);

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
