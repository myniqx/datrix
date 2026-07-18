import type { Db } from "mongodb";
import type { ExportWriter } from "@datrix/core";
import { DATRIX_META_MODEL } from "@datrix/core";
import type { MongoDBAdapter } from "../adapter";
import { getManagedCollections } from "../helpers";

const CHUNK_SIZE = 1000;

export class MongoDBExporter {
	constructor(
		private db: Db,
		private adapter: MongoDBAdapter,
	) {}

	async export(writer: ExportWriter): Promise<void> {
		await writer.writeMeta({
			version: 1,
			exportedAt: new Date().toISOString(),
		});

		// Only datrix-managed collections are exported. datrix may share the
		// database with a host application — foreign collections are none of
		// our business (and may not even have an `id` to paginate on).
		const tables = new Set<string>([
			DATRIX_META_MODEL,
			...(await getManagedCollections(this.db)),
		]);

		for (const tableName of tables) {
			const schema = await this.adapter.getTableSchema(tableName);
			if (schema) {
				await writer.writeSchema(schema);
			}
		}

		for (const tableName of tables) {
			await this.exportCollection(tableName, writer);
		}

		await writer.finalize();
	}

	private async exportCollection(
		tableName: string,
		writer: ExportWriter,
	): Promise<void> {
		const collection = this.db.collection(tableName);

		// Single sorted cursor with a chunk accumulator — skip/limit pagination
		// is O(n²) and unstable under concurrent writes. `_datrix` docs have no
		// `id`, so they sort by their unique `key` instead.
		const sortField = tableName === DATRIX_META_MODEL ? "key" : "id";
		const cursor = collection
			.find({}, { projection: { _id: 0 } })
			.sort({ [sortField]: 1 });

		let chunk: Record<string, unknown>[] = [];
		for await (const doc of cursor) {
			chunk.push(doc as Record<string, unknown>);
			if (chunk.length >= CHUNK_SIZE) {
				await writer.writeChunk(tableName, chunk);
				chunk = [];
			}
		}
		if (chunk.length > 0) {
			await writer.writeChunk(tableName, chunk);
		}
	}
}
