/**
 * Media Schema Factory
 */

import { defineSchema } from "@datrix/core";
import type { SchemaPermission, SchemaDefinition } from "@datrix/core";

export function createMediaSchema(
	modelName: string,
	permission?: SchemaPermission,
): SchemaDefinition {
	// Media rows must only be written through the upload pipeline — direct
	// CRUD create/update is denied unless the user explicitly overrides it.
	// The upload handler writes via datrix.raw.*, which bypasses this layer.
	const effectivePermission: SchemaPermission = {
		create: false,
		update: false,
		...permission,
	};

	return defineSchema({
		name: modelName,
		fields: {
			filename: { type: "string", required: true },
			originalName: { type: "string", required: true },
			mimeType: { type: "string", required: true },
			size: { type: "number", required: true, integer: true },
			key: { type: "string", required: true },
			variants: { type: "json" },
		},
		permission: effectivePermission,
	});
}
