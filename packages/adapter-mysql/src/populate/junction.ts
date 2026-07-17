/**
 * Junction-table FK resolution
 *
 * Resolves junction FK column names from the junction schema the registry
 * created, instead of recomputing `${model}Id` string templates. This is
 * what makes self-referential manyToMany populate work: its junction FKs
 * are `source${Model}Id` / `target${Model}Id` and cannot be derived from
 * the model name alone. For self-relations the source field is always
 * registered first, so insertion order disambiguates the two.
 *
 * Falls back to the `${model}Id` convention for custom `through` tables
 * that have no registered schema.
 */

import type { ISchemaRegistry, SchemaDefinition } from "@datrix/core";

export function resolveJunctionForeignKeys(
	junctionTable: string,
	sourceModel: string,
	targetModel: string,
	schemaRegistry: ISchemaRegistry,
): { sourceFK: string; targetFK: string } {
	let junctionSchema: SchemaDefinition | undefined =
		schemaRegistry.get(junctionTable);
	if (!junctionSchema) {
		const modelName = schemaRegistry.findModelByTableName(junctionTable);
		if (modelName) {
			junctionSchema = schemaRegistry.get(modelName);
		}
	}

	if (junctionSchema) {
		const belongsToFields: {
			model: string;
			foreignKey?: string | undefined;
		}[] = [];
		for (const field of Object.values(junctionSchema.fields)) {
			if (field.type === "relation" && field.kind === "belongsTo") {
				belongsToFields.push(field);
			}
		}

		const source =
			sourceModel === targetModel
				? belongsToFields[0]
				: belongsToFields.find((f) => f.model === sourceModel);
		const target =
			sourceModel === targetModel
				? belongsToFields[1]
				: belongsToFields.find((f) => f.model === targetModel);

		if (source?.foreignKey && target?.foreignKey) {
			return { sourceFK: source.foreignKey, targetFK: target.foreignKey };
		}
	}

	return { sourceFK: `${sourceModel}Id`, targetFK: `${targetModel}Id` };
}
