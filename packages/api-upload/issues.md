# @datrix/api-upload — Review Issues

Review scope: `packages/api-upload/src/**` (tests excluded). Issues are grouped into
sessions — each session is an independently solvable chunk. Every issue states the
problem, the location (`file:line`), and how it must be solved.

Cross-package context: `POST/DELETE /upload` requests are routed by `@datrix/api`
(`packages/api/src/api.ts:465-471`) directly into `Upload.handleRequest` — **before**
any auth/permission middleware runs. Several issues below involve that boundary.

---

## Fix status (2026-07-18)

All sessions (1–6) are **fixed**. Deviations and decisions made during the fix:

- **1.1:** Implemented api-side as `ApiPlugin.handleUploadRoute` — authenticates, then
  evaluates the *user-configured* permission (`IUpload.getPermission()`, new optional
  method on the core interface); with none, POST/DELETE require an authenticated user.
- **1.2:** `createMediaSchema` now registers `{ create: false, update: false }` defaults
  (user-provided `permission` overrides). The upload endpoints read the raw user config,
  so they are unaffected by the CRUD default-deny.
- **1.3:** Content verification runs for every declared `image/*` type via
  `detectImageMime` (sharp metadata); `svg` is mapped so explicitly allowed SVG uploads
  still work. Non-image declared types remain unverified (documented in README).
- **3.3:** Implemented (not deferred): `sessionToken` + `forcePathStyle` added to
  `S3ProviderOptions` and honored in signing and URL building.
- **5.4:** POST with an id and extra path segments return 404; DELETE without an id
  returns the API's standard `MISSING_ID` (400) rather than 404, matching CRUD behavior.
- **6.1:** Chose the "keep as dependency" option: `sharp` stays a regular dependency
  (content verification now needs it for image uploads); the fake-optional
  `SHARP_NOT_FOUND` guards were removed in favor of one cached lazy loader.
  `@types/sharp` removed.
- Backlog items were intentionally left untouched.

---

## Session 1 — Security (routing, permissions, trust boundaries)

### 1.1 `POST /upload` and `DELETE /upload/:id` bypass auth and permissions entirely (critical)
- **Problem:** `api.ts` routes all non-GET methods on `/upload` straight to
  `upload.handleRequest(request, datrix)`. The upload handler never builds a request
  context, never authenticates, and never evaluates the media schema's `permission`
  config (or the D2 default). Anonymous clients can upload files and delete any media
  record + its storage files. The `permission` option on `UploadOptions` only protects
  the CRUD GET routes.
- **Where:** `packages/api/src/api.ts:465-471` (routing);
  `src/handler.ts:29-67` (no auth/permission evaluation); `src/types.ts:54`
  (`permission` option, misleadingly global-looking)
- **Fix:** The api package must authenticate and evaluate the media schema's
  `create`/`delete` permission (same `checkSchemaPermission` path as CRUD, including
  the D2 default: writes require an authenticated user) **before** delegating to
  `upload.handleRequest`. Alternatively pass the built `RequestContext` into
  `handleRequest` so the upload handler can enforce it — but the check must live on
  the api side of the boundary either way. Document that `permission` now covers the
  upload endpoints too.

### 1.2 Direct CRUD writes on the media model bypass the upload pipeline
- **Problem:** The media schema is registered as a normal schema, so
  `POST/PATCH /api/media` (default model name) work as plain CRUD. A client with write
  access can create fake media records or rewrite `key`/`variants.key` of an existing
  record to an arbitrary path — then `DELETE /upload/:id` deletes whatever those keys
  point to in storage (see 1.4). Uploads must be the only way media rows are written.
- **Where:** `src/schema.ts:15-26` (plain schema, no write lock);
  `src/handler.ts:184-192` (trusts `record.key`/`variants[*].key` from DB)
- **Fix:** Default the media schema's `create`/`update` permission to `false` (deny
  over HTTP) unless the user explicitly overrides it via `options.permission`. The
  upload handler writes through `datrix.raw.*`, which does not go through the API
  permission layer, so it keeps working.

### 1.3 MIME type is client-declared — never verified against file content
- **Problem:** `rawFile.mimetype` comes from `fileEntry.type`, which the client sets
  freely. `allowedMimeTypes` filtering, `isImage` branching, and the stored
  `mimeType` column all trust it. A client can upload an HTML/SVG payload declared as
  `image/png`: it skips conversion only if sharp rejects it, and with no
  `format`/`resolutions` configured it is stored verbatim and later served from
  `baseUrl` — stored-XSS risk with the local provider.
- **Where:** `src/handler.ts:103-111` (`mimetype: fileEntry.type`, then
  `validateFileLimits`); `src/processor.ts:21-23` (`isImage`)
