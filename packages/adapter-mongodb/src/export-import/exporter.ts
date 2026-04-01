import type { Db } from "mongodb";
import type { ExportWriter } from "@forja/types/adapter";
import type { MongoDBAdapter } from "../adapter";

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

		const tables = await this.adapter.getTables();

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
		let skip = 0;

		while (true) {
			const docs = await collection
				.find({}, { projection: { _id: 0 } })
				.sort({ id: 1 })
				.skip(skip)
				.limit(CHUNK_SIZE)
				.toArray();

			if (docs.length === 0) {
				break;
			}

			await writer.writeChunk(tableName, docs as Record<string, unknown>[]);
			skip += docs.length;

			if (docs.length < CHUNK_SIZE) {
				break;
			}
		}
	}
}
