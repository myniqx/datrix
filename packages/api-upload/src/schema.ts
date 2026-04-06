/**
 * Media Schema Factory
 */

import { defineSchema } from "@datrix/core";
import type { SchemaPermission, SchemaDefinition } from "@datrix/core";
import type { UploadOptions } from "./types";

export function createMediaSchema(
	options: UploadOptions,
	permission?: SchemaPermission,
): SchemaDefinition {
	const modelName = options.modelName ?? "media";

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
		...(permission !== undefined && { permission }),
	});
}