- **Fix:** When the declared type is an image type (or `allowedMimeTypes` restricts to
  images), verify with `sharp(buffer).metadata()` and derive the real format from
  `metadata.format`; reject on mismatch (`INVALID_MIME_TYPE`). For non-image uploads,
  document that the type is client-declared, and recommend serving the local
  `basePath` with `Content-Disposition: attachment` / `X-Content-Type-Options:
  nosniff`.

### 1.4 Local provider has no path containment — traversal via `key`
- **Problem:** `delete`/`exists`/`getUrl` do `path.join(this.basePath, key)` with no
  check that the result stays inside `basePath`. A key like `../../app/.env`
  (reachable via 1.2, or any future caller) deletes files outside the upload root.
  `upload()` is safe only because it regenerates the filename.
- **Where:** `src/providers/local.ts:70`, `:98`, `:106-110`
- **Fix:** Resolve `path.resolve(basePath, key)` and require it to start with
  `path.resolve(basePath) + path.sep`; otherwise throw `UploadError("Invalid key")`.
  Apply the same guard in `delete`, `exists`, and `getUrl`.

---

## Session 2 — Storage/DB consistency (`src/handler.ts`)

### 2.1 Orphaned storage files when the DB insert fails
- **Problem:** The original file (and all variants) are uploaded to the provider
  first; if `datrix.raw.create` then throws (validation, connection, unique
  violation), the storage objects are permanently orphaned — no cleanup, no record.
- **Where:** `src/handler.ts:129-154`
- **Fix:** Wrap `raw.create` in `try/catch`; on failure, best-effort
  `provider.delete(result.key)` and every uploaded `variants[*].key` (swallow+log
  individual delete errors), then rethrow.

### 2.2 Variant generation failure orphans the original and earlier variants
- **Problem:** `generateVariants` uploads variants one by one and throws on the first
  failure. The already-uploaded original and any earlier variants stay in storage,
  and no DB record is created.
- **Where:** `src/processor.ts:124-170`; caller `src/handler.ts:133-145`
- **Fix:** Track uploaded variant keys inside `generateVariants` (or in the handler);
  on error, best-effort delete the collected keys and the original upload before
  rethrowing. Combine with the 2.1 cleanup helper.

### 2.3 Delete order: storage first, DB last — a DB failure leaves a broken record
- **Problem:** `handleDeleteMedia` deletes variant files, then the main file, then the
  DB row. If any provider delete throws (e.g. local provider's "File not found" for a
  key already gone — `src/providers/local.ts:73-77`), the whole request 500s and the
  record now points at partially deleted storage. A single missing file makes the
  record permanently undeletable.
- **Where:** `src/handler.ts:184-193`
- **Fix:** Delete the DB record **first**, then best-effort delete storage objects
  (collect and log failures, still return 200 — an orphaned file is recoverable, a
  dangling record is not). Additionally make the local provider's `delete` treat
  ENOENT as success (idempotent delete) instead of throwing "File not found".

---

## Session 3 — S3 provider correctness (`src/providers/s3.ts`)

### 3.1 SigV4 signature is structurally broken — requests can never authenticate (critical)
- **Problem:** Two independent defects:
  1. `signedHeaders` claims `host;x-amz-content-sha256;x-amz-date`, but the actual
     HTTP request never sends an `x-amz-date` header (it sends `Date:` instead) —
     AWS rejects a signature whose signed header is absent.
  2. The canonical request embeds `x-amz-date:${date}` where `date` is
     `toUTCString()` (RFC 1123), while `stringToSign` uses `amzDate`
     (ISO 8601 basic, `getAmzDate()`). SigV4 requires the same ISO-basic timestamp
     in the header, the canonical request, and the string to sign.
  Every `putObject`/`deleteObject`/`headObject` against real S3 fails with
  `SignatureDoesNotMatch`. Tests presumably never hit a real endpoint.
- **Where:** `src/providers/s3.ts:253-290` (signRequest), `:101` / `:161` / `:215`
  (`toUTCString`), `:120-129` / `:177-184` / `:230-238` (headers sent)
- **Fix:** Compute `amzDate` once per request, send it as the `x-amz-date` header,
  use the same value in `canonicalHeaders`, and derive `getDateStamp()` from it
  (currently a second `new Date()` — a midnight-boundary race). Drop the unsigned
  `Date` header. Verify against a real S3/MinIO endpoint or a known-good SigV4 test
  vector.

### 3.2 Canonical URI is not URI-encoded
- **Problem:** `urlPath = "/" + key` goes into the canonical request raw. Generated
  filenames are safe, but a user-supplied `pathPrefix` containing characters that
  need encoding (spaces, unicode) breaks both the request and the signature.
