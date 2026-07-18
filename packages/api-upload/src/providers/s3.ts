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
} from "@datrix/core";
import { generateUniqueFilename, sanitizeFilename } from "@datrix/core";
import { DatrixError } from "@datrix/core";

class UploadError extends DatrixError {
	constructor(message: string, cause?: Error) {
		super(message, {
			code: "UPLOAD_ERROR",
			operation: "upload:s3",
			...(cause !== undefined && { cause }),
		});
		this.name = "UploadError";
	}
}

interface S3RequestOptions {
	readonly body?: Uint8Array;
	readonly contentType?: string;
	/** HEAD responses carry no body — skip reading it on error */
	readonly readErrorBody?: boolean;
}

export class S3StorageProvider implements StorageProvider {
	readonly name = "s3" as const;

	private readonly bucket: string;
	private readonly region: string;
	private readonly accessKeyId: string;
	private readonly secretAccessKey: string;
	private readonly endpoint: string;
	private readonly pathPrefix: string;
	private readonly sessionToken: string | undefined;
	private readonly forcePathStyle: boolean;

	constructor(options: S3ProviderOptions) {
		this.bucket = options.bucket;
		this.region = options.region;
		this.accessKeyId = options.accessKeyId;
		this.secretAccessKey = options.secretAccessKey;
		this.endpoint = options.endpoint ?? `s3.${options.region}.amazonaws.com`;
		this.pathPrefix = options.pathPrefix ?? "uploads";
		this.sessionToken = options.sessionToken;
		this.forcePathStyle = options.forcePathStyle ?? false;
	}

	async upload(file: UploadFile): Promise<UploadResult> {
		try {
			const sanitized = sanitizeFilename(file.originalName);
			const filename = generateUniqueFilename(sanitized);
			const key = this.pathPrefix ? `${this.pathPrefix}/${filename}` : filename;

			await this.sendRequest("PUT", key, {
				body: file.buffer,
				contentType: file.mimetype,
			});

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
			await this.sendRequest("DELETE", key, {});
		} catch (error) {
			if (error instanceof UploadError) throw error;
			const cause = error instanceof Error ? error : undefined;
			throw new UploadError("Failed to delete file from S3", cause);
		}
	}

	getUrl(key: string): string {
		const encodedKey = encodePath(key);
		return this.forcePathStyle
			? `https://${this.endpoint}/${this.bucket}/${encodedKey}`
			: `https://${this.bucket}.${this.endpoint}/${encodedKey}`;
	}

	async exists(key: string): Promise<boolean> {
		try {
			await this.sendRequest("HEAD", key, { readErrorBody: false });
			return true;
		} catch {
			return false;
		}
	}

	private hostAndPath(key: string): { host: string; urlPath: string } {
		const encodedKey = encodePath(key);
		return this.forcePathStyle
			? { host: this.endpoint, urlPath: `/${this.bucket}/${encodedKey}` }
			: { host: `${this.bucket}.${this.endpoint}`, urlPath: `/${encodedKey}` };
	}

	/**
	 * Send a SigV4-signed request to S3, resolving on 2xx and rejecting with
	 * the response body otherwise.
	 */
	private async sendRequest(
		method: string,
		key: string,
		options: S3RequestOptions,
	): Promise<void> {
		const https = await import("https");
		const crypto = await import("crypto");

		const { host, urlPath } = this.hostAndPath(key);
		const { body, contentType, readErrorBody = true } = options;

		// One timestamp for the whole signature — header, canonical request,
		// string-to-sign, and credential scope must all agree.
		const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
		const dateStamp = amzDate.slice(0, 8);
		const contentHash = crypto
			.createHash("sha256")
			.update(body ?? "")
			.digest("hex");

		// Signed headers, alphabetically ordered
		const signedHeaderEntries: [string, string][] = [
			["host", host],
			["x-amz-content-sha256", contentHash],
			["x-amz-date", amzDate],
		];
		if (this.sessionToken !== undefined) {
			signedHeaderEntries.push(["x-amz-security-token", this.sessionToken]);
		}

		const canonicalHeaders = signedHeaderEntries
			.map(([name, value]) => `${name}:${value}\n`)
			.join("");
		const signedHeaders = signedHeaderEntries.map(([name]) => name).join(";");
		const canonicalRequest = [
			method,
			urlPath,
			"",
			canonicalHeaders,
			signedHeaders,
			contentHash,
		].join("\n");

		const algorithm = "AWS4-HMAC-SHA256";
		const credentialScope = `${dateStamp}/${this.region}/s3/aws4_request`;
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

		const signature = this.calculateSignature(crypto, stringToSign, dateStamp);
		const authorization = `${algorithm} Credential=${this.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

		const headers: Record<string, string | number> = {
			Host: host,
			"x-amz-date": amzDate,
			"x-amz-content-sha256": contentHash,
			Authorization: authorization,
		};
		if (this.sessionToken !== undefined) {
			headers["x-amz-security-token"] = this.sessionToken;
		}
		if (body !== undefined) {
			headers["Content-Length"] = body.length;
			if (contentType !== undefined) {
				headers["Content-Type"] = contentType;
			}
		}

		await new Promise<void>((resolve, reject) => {
			const req = https.request(
				{ hostname: host, port: 443, path: urlPath, method, headers },
				(res) => {
					const status = res.statusCode ?? 0;
					if (status >= 200 && status < 300) {
						res.resume();
						resolve();
						return;
					}
					if (!readErrorBody) {
						res.resume();
						reject(new UploadError(`S3 ${method} failed: ${status}`));
						return;
					}
					let responseBody = "";
					res.on("data", (chunk: Buffer) => {
						responseBody += chunk.toString();
					});
					res.on("end", () => {
						reject(
							new UploadError(`S3 ${method} failed: ${status} ${responseBody}`),
						);
					});
				},
			);
			req.on("error", (error: Error) => {
				reject(new UploadError("S3 request failed", error));
			});
			if (body !== undefined) {
				req.write(body);
			}
			req.end();
		});
	}

	private calculateSignature(
		crypto: typeof import("crypto"),
		stringToSign: string,
		dateStamp: string,
	): string {
		const kDate = crypto
			.createHmac("sha256", `AWS4${this.secretAccessKey}`)
			.update(dateStamp)
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
}

/**
 * RFC 3986 encoding of an object-key path, keeping `/` separators —
 * required for both the request path and the SigV4 canonical URI.
 */
function encodePath(key: string): string {
	return key
		.split("/")
		.map((segment) =>
			encodeURIComponent(segment).replace(
				/[!'()*]/g,
				(char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
			),
		)
		.join("/");
}
