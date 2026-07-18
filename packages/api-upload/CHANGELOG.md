# @datrix/api-upload

## 0.2.0

### Breaking / behavior changes

- **`POST /upload` and `DELETE /upload/:id` now require authentication and
  permission checks** (previously bypassed auth/permission middleware
  entirely).
- **Direct CRUD writes on the media model are denied by default**
  (`create`/`update` default to `false`); uploads remain the only write path.
- **`sharp` is now a regular dependency** (needed for image content
  verification); the optional-dependency guard was removed.

### Fixes

- Declared image MIME types are now verified against actual file content
  (`sharp` metadata) instead of trusting the client-declared type.
- Local provider now guards against path traversal via `key` in
  `delete`/`exists`/`getUrl`.
- Orphaned storage files on DB-insert failure, and orphaned original/variant
  files on partial variant-generation failure, are now cleaned up.
- Media delete now removes the DB record first, then best-effort deletes
  storage objects, so a missing storage file no longer makes a record
  permanently undeletable.
- Fixed the S3 provider's SigV4 signing (mismatched/missing `x-amz-date`
  header — requests could never authenticate against real S3) and
  non-URI-encoded canonical paths.
- `traverse()` in `injectUrls` no longer destroys `Date` values in API
  responses; URL injection no longer triggers on unrelated schemas that
  happen to have a string `key` field.
- Non-numeric upload ids now return 404 instead of reaching the executor as
  `NaN`; `maxSize` is checked against `Content-Length` before buffering the
  request body.