- **Where:** `src/providers/s3.ts:99`, `:159`, `:213`, `:265-272`
- **Fix:** Encode each path segment with `encodeURIComponent` (keeping `/`
  separators) for both the request path and the canonical URI, per SigV4 rules.

### 3.3 (Low) No session-token support; `getUrl` assumes virtual-host style
- **Problem:** Temporary credentials (STS) need `x-amz-security-token` in the signed
  headers; `getUrl` always builds `https://{bucket}.{endpoint}/{key}`, which breaks
  path-style S3-compatible endpoints (MinIO, localstack).
- **Where:** `src/providers/s3.ts:27-44`, `:77-79`
- **Fix:** Add optional `sessionToken` and `forcePathStyle` to `S3ProviderOptions`
  (core `packages/core/src/types/api/upload.ts:132-139`) and honor them in signing
  and URL building. Can be deferred to backlog if STS/MinIO are out of scope — but
  document the limitation.

---

## Session 4 — `injectUrls` response transformation (`src/upload.ts`)

### 4.1 `traverse()` destroys `Date` instances — every timestamp becomes `{}` (critical)
- **Problem:** `traverse` rebuilds any non-array object from `Object.entries`.
  `Object.entries(new Date())` is `[]`, so every `Date` value (`createdAt`,
  `updatedAt`, any date field) in any API response is replaced with an empty object.
  `injectUrls` runs on **all** CRUD responses when upload is configured
  (`packages/api/src/handler/unified.ts:55-95`), so this corrupts every schema's
  output, not just media.
- **Where:** `src/upload.ts:62-95`
- **Fix:** At the top of the object branch, return the node as-is when it is not a
  plain object (`node instanceof Date`, or more generally
  `Object.getPrototypeOf(node) !== Object.prototype && !Array.isArray(node)`).

### 4.2 URL injection triggers on any object with a string `key` field
- **Problem:** The media-object heuristic is "has string `key`, no `url`". Any
  unrelated schema with a `key` string field (e.g. a settings or translation table)
  gets a fabricated `url` injected into its API responses.
- **Where:** `src/upload.ts:71-73`
- **Fix:** Tighten the shape check to the media record signature: require `key`
  **and** `mimeType` **and** numeric `size` (all schema-required fields) before
  injecting. Apply the same rule to the variants branch (require `width`/`height` or
  at least `key` + parent matching the media shape).

### 4.3 (Low) Deep traversal clones every response even when nothing matches
- **Problem:** Every list response is deep-cloned object-by-object with sequential
  awaits even though `traverse` is fully synchronous work — pure overhead on large
  result sets.
- **Where:** `src/upload.ts:45-98`
- **Fix:** Make `traverse` synchronous (no awaits inside), and short-circuit: if a
  subtree contains no object with the media shape, return the original reference
  instead of a clone.

---

## Session 5 — Handler robustness (`src/handler.ts`)

### 5.1 Non-numeric id becomes `NaN` and reaches the executor
- **Problem:** `Number("abc")` is `NaN`, which is `!== null`, so
  `DELETE /upload/abc` calls `raw.findById(model, NaN)` instead of returning 404.
  `Number("1.5")` similarly passes a non-integer id through.
- **Where:** `src/handler.ts:38-48`
- **Fix:** Require the id segment to match `/^\d+$/`; otherwise return
  `handlerError.recordNotFound` (404). Mirrors api issue 6.2.

### 5.2 `File` global is not available on Node 18
- **Problem:** `fileEntry instanceof File` references the global `File`, which only
  exists from Node 20 (Node 18 exposes it via `node:buffer` only). On Node 18
  (allowed by `engines: >=18`) the first upload throws `ReferenceError: File is not
  defined`.
- **Where:** `src/handler.ts:96`; `package.json:24-26`
- **Fix:** `import { File } from "node:buffer"` — or duck-type the entry
  (`typeof fileEntry === "object" && typeof fileEntry.arrayBuffer === "function"`).
  Same class of problem as api issue 1.5.

### 5.3 `maxSize` is enforced after the entire body is buffered
- **Problem:** `request.formData()` and `fileEntry.arrayBuffer()` load the full
  upload into memory before `validateFileLimits` runs — a multi-GB request is fully
  buffered just to be rejected. Memory-exhaustion DoS vector.
- **Where:** `src/handler.ts:83-111`
- **Fix (bounded by the Web API):** (1) check the request `Content-Length` header
  against `maxSize` (+ small form overhead) before calling `formData()` and reject
  early with 413; (2) check `fileEntry.size` before calling `arrayBuffer()`.
  Document that a hard streaming limit must be enforced at the server/proxy level
  (body size limit), since `Request.formData()` cannot stream-abort.

