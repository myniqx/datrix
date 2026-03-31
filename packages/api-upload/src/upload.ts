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

	readonly provider: UploadOptions<TResolutions>["provider"];

	constructor(options: UploadOptions<TResolutions>) {
		this.options = options;
		this.provider = options.provider;
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
			injectUrls: (data) => this.injectUrls(data),
		});
	}

	async injectUrls(data: unknown): Promise<unknown> {
		return this.traverse(data);
	}

	getUrl(key: string): string {
		return this.options.provider.getUrl(key);
	}

	private async traverse(node: unknown): Promise<unknown> {
		if (Array.isArray(node)) {
			const results: unknown[] = [];
			for (const item of node) {
				results.push(await this.traverse(item));
			}
			return results;
		}

		if (node !== null && typeof node === "object") {
			const obj = node as Record<string, unknown>;
			const result: Record<string, unknown> = {};

			for (const [k, v] of Object.entries(obj)) {
				result[k] = await this.traverse(v);
			}

			// Inject url if this looks like a media object (has key, no url)
			if (typeof result["key"] === "string" && result["url"] === undefined) {
				result["url"] = this.options.provider.getUrl(result["key"]);
			}

			// Inject urls into variants
			if (
				result["variants"] !== null &&
				typeof result["variants"] === "object"
			) {
				const variants = result["variants"] as Record<string, unknown>;
				for (const [name, variant] of Object.entries(variants)) {
					if (variant !== null && typeof variant === "object") {
						const v = variant as Record<string, unknown>;
						if (typeof v["key"] === "string" && v["url"] === undefined) {
							variants[name] = {
								...v,
								url: this.options.provider.getUrl(v["key"]),
							};
						}
					}
				}
			}

			return result;
		}

		return node;
	}
}
