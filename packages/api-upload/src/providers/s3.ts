/**
 * AWS S3 Storage Provider
 *
 * Implements AWS Signature V4 signing without external SDK.
 */

import type {
	StorageProvider,
	UploadFile,
	UploadResult,
	S3ProviderOptions,
} from "@forja/core";
import { generateUniqueFilename, sanitizeFilename } from "@forja/core";
import { ForjaError } from "@forja/core";

class UploadError extends ForjaError {
	constructor(message: string, cause?: Error) {
		super(message, {
			code: "UPLOAD_ERROR",
			operation: "upload:s3",
			...(cause !== undefined && { cause }),
		});
		this.name = "UploadError";
	}
}

export class S3StorageProvider implements StorageProvider {
	readonly name = "s3" as const;

	private readonly bucket: string;
	private readonly region: string;
	private readonly accessKeyId: string;
	private readonly secretAccessKey: string;
	private readonly endpoint: string;
	private readonly pathPrefix: string;

	constructor(options: S3ProviderOptions) {
		this.bucket = options.bucket;
		this.region = options.region;
		this.accessKeyId = options.accessKeyId;
		this.secretAccessKey = options.secretAccessKey;
		this.endpoint = options.endpoint ?? `s3.${options.region}.amazonaws.com`;
		this.pathPrefix = options.pathPrefix ?? "uploads";
	}

	async upload(file: UploadFile): Promise<UploadResult> {
		try {
			const sanitized = sanitizeFilename(file.originalName);
			const filename = generateUniqueFilename(sanitized);
			const key = this.pathPrefix ? `${this.pathPrefix}/${filename}` : filename;

			await this.putObject(key, file.buffer, file.mimetype);

			return {
				key,
				size: file.size,
				mimetype: file.mimetype,
				uploadedAt: new Date(),
			};
		} catch (error) {
			if (error instanceof UploadError) throw error;
			const cause = error instanceof Error ? error : undefined;
			throw new UploadError("Failed to upload file to S3", cause);
		}
	}

	async delete(key: string): Promise<void> {
		try {
			await this.deleteObject(key);
		} catch (error) {
			if (error instanceof UploadError) throw error;
			const cause = error instanceof Error ? error : undefined;
			throw new UploadError("Failed to delete file from S3", cause);
		}
	}

	getUrl(key: string): string {
		return `https://${this.bucket}.${this.endpoint}/${key}`;
	}

	async exists(key: string): Promise<boolean> {
		try {
			await this.headObject(key);
			return true;
		} catch {
			return false;
		}
	}

	private async putObject(
		key: string,
		buffer: Uint8Array,
		contentType: string,
	): Promise<void> {
		const https = await import("https");
		const crypto = await import("crypto");

		const host = `${this.bucket}.${this.endpoint}`;
		const urlPath = `/${key}`;
		const method = "PUT";
		const date = new Date().toUTCString();
		const contentHash = crypto
			.createHash("sha256")
			.update(buffer)
			.digest("hex");
		const authorization = await this.signRequest(
			method,
			urlPath,
			host,
			date,
			contentType,
			contentHash,
		);

		await new Promise<void>((resolve, reject) => {
			const req = https.request(
				{
					hostname: host,
					port: 443,
					path: urlPath,
					method,
					headers: {
						Host: host,
						Date: date,
						"Content-Type": contentType,
						"Content-Length": buffer.length,
						"x-amz-content-sha256": contentHash,
						Authorization: authorization,
					},
				},
				(res) => {
					const status = res.statusCode ?? 0;
					if (status >= 200 && status < 300) {
						resolve();
					} else {
						let body = "";
						res.on("data", (chunk: Buffer) => {
							body += chunk.toString();
						});
						res.on("end", () => {
							reject(new UploadError(`S3 upload failed: ${status} ${body}`));
						});
					}
				},
			);
			req.on("error", (error: Error) => {
				reject(new UploadError("S3 request failed", error));
			});
			req.write(buffer);
			req.end();
		});
	}