### 5.4 (Low) Route/method mismatches return misleading 405s
- **Problem:** `POST /upload/5`, `PATCH /upload/:id`, `DELETE /upload` (no id) all
  fall through to `methodNotAllowed(method)`. For PATCH this silently means media
  metadata can never be updated over HTTP (see 1.2 — that may be intentional, but it
  is undocumented).
- **Where:** `src/handler.ts:42-50`
- **Fix:** Return 404 for `POST` with an id and `DELETE` without an id; keep 405 for
  genuinely unsupported methods. Document in the README that media records are
  immutable over HTTP except via re-upload/delete.

### 5.5 (Low) Multiple `file` entries are silently dropped
- **Problem:** `formData.get("file")` takes the first entry; extra files in the same
  request are ignored without any signal to the client.
- **Where:** `src/handler.ts:95`
- **Fix:** Use `formData.getAll("file")`; if more than one entry, either reject with
  400 ("single file per request") or implement multi-upload. Rejection is the
  cheaper, explicit option.

---

## Session 6 — Cleanups & minor fixes

### 6.1 `sharp` is a hard dependency but the code pretends it is optional
- **Where:** `package.json:54-56` (dependencies), `src/processor.ts:57-66`, `:107-116`
  (dynamic import + `SHARP_NOT_FOUND` guard)
- **Fix:** Pick one: move `sharp` to `optionalDependencies`/`peerDependencies` (it is
  a heavy native module and non-image uploads don't need it) and keep the guard — or
  keep it as a dependency and drop the guard + dynamic import ceremony. Also remove
  `@types/sharp` from devDependencies (deprecated stub; sharp ships its own types).

### 6.2 `url: undefined!` non-null-assertion hack in variant records
- **Where:** `src/processor.ts:160`; type at
  `packages/core/src/types/api/upload.ts:47-54` (`MediaVariant.url` required)
- **Fix:** Make `url` optional (`readonly url?: string`) on `MediaVariant` — it is
  injected at read time, never stored — and drop the `undefined!` assertion. Aligns
  the type with reality (`MediaEntry.url` at `:84` has the same problem: the schema
  in `src/schema.ts` stores no `url` column).

### 6.3 `"media"` default model name duplicated in three places
- **Where:** `src/upload.ts:26`, `src/handler.ts:74`, `:172`, `src/schema.ts:13`
- **Fix:** Resolve it once (e.g. pass `modelName` into `UploadHandlerOptions` from
  `Upload.handleRequest`, using `this.getModelName()`), delete the local fallbacks.

### 6.4 Redundant `permission` parameter on `createMediaSchema`
- **Where:** `src/schema.ts:9-12` takes both `options` and `permission`;
  `src/upload.ts:30-33` passes `this.options` and `this.options.permission` — the
  second argument duplicates a field of the first.
- **Fix:** Drop the second parameter; read `options.permission` inside.

### 6.5 Local `delete` does access-then-unlink (TOCTOU) with a misleading error
- **Where:** `src/providers/local.ts:66-88`
- **Fix:** Call `unlink` directly; map `ENOENT` per the 2.3 decision (idempotent
  success). Removes the race window and one syscall.

### 6.6 `quality` is not validated
- **Where:** `src/types.ts:60-64` (documented 1–100), `src/handler.ts:114` (used raw)
- **Fix:** Validate `1 <= quality <= 100` in the `Upload` constructor and throw a
  config error otherwise (sharp errors on out-of-range values are opaque).

### 6.7 `getDateStamp`/`getAmzDate` call `new Date()` twice per signature
- **Where:** `src/providers/s3.ts:315-325`
- **Fix:** Folded into 3.1 — derive both strings from a single timestamp captured at
  request start.

---

## Backlog / enhancements (not defects)

- **Variant generation is sequential:** each variant re-decodes the original and
  uploads serially (`src/processor.ts:124-170`). `Promise.all` over variants would
  cut latency; only worth it after the cleanup semantics of 2.2 are settled.
- **No image dimensions on the main record:** width/height are captured for variants
  but not for the original. A `width`/`height` column pair on the media schema would
  save clients a round trip.
- **`exists()` swallows all errors as `false`** (`src/providers/local.ts:94-104`,
  `src/providers/s3.ts:81-88`): a network/permission error is indistinguishable from
  "not found". Acceptable for current callers; revisit if `exists` gains users.
- **GET /upload/:id vs GET /api/media/:id duality:** both routes serve the same
  record through CRUD. Consider documenting `/upload` as the canonical route and the
  model-name route as internal.
