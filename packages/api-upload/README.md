# @datrix/api-upload

File upload extension for `@datrix/api`. Provides storage-agnostic file handling, image format conversion, resolution variants, and automatic media schema injection. `sharp` is only loaded when this package is installed — the core API package stays dependency-free.

## Installation

```bash
pnpm add @datrix/api-upload
```

Requires `sharp` for image processing (format conversion and resolution variants).

## Setup

Pass an `Upload` instance to `ApiPlugin` via the `upload` option:

```typescript
import { Upload, LocalStorageProvider } from "@datrix/api-upload"
import { ApiPlugin } from "@datrix/api"

new ApiPlugin({
  upload: new Upload({
    provider: new LocalStorageProvider({
      basePath: "./uploads",
      baseUrl:  "https://example.com/uploads",
    }),
  }),
})
```

The plugin automatically registers a `media` schema and exposes `/api/upload` endpoints.

## Endpoints

| Method     | Path              | Description                                     |
| ---------- | ----------------- | ----------------------------------------------- |
| `POST`     | `/api/upload`     | Upload a file (`multipart/form-data`, field: `file`) |
| `DELETE`   | `/api/upload/:id` | Delete a media record and all its variant files |
| `GET`      | `/api/upload`     | List media records (pagination, filtering, populate) |
| `GET`      | `/api/upload/:id` | Get a single media record                       |

`GET` requests fall through to the standard CRUD handler — filtering, pagination, and populate work out of the box.

## Storage providers

### Local

Stores files on the local filesystem.

```typescript
new LocalStorageProvider({
  basePath:        "./uploads",                    // directory to write files into
  baseUrl:         "https://example.com/uploads",  // public URL prefix
  ensureDirectory: true,                           // create basePath if missing — default: true
})
```

### S3

Stores files in any S3-compatible object storage (AWS S3, Cloudflare R2, MinIO, etc.). No AWS SDK — uses native HTTPS with AWS Signature V4.

```typescript
import { S3StorageProvider } from "@datrix/api-upload"

new S3StorageProvider({
  bucket:          "my-bucket",
  region:          "us-east-1",
  accessKeyId:     "...",
  secretAccessKey: "...",
  endpoint:        "https://...",  // optional — custom endpoint for R2 / MinIO
  pathPrefix:      "uploads/",     // optional key prefix
})
```

### Custom provider

Implement the `StorageProvider` interface to add any backend (GCS, Azure Blob, etc.):

```typescript
import type { StorageProvider, UploadFile, UploadResult } from "@datrix/api"

class GCSProvider implements StorageProvider {
  readonly name = "gcs"

  async upload(file: UploadFile): Promise<UploadResult> { ... }
  async delete(key: string): Promise<void> { ... }
  getUrl(key: string): string { ... }
  async exists(key: string): Promise<boolean> { ... }
}
```

## URL design

Only the storage `key` is persisted in the database. The `url` field is **never stored** — it is derived at response time by calling `provider.getUrl(key)`. This means changing your domain, CDN, or switching providers never requires a database migration: update the provider config and all URLs resolve correctly immediately.

The same applies to variants — each variant stores its `key`, and `url` is injected on the way out.

## Format conversion

Convert every uploaded image to a target format before storage. The original file is discarded — only the converted version is stored.

```typescript
new Upload({
  provider,
  format:  "webp",  // "webp" | "jpeg" | "png" | "avif"
  quality: 80,      // 1–100, applies to jpeg / webp / avif — default: 80
})
```

## Resolution variants

Generate named resized copies of every uploaded image. Each variant is uploaded through the same provider.

```typescript
new Upload({
  provider,
  format: "webp",
  resolutions: {
    thumbnail: { width: 150, height: 150, fit: "cover" },
    small:     { width: 320 },   // height omitted — preserves aspect ratio
    medium:    { width: 640 },
  },
})
```

`fit` values (when both `width` and `height` are set): `cover`, `contain`, `fill`, `inside`, `outside`.

## Validation

```typescript
new Upload({
  provider,
  maxSize:          5 * 1024 * 1024,              // 5 MB limit
  allowedMimeTypes: ["image/*", "application/pdf"], // wildcards supported
})
```

## Media schema

`ApiPlugin` automatically registers a `media` schema with the following fields:

| Field          | Type     | Description                                                              |
| -------------- | -------- | ------------------------------------------------------------------------ |
| `filename`     | `string` | Generated unique filename                                                |
| `originalName` | `string` | Original filename from the upload                                        |
| `mimeType`     | `string` | MIME type after any conversion                                           |
| `size`         | `number` | File size in bytes                                                       |
| `key`          | `string` | Storage key — stored in DB, used to build URLs and delete files          |
| `url`          | `string` | **Not stored.** Injected at response time via `provider.getUrl(key)`     |
| `variants`     | `json`   | Map of resolution name → `MediaVariant` (each stores `key`, not `url`)  |

Use `modelName` in `UploadOptions` to change the schema/table name from the default `"media"`.

## Configuration reference

| Option             | Type                              | Default    | Description                                      |
| ------------------ | --------------------------------- | ---------- | ------------------------------------------------ |
| `provider`         | `StorageProvider`                 | —          | **Required.** Storage backend instance.          |
| `modelName`        | `string`                          | `"media"`  | Schema and table name for media records.         |
| `format`           | `"webp" \| "jpeg" \| "png" \| "avif"` | —      | Convert all uploaded images to this format.      |
| `quality`          | `number`                          | `80`       | Compression quality (1–100).                     |
| `maxSize`          | `number`                          | —          | Maximum file size in bytes.                      |
| `allowedMimeTypes` | `string[]`                        | —          | Allowed MIME types. Supports wildcards.          |
| `resolutions`      | `Record<string, ResolutionConfig>` | —         | Named resolution variants to generate.           |
| `permission`       | `SchemaPermission`                | —          | Permission config for the injected media schema. |

## Architecture

```text
src/
├── upload.ts      # Upload class — implements IUpload, owns injectUrls traversal
├── handler.ts     # POST /upload and DELETE /upload/:id request handlers
├── processor.ts   # sharp-based format conversion and variant generation
├── schema.ts      # Media schema factory
├── types.ts       # UploadOptions, ResolutionConfig, ImageFormat, ResizeFit
├── index.ts       # Public exports
└── providers/
    ├── local.ts   # LocalStorageProvider — filesystem storage
    └── s3.ts      # S3StorageProvider — AWS S3 / R2 / MinIO (no SDK)
```
