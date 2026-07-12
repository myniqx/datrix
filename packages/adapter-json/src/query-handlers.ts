import { DatrixEntry } from "@datrix/core";
import {
	QueryCountObject,
	QueryInsertObject,
	QueryObject,
	QuerySelectObject,
	QueryUpdateObject,
} from "@datrix/core";
import { JsonQueryRunner } from "./runner";
import { JsonPopulator } from "./populate";
import {
	applyDefaultValues,
	applyOnDeleteActions,
	applySelectRecursive,
	checkForeignKeyConstraints,
	checkUniqueConstraints,
	createPendingUniqueValues,
	defaultSelectFromSchema,
	hydrateDatesFromStorage,
	normalizeDatesForStorage,
} from "./table-utils";
import type { JsonAdapter } from "./adapter";
import type { ExecuteQueryOptions } from "./types";
import { throwQueryMissingData, throwQueryError } from "@datrix/core";

function assertNoGroupByOrHaving(query: {
	groupBy?: readonly string[] | undefined;
	having?: unknown;
}): void {
	if (query.groupBy || query.having) {
		throwQueryError({
			adapter: "json",
			message: "groupBy/having are not supported by JsonAdapter",
		});
	}
}

export type QueryHandlerResult<T extends DatrixEntry> = {
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

export async function handleSelect<T extends DatrixEntry>(ctx: {
	runner: JsonQueryRunner;
	query: QuerySelectObject<T>;
	adapter: JsonAdapter;
}): Promise<QueryHandlerResult<T>> {
	const { runner, query, adapter } = ctx;

	assertNoGroupByOrHaving(query);

	let rows: T[];

	if (query.populate) {
		const filtered = await runner.filterAndSort(query);
		// Copy-at-boundary: populate() writes relation fields ONTO the rows it's
		// given. Without this copy those writes land on the cache's own row
		// objects, and the next write on this table would persist populated
		// data to disk (see issue.md Part 2). Hydrate dates back to `Date`
		// objects at the same boundary (storage is ISO strings, see Part 1).
		rows = filtered.map((r) => hydrateDatesFromStorage(runner.tableSchema, { ...r }));
		const populator = new JsonPopulator(adapter);
		rows = await populator.populate(rows, query);
		// select: undefined means "all non-hidden scalar columns" (core issue 2.2,
		// post-write refetch) — don't fall through to "keep every field".
		const effectiveSelect = query.select ?? defaultSelectFromSchema(runner.tableSchema);
		rows = applySelectRecursive<T>(rows, effectiveSelect, query.populate) as T[];
	} else {
		rows = (await runner.run(query)) as T[];
		// run() only copies rows when it actually projects/dedupes (`select` or
		// `distinct` present); a bare select with neither still returns
		// cache-owned row references — copy so callers can't mutate the cache.
		if (!query.select && !query.distinct) {
			rows = rows.map((r) => ({ ...r })) as T[];
		}
		rows = rows.map((r) => hydrateDatesFromStorage(runner.tableSchema, r)) as T[];
	}

	return {
		rows,
		metadata: { rowCount: rows.length, affectedRows: 0 },
		shouldWrite: false,
	};
}

export async function handleCount<T extends DatrixEntry>(ctx: {
	runner: JsonQueryRunner;
	query: QueryCountObject<T>;
}): Promise<QueryHandlerResult<T>> {
	const { runner, query } = ctx;

	assertNoGroupByOrHaving(query);

	const rows = (await runner.run(query)) as T[];

	return {
		rows: [] as T[],
		metadata: { rowCount: 0, affectedRows: 0, count: rows.length },
		shouldWrite: false,
		earlyReturn: true,
	};
}

export async function handleInsert<T extends DatrixEntry>(ctx: {
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
	const pendingUnique = createPendingUniqueValues();

	for (const item of query.data) {
		const newItem = { ...item };

		if (isJunctionTable) {
			// Upsert semantics: a duplicate junction row (e.g. re-linking a
			// relation that's already connected) doesn't insert a new row, but
			// still contributes an id — otherwise `insertedIds` comes back
			// shorter than `query.data` and breaks core's positional
			// query.data[i] <-> rows[i] id mapping (see issue.md Part 8).
			const existingRow = tableData.data.find((row) =>
				Object.keys(newItem).every(
					(key) => key === "id" || row[key] === newItem[key],
				),
			);
			if (existingRow) {
				insertedIds.push(existingRow["id"] as number);
				continue;
			}
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
		normalizeDatesForStorage(tableSchema, newItem);
		await checkForeignKeyConstraints(tableSchema, newItem, adapter);
		checkUniqueConstraints(
			tableData,
			tableSchema,
			newItem,
			undefined,
			pendingUnique,
		);
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

export async function handleUpdate<T extends DatrixEntry>(ctx: {
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

	const updateData: Record<string, unknown> = { ...query.data };
	normalizeDatesForStorage(tableSchema, updateData);

	const pendingUnique = createPendingUniqueValues();
	for (const row of rowsToUpdate) {
		const updatedData = { ...row, ...updateData };
		await checkForeignKeyConstraints(tableSchema, updatedData, adapter);
		checkUniqueConstraints(
			tableData,
			tableSchema,
			updatedData,
			row["id"] as number,
			pendingUnique,
		);
	}

	for (const row of rowsToUpdate) {
		Object.assign(row, updateData);
	}

	const updatedIds = rowsToUpdate.map((r) => r["id"] as number);
	const rows = updatedIds.map((id) => ({ id })) as T[];

	return {
		rows,
		metadata: { rowCount: updatedIds.length, affectedRows: updatedIds.length },
		shouldWrite: true,
	};
}

export async function handleDelete<T extends DatrixEntry>(ctx: {
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
