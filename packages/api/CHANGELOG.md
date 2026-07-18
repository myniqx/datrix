# @datrix/api

## 0.2.0

### Breaking / behavior changes

- **JWT signature format fixed:** signatures were double-encoded
  (`base64url(base64(hmac))`); they are now standard `base64url(hmac)`.
  Previously issued tokens are invalidated — users must log in again.
- **Invalid `jwt.expiresIn` now throws at startup** instead of silently
  defaulting to 1 hour.
- **Default permission hardened:** when neither `schema.permission` nor
  `defaultPermission` defines a value for an action, `read` stays open but
  `create`/`update`/`delete` now require an authenticated user (previously
  fully open, including anonymous writes).
- **`ctx.user` resolution (D1):** email/role now come from the authentication
  record in the DB on every authenticated request (role changes apply
  immediately) and the populated user record is exposed as `ctx.user.user`.
  Adds one DB query per authenticated request.
- **Logout always succeeds** (200 + cookie clear), including JWT-only setups
  (previously 400/500 without a session).
- **Auto auth-record sync (D3):** passwords from user inserts are hashed
  (never stored in plaintext), `role` always comes from `defaultRole`, and
  bulk inserts sync every row.
- **Non-numeric ids in CRUD paths return 404** (previously treated as list
  requests or partially parsed).

### Features

- **`QUERY` HTTP method** (and `POST /api/:schema/query` alias): read queries
  with a JSON `ParsedQuery` body — validated at the API boundary (key
  whitelist, page/pageSize limits, where depth/length limits, recursive field
  name validation including populate-level `where`/`orderBy`).
- Reset tokens are stored as SHA-256 digests; auth schema gained
  `resetToken`/`resetTokenExpiry` columns (the reset flow now actually works).
- Session cookies honor `session.maxAge` and set `Secure` on HTTPS.
- Concurrent request identity is isolated via `AsyncLocalStorage` (fixes
  cross-request user leakage under load).

### Fixes

- `/auth/me` no longer leaks the password hash/salt in its response.
- Register no longer allows mass-assignment of `id`/timestamps/email-field
  through raw mode, and is now transactional (an auth-record failure rolls
  back the created user instead of leaving it orphaned).
- Login no longer allows user enumeration via response-timing differences.
- Field-level read/write permissions are now enforced recursively into
  populated relations and nested relation create/update payloads.
- Fixed several routing edge cases: config-driven `defaultPageSize`/
  `maxPageSize`/`maxPopulateDepth` were previously ignored, custom auth
  endpoint prefixes could misroute, and malformed JSON bodies produced a
  generic error instead of a clear 400.

## 0.1.2

### Patch Changes

- 7d7915b: Add password reset flow to auth system, fix WhereClause optional fields, update adapter-json readme
  - `AuthenticatedUser` extended with `resetToken` and `resetTokenExpiry` fields
  - `AuthConfig` now accepts a second generic `TUser extends DatrixEntry` for typed user population in callbacks
  - `AuthConfig.passwordReset` block added: `tokenExpirySeconds` and `onForgotPassword` callback
  - `DEFAULT_API_AUTH_CONFIG` updated with `forgotPassword` and `resetPassword` endpoint defaults
  - `WhereClause` fix: optional scalar fields (`field?: string`) no longer resolve to `never` in typed where clauses
  - New endpoints: `POST /auth/forgot-password` and `POST /auth/reset-password`
  - `AuthManager` and `AuthHandlerConfig` updated with `TUser` generic
  - `@datrix/adapter-json` README updated

- Updated dependencies [7d7915b]
  - @datrix/core@0.1.2

## 0.1.1

### Patch Changes

- Initial release of @datrix/\* packages and small fixes
- Updated dependencies
  - @datrix/core@0.1.1
