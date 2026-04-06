import type { Db, Document } from "mongodb";
import type { ImportReader } from "@datrix/core";
import type { SchemaDefinition } from "@datrix/core";
import type { MongoDBAdapter } from "../adapter";
import { COUNTER_KEY_PREFIX } from "../types";
import { DATRIX_META_MODEL } from "@datrix/core";

const CHUNK_SIZE = 1000;

export class MongoDBImporter {
	constructor(
		private db: Db,
		private adapter: MongoDBAdapter,
	) { }

	async import(reader: ImportReader): Promise<void> {
		const schemas = await this.collectSchemas(reader);

		// 1. Drop all existing collections
		const existingTables = await this.adapter.getTables();
		for (const tableName of existingTables) {
			await this.adapter.dropTable(tableName, undefined, { isImport: true });
		}

		// 2. Create collections — isImport skips upsertSchemaMeta so the importer
		//    can restore _datrix data as-is.
		for (const schema of schemas.values()) {
			await this.adapter.createTable(schema, undefined, { isImport: true });
		}

		// 3. Insert data chunk by chunk
		const tables = await reader.getTables();
		for (const tableName of tables) {
			for await (const chunk of reader.readChunks(tableName)) {
				await this.insertChunk(tableName, chunk);
			}
		}

		// 4. Reset counters for all collections
		for (const tableName of tables) {
			if (tableName !== DATRIX_META_MODEL) {
				await this.resetCounter(tableName);
			}
		}
	}

	private async collectSchemas(
		reader: ImportReader,
	): Promise<Map<string, SchemaDefinition>> {
		const schemas = new Map<string, SchemaDefinition>();
		for await (const schema of reader.readSchemas()) {
			schemas.set(schema.tableName!, schema);
		}
		return schemas;
	}

	private async insertChunk(
		tableName: string,
		rows: Record<string, unknown>[],
	): Promise<void> {
		if (rows.length === 0) return;

		const collection = this.db.collection(tableName);

		for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
			const batch = rows.slice(i, i + CHUNK_SIZE) as Document[];
			await collection.insertMany(batch);
		}
	}

	private async resetCounter(tableName: string): Promise<void> {
		const metaCollection = this.db.collection(DATRIX_META_MODEL);
		const collection = this.db.collection(tableName);

		const lastDoc = await collection
			.find({}, { projection: { id: 1, _id: 0 } })
			.sort({ id: -1 })
			.limit(1)
			.toArray();

		const maxId = (lastDoc[0]?.["id"] as number | undefined) ?? 0;
		const counterKey = `${COUNTER_KEY_PREFIX}${tableName}`;

		await metaCollection.updateOne(
			{ key: counterKey },
			{ $set: { value: maxId } },
			{ upsert: true },
		);
	}
}
