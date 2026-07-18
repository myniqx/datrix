/**
 * Upload — main class, implements IUpload interface.
 * Pass an instance to ApiPlugin: new ApiPlugin({ upload: new Upload({ ... }) })
 *
 * @template TResolutions - Union of resolution names (e.g. "thumbnail" | "small" | "medium")
 */

import type { Datrix } from "@datrix/core";
import type { IUpload } from "@datrix/core";
import type { SchemaDefinition, SchemaPermission } from "@datrix/core";
import { DatrixError } from "@datrix/core";
import { createMediaSchema } from "./schema";
import { handleUploadRequest } from "./handler";
import type { UploadOptions } from "./types";

export class Upload<TResolutions extends string = string> implements IUpload {
	private readonly options: UploadOptions<TResolutions>;

	readonly provider: UploadOptions<TResolutions>["provider"];

	constructor(options: UploadOptions<TResolutions>) {
		const quality = options.quality;
		if (quality !== undefined && (quality < 1 || quality > 100)) {
			throw new DatrixError(
				`Upload quality must be between 1 and 100, got ${quality}`,
				{ code: "INVALID_UPLOAD_CONFIG", operation: "upload:config" },
			);
		}

		this.options = options;
		this.provider = options.provider;
	}

	getModelName(): string {
		return this.options.modelName ?? "media";
	}

	getPermission(): SchemaPermission | undefined {
		return this.options.permission;
	}

	getSchemas(): SchemaDefinition[] {
		return [createMediaSchema(this.getModelName(), this.options.permission)];
	}

	async handleRequest(request: Request, datrix: Datrix): Promise<Response> {
		return handleUploadRequest(request, {
			datrix,
			modelName: this.getModelName(),
			uploadOptions: this.options,
			injectUrls: (data) => this.injectUrls(data),
		});
	}

	async injectUrls(data: unknown): Promise<unknown> {
		return this.traverse(data);
	}

	getUrl(key: string): string {
		return this.options.provider.getUrl(key);
	}

	/**
	 * Recursively inject `url` into media-shaped objects (`key` + `mimeType` +
	 * numeric `size` — the media record signature; variant entries match it
	 * too). Non-plain objects (Date, class instances) pass through untouched,
	 * and unchanged subtrees keep their original reference.
	 */
	private traverse(node: unknown): unknown {
		if (Array.isArray(node)) {
			let changed = false;
			const results = node.map((item) => {
				const result = this.traverse(item);
				if (result !== item) changed = true;
				return result;
			});
			return changed ? results : node;
		}

		if (!isPlainObject(node)) {
			return node;
		}

		let changed = false;
		const result: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(node)) {
			const traversed = this.traverse(v);
			if (traversed !== v) changed = true;
			result[k] = traversed;
		}

		if (
			typeof result["key"] === "string" &&
			typeof result["mimeType"] === "string" &&
			typeof result["size"] === "number" &&
			result["url"] === undefined
		) {
			result["url"] = this.options.provider.getUrl(result["key"]);
			changed = true;
		}

		return changed ? result : node;
	}
}

function isPlainObject(node: unknown): node is Record<string, unknown> {
	if (node === null || typeof node !== "object") {
		return false;
	}
	const proto = Object.getPrototypeOf(node);
	return proto === Object.prototype || proto === null;
}