	private async deleteObject(key: string): Promise<void> {
		const https = await import("https");
		const crypto = await import("crypto");

		const host = `${this.bucket}.${this.endpoint}`;
		const urlPath = `/${key}`;
		const method = "DELETE";
		const date = new Date().toUTCString();
		const contentHash = crypto.createHash("sha256").update("").digest("hex");
		const authorization = await this.signRequest(
			method,
			urlPath,
			host,
			date,
			"",
			contentHash,
		);

		await new Promise<void>((resolve, reject) => {
			const req = https.request(
				{
					hostname: host,
					port: 443,
					path: urlPath,
					method,
					headers: {
						Host: host,
						Date: date,
						"x-amz-content-sha256": contentHash,
						Authorization: authorization,
					},
				},
				(res) => {
					const status = res.statusCode ?? 0;
					if (status >= 200 && status < 300) {
						resolve();
					} else {
						let body = "";
						res.on("data", (chunk: Buffer) => {
							body += chunk.toString();
						});
						res.on("end", () => {
							reject(new UploadError(`S3 delete failed: ${status} ${body}`));
						});
					}
				},
			);
			req.on("error", (error: Error) => {
				reject(new UploadError("S3 request failed", error));
			});
			req.end();
		});
	}

	private async headObject(key: string): Promise<void> {
		const https = await import("https");
		const crypto = await import("crypto");

		const host = `${this.bucket}.${this.endpoint}`;
		const urlPath = `/${key}`;
		const method = "HEAD";
		const date = new Date().toUTCString();
		const contentHash = crypto.createHash("sha256").update("").digest("hex");
		const authorization = await this.signRequest(
			method,
			urlPath,
			host,
			date,
			"",
			contentHash,
		);

		await new Promise<void>((resolve, reject) => {
			const req = https.request(
				{
					hostname: host,
					port: 443,
					path: urlPath,
					method,
					headers: {
						Host: host,
						Date: date,
						"x-amz-content-sha256": contentHash,
						Authorization: authorization,
					},
				},
				(res) => {
					const status = res.statusCode ?? 0;
					if (status >= 200 && status < 300) resolve();
					else reject(new UploadError(`Object not found: ${status}`));
				},
			);
			req.on("error", (error: Error) => {
				reject(new UploadError("S3 request failed", error));
			});
			req.end();
		});
	}

	private async signRequest(
		method: string,
		urlPath: string,
		host: string,
		date: string,
		_contentType: string,
		contentHash: string,
	): Promise<string> {
		const crypto = await import("crypto");

		const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${contentHash}\nx-amz-date:${date}\n`;
		const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
		const canonicalRequest = [
			method,
			urlPath,
			"",
			canonicalHeaders,
			signedHeaders,
			contentHash,
		].join("\n");

		const algorithm = "AWS4-HMAC-SHA256";
		const amzDate = this.getAmzDate();
		const credentialScope = `${this.getDateStamp()}/${this.region}/s3/aws4_request`;
		const canonicalRequestHash = crypto
			.createHash("sha256")
			.update(canonicalRequest)
			.digest("hex");
		const stringToSign = [
			algorithm,
			amzDate,
			credentialScope,
			canonicalRequestHash,
		].join("\n");

		const signature = this.calculateSignature(crypto, stringToSign);
		return `${algorithm} Credential=${this.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
	}

	private calculateSignature(
		crypto: typeof import("crypto"),
		stringToSign: string,
	): string {
		const kDate = crypto
			.createHmac("sha256", `AWS4${this.secretAccessKey}`)
			.update(this.getDateStamp())
			.digest();
		const kRegion = crypto
			.createHmac("sha256", kDate)
			.update(this.region)
			.digest();
		const kService = crypto.createHmac("sha256", kRegion).update("s3").digest();
		const kSigning = crypto
			.createHmac("sha256", kService)
			.update("aws4_request")
			.digest();
		return crypto
			.createHmac("sha256", kSigning)
			.update(stringToSign)
			.digest("hex");
	}

	private getAmzDate(): string {
		return new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
	}

	private getDateStamp(): string {
		const now = new Date();
		const year = now.getUTCFullYear();
		const month = String(now.getUTCMonth() + 1).padStart(2, "0");
		const day = String(now.getUTCDate()).padStart(2, "0");
		return `${year}${month}${day}`;
	}
}
