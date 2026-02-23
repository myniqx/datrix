/**
 * Relation field type generation utilities
 *
 * Generates TypeScript type strings for relation fields,
 * differentiating between read (nested types) and write (RelationXxx<T>) modes.
 */

import type { RelationField, RelationKind } from "forja-types/core/schema";
import { toPascalCase } from "../utils/templates";

/**
 * Generate read-mode type string for a relation field
 * e.g. author?: User  or  posts?: Post[]
 */
export function relationReadType(field: RelationField): string {
	const modelName = toPascalCase(field.model);
	const isMulti = field.kind === "hasMany" || field.kind === "manyToMany";
	return isMulti ? `${modelName}Base[]` : `${modelName}Base`;
}

/**
 * Map relation kind to the write wrapper type name
 */
export function relationWriteWrapper(kind: RelationKind): string {
	switch (kind) {
		case "belongsTo":
			return "RelationBelongsTo";
		case "hasOne":
			return "RelationHasOne";
		case "hasMany":
			return "RelationHasMany";
		case "manyToMany":
			return "RelationManyToMany";
	}
}

/**
 * Generate write-mode type string for a relation field
 * e.g. author?: RelationBelongsTo<User>  or  posts?: RelationHasMany<Post>
 */
export function relationWriteType(field: RelationField): string {
	const modelName = toPascalCase(field.model);
	const wrapper = relationWriteWrapper(field.kind);
	return `${wrapper}<${modelName}Base>`;
}
