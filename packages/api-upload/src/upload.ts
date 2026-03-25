/**
 * Upload — main class, implements IUpload interface.
 * Pass an instance to ApiPlugin: new ApiPlugin({ upload: new Upload({ ... }) })
 *
 * @template TResolutions - Union of resolution names (e.g. "thumbnail" | "small" | "medium")
 */

import type { Forja } from "forja-core";
import type { IUpload } from "forja-types/api";
import type { SchemaDefinition } from "forja-types/core/schema";
import { createMediaSchema } from "./schema";
import { handleUploadRequest } from "./handler";
import type { UploadOptions } from "./types";

export class Upload<TResolutions extends string = string> implements IUpload {
	private readonly options: UploadOptions<TResolutions>;

	constructor(options: UploadOptions<TResolutions>) {
		this.options = options;
	}

	getModelName(): string {
		return this.options.modelName ?? "media";
	}

	getSchemas(): SchemaDefinition[] {
		const mediaSchema = createMediaSchema(
			this.options,
			this.options.permission,
		);
		return [mediaSchema];
	}

	async handleRequest(request: Request, forja: Forja): Promise<Response> {
		return handleUploadRequest(request, {
			forja,
			uploadOptions: this.options,
		});
	}
}
