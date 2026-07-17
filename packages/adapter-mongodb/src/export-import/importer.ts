import type { Db, Document } from "mongodb";
import type { ImportReader } from "@datrix/core";
import type { SchemaDefinition } from "@datrix/core";
import type { MongoDBAdapter } from "../adapter";
import { COUNTER_KEY_PREFIX } from "../types";
import { DATRIX_META_MODEL } from "@datrix/core";
import { getManagedCollections } from "../helpers";

const CHUNK_SIZE = 1000;

/**
 * Prefix for staging collections used during import. All archive data lands
 * in `_import_tmp_<name>` collections first; only after every collection
 * imported successfully are they renamed into place.
 */
const IMPORT_TMP_PREFIX = "_import_tmp_";

export class MongoDBImporter {
	constructor(
		private db: Db,
		private adapter: MongoDBAdapter,
	) {}

	/**
	 * Import strategy (safe for shared databases):
	 *
	 * 1. Stage: create `_import_tmp_*` collections and load ALL archive data
	 *    into them. A failure here drops the temps and leaves existing data
	 *    completely untouched.
	 * 2. Swap: rename each temp into place with `dropTarget: true` (atomic per
	 *    collection; the small window between renames is accepted — see README).
	 * 3. Cleanup: drop datrix-managed collections that are not part of the
	 *    archive. Collections without a `_datrix` schema entry belong to the
	 *    host application and are never touched.
	 * 4. Reset auto-increment counters from the imported data.
	 */
	async import(reader: ImportReader): Promise<void> {
		const schemas = await this.collectSchemas(reader);
		const archiveTables = await reader.getTables();

		// Snapshot the managed set BEFORE the swap replaces `_datrix`.
		const managedBefore = new Set<string>([
			DATRIX_META_MODEL,
			...(await getManagedCollections(this.db)),
		]);

		// Every collection the archive will materialize (schema-only tables may
		// have no chunks; chunk-only tables may have no schema).
		const importTables = new Set<string>(archiveTables);
		for (const tableName of schemas.keys()) {
			importTables.add(tableName);
		}

		// Remove stale temps from a previously crashed import.
		await this.dropTempCollections();

		// Phase 1: stage into temp collections.
		try {
			for (const schema of schemas.values()) {
				const tmpSchema: SchemaDefinition = {
					...schema,
					tableName: this.tmpName(schema.tableName!),
				};
				await this.adapter.createTable(tmpSchema, undefined, {
					isImport: true,
				});
			}

			// Tables that came without a schema still need their temp collection
			// so the swap phase can rename them unconditionally.
			for (const tableName of importTables) {
				if (!schemas.has(tableName)) {
					await this.db.createCollection(this.tmpName(tableName));
				}
			}

			for (const tableName of archiveTables) {
				for await (const chunk of reader.readChunks(tableName)) {
					await this.insertChunk(this.tmpName(tableName), chunk);
				}
			}
		} catch (error) {
			await this.dropTempCollections();
			throw error;
		}

		// Phase 2: swap temps into place. rename is atomic per collection;
		// dropTarget replaces an existing collection in the same step.
		for (const tableName of importTables) {
			await this.db
				.collection(this.tmpName(tableName))
				.rename(tableName, { dropTarget: true });
		}

		// Phase 3: drop managed collections that the archive does not contain.
		for (const tableName of managedBefore) {
			if (!importTables.has(tableName)) {
				try {
					await this.db.collection(tableName).drop();
				} catch {
					// Best-effort: the collection may already be gone.
				}
			}
		}

		// Phase 4: reset counters from the imported data.
		for (const tableName of importTables) {
			if (tableName !== DATRIX_META_MODEL) {
				await this.resetCounter(tableName);
			}
		}
	}

	private tmpName(tableName: string): string {
		return `${IMPORT_TMP_PREFIX}${tableName}`;
	}

	private async dropTempCollections(): Promise<void> {
		const collections = await this.db
			.listCollections({ name: { $regex: `^${IMPORT_TMP_PREFIX}` } })
			.toArray();
		for (const info of collections) {
			try {
				await this.db.collection(info.name).drop();
			} catch {
				// Best-effort cleanup: never mask the original import error.
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
