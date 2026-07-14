# @datrix/api — Review Issues

Review scope: `packages/api/src/**` (tests excluded). Issues are grouped into sessions —
each session is an independently solvable chunk. Every issue states the problem, the
location (`file:line`), and how it must be solved.

Decisions already made (do not re-discuss during fix sessions):

- **D1 (AuthUser identity):** `AuthUser.id` stays the authentication record's own id.
  The fix is to populate the `user` relation at authentication time and expose the
  populated user record on the auth context (`ctx.user.user`). See Session 4.
- **D2 (default permission):** When neither `schema.permission` nor `defaultPermission`
  defines a value for an action: `read` is allowed for everyone; `create/update/delete`
  require an authenticated user. Explicit permissions always win. See Session 5.
- **D3 (user→auth sync):** The automatic authentication-record sync on user insert stays
  **always on** (it is the only mechanism that keeps user/auth tables consistent for
  admin/programmatically created users). Password is hashed when present; otherwise a
  passwordless record is created (activated via the reset-password flow). Role always
  comes from `defaultRole`. See Session 2.6 and 1.7.

---

## Session 1 — Auth endpoint security fixes (`src/handler/auth-handler.ts`)

### 1.1 `/auth/me` leaks password hash and salt
- **Problem:** The endpoint returns the full authentication record. `password` and
  `passwordSalt` are included in the JSON response.
- **Where:** `src/handler/auth-handler.ts:295-308`
- **Fix:** Pass `select: ["email", "role"]` (plus id/timestamps come automatically) to
  `raw.findById`, keep `populate: { user: "*" }`. Never return `password`,
  `passwordSalt`, `resetToken`, `resetTokenExpiry`.

### 1.2 Register mass assignment through raw mode
- **Problem:** `...extraData` from the request body is spread into
  `datrix.raw.create(userSchemaName, userData)`. Raw mode skips the reserved-field check
  (`checkReservedFields` returns early when `isRawMode`), so a client can set `id`,
  `createdAt`, `updatedAt` on the new user record.
- **Where:** `src/handler/auth-handler.ts:66` (destructure), `:87-94` (create)
- **Fix:** Strip `id`, `createdAt`, `updatedAt` from `extraData` before building
  `userData`. Also strip the configured `userEmailField` key from `extraData` so a body
  like `{ email, name: "x", [emailField]: "other@x" }` cannot override the checked email.

### 1.3 Register is not transactional — orphan user on auth-record failure
- **Problem:** `raw.create` throws on failure (it never returns null), so the
  `if (!authRecord)` rollback branch is dead. If the authentication insert throws
  (e.g. unique email race), the already-created user row stays orphaned.
- **Where:** `src/handler/auth-handler.ts:117-127`
- **Fix:** Wrap the auth-record creation in `try/catch`; in `catch`, delete the created
  user (`datrix.raw.delete(userSchemaName, user.id)`) and rethrow. Keep the null check
  removed or as a defensive assert.

### 1.4 Login allows user enumeration via timing
- **Problem:** When no auth record matches the email, the handler throws immediately —
  measurably faster than the PBKDF2 verification path (100k iterations), letting an
  attacker probe which emails exist.
- **Where:** `src/handler/auth-handler.ts:187-204`
- **Fix:** When `authRecord` is null, run a dummy verification
  (`authManager.verifyPassword(password, dummyHash, dummySalt)` against a fixed
  precomputed hash) before throwing `authError.invalidCredentials()`.

### 1.5 `crypto.getRandomValues` global is not guaranteed on Node 18
- **Problem:** The reset-token generator uses the global `crypto` (WebCrypto). The global
  is only reliably present from Node 19+; `package.json` engines allows `>=18`.
- **Where:** `src/handler/auth-handler.ts:357-361`
- **Fix:** Use `randomBytes(32).toString("hex")` from `node:crypto` (already the pattern
  in `src/auth/session.ts:190`).

### 1.6 Logout is broken for JWT-only configurations
- **Problem:** Without a session cookie the endpoint returns 400 ("No session found");
  with a cookie but no session strategy, `authManager.logout` throws
  `SESSION_NOT_CONFIGURED`. JWT-only apps can never log out cleanly.
- **Where:** `src/handler/auth-handler.ts:253-259`, `src/auth/manager.ts:115-121`
- **Fix:** Logout should always succeed: if a sessionId exists AND the session strategy
  is configured, delete the session; otherwise skip. Always return 200 with the
  cookie-clearing `Set-Cookie` header. (JWT invalidation is client-side by design.)

### 1.7 Login must reject passwordless (empty-hash) accounts explicitly
- **Problem:** Per D3, synced accounts may have `password: ""`. Verification would fail
  anyway (length mismatch), but this must be an explicit, documented guard rather than
  an accident of `timingSafeEqual` semantics.
- **Where:** `src/handler/auth-handler.ts:196-204`
- **Fix:** Before verifying: `if (!authRecord.password || !authRecord.passwordSalt) throw
  authError.invalidCredentials()`. Add a code comment that passwordless accounts are
  activated via the reset flow.

---

## Session 2 — Plugin state & lifecycle correctness (`src/api.ts`)

### 2.1 Concurrent requests leak each other's identity (critical)
- **Problem:** The authenticated user is stored on the plugin instance
  (`public user`), written per-request by `api.setUser(ctx.user)` and read by
  `onCreateQueryContext`. Two concurrent requests interleave: request A's queries can run
  with request B's user (permission functions, `context.user`) — a data-access breach.
- **Where:** `src/api.ts:37`, `:48-50`, `:93-102`; `src/handler/unified.ts:279`
- **Fix:** Use `AsyncLocalStorage` (`node:async_hooks`) in `ApiPlugin`.
  `handleRequest` wraps the whole request handling in `als.run({ user: null }, ...)`;
  `setUser` writes into the ALS store; `onCreateQueryContext` reads from it. Keep the
  `setUser` method signature (core `IApiPlugin` contract) but back it with the ALS store.
  The plugin-level `user` field is removed.

### 2.2 `this.datrix` is undefined until the first HTTP request
- **Problem:** `datrixInstance` is only assigned inside `handleRequest`. The hooks
  (`onBeforeQuery`/`onAfterQuery` → `getTableName`, `createAuthenticationRecord`) call
  `this.datrix` — a cast of `undefined` — so any programmatic `datrix.create("user")`
  before the first HTTP request crashes with a TypeError inside the plugin.
- **Where:** `src/api.ts:38-42`, `:311`, `:88-91`, `:283`, `:291`
- **Fix (preferred):** Extend core `PluginContext` with the owning `Datrix` instance and
  set `this.datrixInstance` in `init()`. **Fallback if core must not change in this
  session:** guard the hooks — when `datrixInstance` is unset, log a clear warning and
  skip the sync (never crash the user's insert).

### 2.3 Bulk user insert only syncs the first row
- **Problem:** `onBeforeQuery` stores `query.data[0]` and `onAfterQuery` reads
  `result[0]`; inserting N users creates an auth record only for the first.
- **Where:** `src/api.ts:217-220`, `:248-257`
- **Fix:** Store the whole `query.data` array in metadata. In `onAfterQuery`, iterate the
  result rows, pair each row (by index) with its input data, and create one auth record
  per row.

### 2.4 Email-sync id extraction breaks on operator objects and non-id updates
- **Problem:** `query.where?.["id"]` may be `5`, `{ $eq: 5 }`, or absent (update by any
  other field). An operator object ends up nested as
  `{ user: { id: { $eq: { $eq: 5 } } } }`; non-id updates never sync. `userId` is also
  typed `string` while ids are numbers.
- **Where:** `src/api.ts:223-231`, `:260-264`, `:286-296`
- **Fix:** Don't extract from `where` at all. In `onAfterQuery`, take the updated rows
  from `result` (update returns the matched rows) and sync the auth email for each
  affected row id: `raw.updateMany(authSchema, { user: { id: { $in: ids } } }, { email })`.
  Type the id as `number`.

### 2.5 Plugin `destroy()` never releases AuthManager resources
- **Problem:** `destroy()` is empty. `AuthManager` owns a session-cleanup interval and
  the session store; they are never stopped/cleared on plugin teardown.
- **Where:** `src/api.ts:147`; `src/auth/manager.ts:219-229`
- **Fix:** `async destroy() { await this.authManager?.destroy(); }`

### 2.6 Auto-created auth record stores plaintext password and client-controlled role (critical)
- **Problem:** `createAuthenticationRecord` writes `password: user["password"] || ""`
  (raw plaintext from the insert payload) and `role: user["role"] || defaultRole` —
  so `POST /api/user` with `{ role: "admin" }` (when the user schema has a `role` field)
  mints an admin auth record, and any provided password is stored unhashed.
- **Where:** `src/api.ts:269-284`
- **Fix (per D3):**
  1. If the insert data carries a password, hash it: `const { hash, salt } = await
     this.authManager.hashPassword(pw)` and store `password: hash, passwordSalt: salt`.
  2. If no password: store empty `password`/`passwordSalt` (passwordless account,
     activated via reset flow — see 1.7).
  3. `role` is **always** `this.authConfig.defaultRole`; never read it from insert data.
  4. Skip creation (with a warning) if an auth record with that email already exists.

---

## Session 3 — Auth schema, reset flow, JWT/cookie hygiene

### 3.1 Generated auth schema is missing `resetToken` / `resetTokenExpiry` — reset flow is dead
- **Problem:** `getSchemas()` defines only `user/email/password/passwordSalt/role`, but
  `forgotPassword` selects and updates `resetToken`/`resetTokenExpiry` and
  `resetPassword` filters on `resetToken`. The query builder rejects unknown fields, so
  both endpoints always fail. (Core's `AuthenticatedUser` type already declares them.)
- **Where:** `src/api.ts:161-200` (schema); `src/handler/auth-handler.ts:342-351`,
  `:369-372`, `:408-411`, `:423-428` (usage)
- **Fix:** Add to the auth schema: `resetToken: { type: "string" }` and
  `resetTokenExpiry: { type: "date" }` (both optional). Add an index on `resetToken`.

### 3.2 Reset token stored in plaintext
- **Problem:** The reset token is a bearer credential; a DB leak lets an attacker reset
  any pending account's password.
- **Where:** `src/handler/auth-handler.ts:357-372` (store), `:408-411` (lookup)
- **Fix:** Store `sha256(token)` (hex) in `resetToken`; on reset, hash the presented
  token and look up by the hash. The raw token is only ever given to `onForgotPassword`.

### 3.3 Session cookie ignores session `maxAge` and lacks `Secure`
- **Problem:** `Set-Cookie` hardcodes `Max-Age=86400` in register and login while the
  session's real lifetime is `session.maxAge` (configurable) — the cookie can outlive or
  undercut the session. No `Secure` attribute is ever set.
- **Where:** `src/handler/auth-handler.ts:150`, `:227`, `:266` (logout clear)
- **Fix:** Build the cookie string in one helper: `Max-Age` = effective
  `session.maxAge ?? DEFAULT_API_AUTH_CONFIG.session.maxAge`; add `Secure` when
  `new URL(request.url).protocol === "https:"`. Keep `HttpOnly; Path=/; SameSite=Strict`.
  Use the same attributes (minus Max-Age) for the logout clearing cookie.

### 3.4 JWT signature is double-encoded — tokens are not standard JWTs
- **Problem:** `signData` computes `base64url(base64(hmac))`: the digest is first encoded
  as base64, then that *string* is base64url-encoded again. Sign/verify are internally
  consistent, but the tokens cannot be verified by any standard JWT library or debugger.
- **Where:** `src/auth/jwt.ts:218-223`
- **Fix:** `return hmac.digest("base64url")`. This invalidates previously issued tokens —
  acceptable at 0.1.x; note it in the changelog.

### 3.5 `parseExpiry` silently defaults invalid config to 3600
- **Problem:** A typo like `expiresIn: "1w"` silently becomes 1 hour instead of failing.
- **Where:** `src/auth/jwt.ts:277-298`
- **Fix:** Throw a `DatrixAuthError` (config error) from the constructor when the string
  doesn't match `/^(\d+)([smhd])$/`.

### 3.6 (Low) `role` column is a free string
- **Problem:** The auth schema's `role` field accepts any string; nothing ties it to
  `config.roles`.
- **Where:** `src/api.ts:182-186`
- **Fix:** Keep the column a string (roles may change without migration), but validate
  `role ∈ config.roles` when building the auth context; unknown roles are treated as
  `defaultRole` with a logged warning.

---

## Session 4 — Authenticated user resolution (decision D1)

### 4.1 `ctx.user` must carry the populated user record
- **Problem:** `AuthUser.id` is the authentication record id, while FK columns
  (`authorId` etc.) reference the **user** table — permission functions comparing
  `ctx.user.id === record.authorId` are silently wrong. Additionally the JWT path fills
  `email: ""` and trusts the token's possibly-stale `role`.
- **Where:** `src/auth/manager.ts:126-164` (authenticate builds user from token/session
  only); `src/middleware/context.ts:110-114`; `src/api.ts:93-102`
- **Fix (per D1):**
  1. After token/session verification in `buildRequestContext`, fetch the auth record
     once: `raw.findById(authSchemaName, authUser.id, { select: ["email", "role"],
     populate: { user: "*" } })`.
  2. Extend `AuthUser` (core type) with `user?: DatrixRecord` — the populated user row.
  3. `ctx.user` gets `{ id: authRecord.id, email: authRecord.email, role:
     authRecord.role, user: authRecord.user }` — email/role come from the DB, not the
     token, so role changes apply immediately.
  4. `/auth/me` (1.1) reuses the same shape.
  5. Document that FK comparisons in permission functions use `ctx.user.user.id`.
- **Note:** This adds one DB query per authenticated request. Acceptable now; if it ever
  matters, add an optional small TTL cache keyed by auth id.

---

## Session 5 — Default permission hardening (decision D2)

### 5.1 Undefined permission means fully open — including anonymous writes
- **Problem:** `evaluatePermissionValue(undefined) → true`. With auth enabled but no
  `schema.permission` and no `defaultPermission`, anonymous clients can
  create/update/delete everything.
- **Where:** `src/middleware/permission.ts:60-63` (undefined → allow),
  `:120-147` (checkSchemaPermission)
- **Fix (per D2):** In `checkSchemaPermission` only — when the resolved
  `permissionValue` is `undefined`: allow if `action === "read"`; otherwise require
  `ctx.user !== null`. Field-level semantics (undefined = allow) stay unchanged.
  Update the JSDoc on `ApiConfig.auth`/`DefaultPermission` and README to state the new
  default. Mark as behavior change in the changelog.

---

## Session 6 — Routing & config wiring

### 6.1 `defaultPageSize` / `maxPageSize` / `maxPopulateDepth` config is silently ignored
- **Problem:** `buildRequestContext` calls `parseQuery(queryParams)` with no options, so
  the parser always uses its own defaults (25/100/5); `handleGet` also hardcodes
  `pageSize ?? 25`. The three `ApiConfig` options do nothing.
- **Where:** `src/middleware/context.ts:132-134`; `src/handler/unified.ts:63-67`;
  `src/types.ts:49-65` (the promised options)
- **Fix:** Thread the plugin config through `ContextBuilderOptions` (or read it from
  `api` inside `buildRequestContext`) and pass `{ defaultPageSize, maxPageSize,
  maxPopulateDepth }` to `parseQuery`. In `handleGet`, use the configured
  `defaultPageSize` instead of the literal 25.

### 6.2 Non-numeric id is treated as a list request
- **Problem:** `extractIdFromPath` returns `null` for `/api/user/abc` (so GET returns the
  whole list instead of 404) and `parseInt` accepts partial numbers: `/api/user/12abc`
  → id 12. Extra segments (`/api/user/1/whatever`) are silently ignored.
- **Where:** `src/middleware/context.ts:45-55`
- **Fix:** If a second path segment exists, require it to match `/^\d+$/`; otherwise
  throw `handlerError.recordNotFound` (404). If a third segment exists (and the route is
  not the upload route), throw 404 as well.

### 6.3 `isAuthPath` guesses a single prefix from the endpoint list
- **Problem:** The auth prefix is derived from the first segment of whichever endpoint
  happens to be defined first. Custom endpoints with mixed prefixes (e.g.
  `login: "/session/login"`, `register: "/users/register"`) make some auth routes fall
  through to the CRUD handler.
- **Where:** `src/api.ts:343-358`
- **Fix:** Build the set of six effective endpoint paths (config value or default) and
  return true when `pathAfterPrefix` exactly equals one of them. Keep the `/auth/...`
  prefix match as an additional fallback so unknown `/auth/x` paths still get the auth
  handler's 404 instead of a confusing "schema not found".

### 6.4 `excludeSchemas` compares model names against table names
- **Problem:** The getter appends `"_datrix"`, `"_datrix_migrations"` (table names) and
  the check uses `ctx.schema.name` (model name). User-supplied entries only work if they
  happen to be model names; the docs say "schemas".
- **Where:** `src/api.ts:80-86`; `src/handler/unified.ts:261`
- **Fix:** Check both: `excludeSchemas.includes(ctx.schema.name) ||
  excludeSchemas.includes(ctx.schema.tableName)`. Document that entries may be either.

### 6.5 Prefix mismatch returns 500 "Invalid API prefix"
- **Problem:** A request outside the API prefix produces an internal-error (500) response
  with a message aimed at the developer, not a 404.
- **Where:** `src/api.ts:316-320`
- **Fix:** Return a 404 `DatrixApiError` (e.g. code `ROUTE_NOT_FOUND`) instead of
  `internalError`.

### 6.6 Malformed JSON body is silently swallowed
- **Problem:** `request.json()` failures set `body = null`; the user later gets a generic
  "Invalid request body" with no hint the JSON didn't parse.
- **Where:** `src/middleware/context.ts:136-147`
- **Fix:** Catch the parse error and throw `handlerError.invalidBody("Malformed JSON")`
  directly from the context builder (the unified handler already converts it to 400).

---

## Session 7 — Field-permission depth

### 7.1 Populated relation records bypass the target schema's field permissions
- **Problem:** `filterFieldsForRead` only evaluates the top-level schema's fields. A
  populated relation (e.g. `populate=author`) returns the target record wholesale —
  read-restricted fields of the related schema (e.g. `user.email`) leak.
- **Where:** `src/middleware/permission.ts:157-197`; used from
  `src/handler/unified.ts:49-58`, `:81-85`
- **Fix:** In `filterFieldsForRead`, when `fieldDef.type === "relation"` and the value is
  an object/array, resolve the target schema via `ctx.datrix.getSchema(fieldDef.model)`
  and recursively filter each populated record. Recursion depth is naturally bounded by
  the populate depth limit.

### 7.2 Nested relation create/update payloads bypass field write permissions
- **Problem:** `checkFieldsForWrite` iterates only top-level body keys. A body like
  `{ posts: { create: [{ secretField: 1 }] } }` writes to the related schema without its
  field-level write permissions being checked.
- **Where:** `src/middleware/permission.ts:206-241`
- **Fix:** When a checked field is a relation and its value contains `create`/`update`
  payloads, recursively run the same check against the target schema's fields for each
  nested data object.

---

## Session 8 — Cleanups & minor fixes

### 8.1 `ContextBuildError` is dead code
- **Where:** `src/middleware/context.ts:60-68`; exported at `src/middleware/index.ts:7`
- **Fix:** Parsers throw `ParserError` directly; the wrapper is never constructed.
  Remove the class and its export.

### 8.2 `src/helper/types.ts` is an unused legacy file
- **Where:** `src/helper/types.ts` (whole file)
- **Fix:** It duplicates `RequestContext`, `ContextBuilderOptions`, `HttpMethod` with
  shapes that conflict with `src/middleware/types.ts`, and nothing imports or re-exports
  it. Delete the file.

### 8.3 `isSessionData` validates `userId` as string
- **Where:** `src/auth/types.ts:262` (`typeof obj["userId"] === "string"` vs
  `SessionData.userId: number` at `:46`)
- **Fix:** Check `typeof obj["userId"] === "number"`.

### 8.4 `MemorySessionStore.get` has a pointless try/catch with a wrong error code
- **Where:** `src/auth/session.ts:208-221`
- **Fix:** `Map.get` cannot throw; remove the try/catch (and its misleading
  `SESSION_CREATE_ERROR`).

### 8.5 Duplicate, fragile cookie parsing
- **Where:** `src/handler/utils.ts:72-78` (regex `sessionId=([^;]+)` also matches
  `mysessionId=`) and `src/auth/manager.ts:181-200` (split-based parser)
- **Fix:** Keep one shared cookie parser (the split-based one, hardened to trim and to
  match the exact cookie name) and use it in both places.

### 8.6 `serializeWhere` stringifies Dates unparseably
- **Where:** `src/serializer/query.ts:124`, `:140`, `:146-147`
- **Fix:** `String(date)` produces `"Fri Jul 12 2026 ..."` which no parser accepts.
  Serialize `Date` values with `.toISOString()` (in both the `$in/$nin` branch and the
  scalar branch).

### 8.7 Dead parser options
- **Where:** `src/parser/query-parser.ts:28-34` (`allowedOperators`, `strictMode` in
  `DEFAULT_OPTIONS` are never consulted by any parser)
- **Fix:** Remove them from the options type/defaults (or implement them — removal
  preferred until a real use case exists).

### 8.8 Auth handler is rebuilt on every request
- **Where:** `src/api.ts:363-383`
- **Fix:** `createUnifiedAuthHandler` is pure configuration; build it lazily once and
  cache it on the plugin instance (invalidate only if prefix/config could change — it
  cannot after init).

### 8.9 `getTableName` fallback duplicates (and mismatches) core pluralization
- **Where:** `src/api.ts:88-91`
- **Fix:** The registry always sets `tableName` (see core contract §6); the
  `${schemaName.toLowerCase()}s` fallback can disagree with core's pluralizer. Drop the
  fallback and treat a missing schema as an error.

### 8.10 Register/login duplicate the login-response + cookie block
- **Where:** `src/handler/auth-handler.ts:137-155` vs `:214-232`
- **Fix:** Extract a `loginResponse(authUser, loginResult, status)` helper (also the
  natural home for the cookie fix in 3.3).

---

## Session 9 — HTTP `QUERY` method support (feature, enabled by default)

Decision: support the IETF `QUERY` HTTP method (safe method with a request body) as a
first-class read endpoint, **enabled by default**. Frameworks that cannot export the
method yet (Next.js App Router) are expected to gain support; until then the POST alias
below is the portable path.

### 9.1 Accept read queries with a JSON body
- **Problem:** Complex queries must be encoded in the bracket query-string syntax
  (`where[price][$gt]=100...`) — verbose, error-prone, subject to URL length limits, and
  unable to express populate-level `where`/`limit`/`orderBy` at all.
- **Where (new wiring):**
  - `src/middleware/types.ts:17` — add `"QUERY"` to `HttpMethod`.
  - `src/middleware/permission.ts:246-260` — `methodToAction("QUERY") → "read"`.
  - `src/handler/unified.ts:281-294` — route `QUERY` (and the POST alias) to a new
    `handleQuery(ctx)` that reuses the `handleGet` list logic (find + count + permission
    filtering + pagination meta).
  - `src/middleware/context.ts:96-107` — route/id extraction; `:136-147` — body parsing.
- **Design:**
  1. `QUERY /api/:model` with body `{ select?, where?, populate?, orderBy?, page?,
     pageSize? }` — the same shape `parseQuery` produces (`ParsedQuery`). No bracket
     parsing involved; values arrive natively typed.
  2. Alias: `POST /api/:model/query` maps to the exact same handler for runtimes/proxies
     that drop unknown methods. Document both; the alias is not deprecated until `QUERY`
     support is ubiquitous.
  3. Response shape is identical to `GET` list responses (`{ data, meta }`).

### 9.2 Implementation caveats (must all be handled)
1. **Body validation is NOT free:** the bracket parser enforced limits that core's query
   builder does not. The body query must be validated by a dedicated
   `validateQueryBody()` before reaching `datrix.findMany`:
   - whitelist top-level keys (`select`, `where`, `populate`, `orderBy`, `page`,
     `pageSize`) — reject unknown keys like `detectUnknownParams` does
     (`src/parser/query-parser.ts:219-233`);
   - `page`/`pageSize` must be positive integers; enforce `maxPageSize` and the
     1,000,000 page cap (`src/parser/query-parser.ts:95-137` logic reused);
   - enforce `MAX_WHERE_VALUE_LENGTH` on string values and
     `MAX_LOGICAL_NESTING_DEPTH` on `$and/$or/$not` nesting (JSON bodies can nest far
     deeper than query strings; core's builder caps depth at 10 but validate early for a
     clean 400);
   - enforce `maxPopulateDepth` on nested populate.
2. **Populate-level `where`/`orderBy` is not validated by core** (core issue 1.11 —
   field names pass through to adapters unchecked; identifier escaping is the only
   safety net). Before allowing `populate[rel].where` from an HTTP body, run
   `validateFieldName` on every field key recursively (same check the where-parser does
   at `src/parser/where-parser.ts:83-89`). Do not skip this — it is the API's trust
   boundary.
3. **Route conflict with id extraction:** `/api/user/query` must be recognized as the
   alias route, not as an id. Reserve `query` as a sub-resource segment in
   `extractIdFromPath`/route resolution — coordinate with issue 6.2 (which makes
   non-numeric second segments a 404; `query` must be the exception).
4. **Body parsing scope:** `buildRequestContext` only reads bodies for
   `POST/PATCH/PUT` (`src/middleware/context.ts:138`). Include `QUERY`; for the alias,
   the body is the query — make sure it is not interpreted as insert data
   (`handlePost` must never see it).
5. **Precedence:** if both a query string (`?where[...]=`) and a body query are present,
   reject with 400 (ambiguous) rather than merging — predictable behavior beats silent
   precedence rules.
6. **Method plumbing end-to-end:**
   - `methodNotAllowed` default branch must not swallow `QUERY`;
   - `toWebRequest` (`src/helper/index.ts:66`) already allows bodies on non-GET/HEAD —
     verify `QUERY` passes through;
   - some Node versions/proxies reject unknown methods at the HTTP-parser level before
     user code runs — this is exactly why the POST alias exists; document it.
7. **Permissions:** `QUERY` maps to `read`, so `checkSchemaPermission` (with the D2
   default) and `filterRecordsForRead`/`filterFieldsForRead` (including Session 7
   recursive filtering) must run on the results exactly as in `handleGet`.
8. **Type coercion:** JSON bodies carry native numbers/booleans, but dates arrive as ISO
   strings — core's builder coerces by field type (contract §1), so do not add local
   date parsing. `$in: []` and empty `$and/$or` arrays must be rejected in
   `validateQueryBody` (parser parity: `whereError.emptyArrayOperator` /
   `emptyLogicalOperator`).
9. **No write-path side effects:** the resulting query is `type: "select"`; the user-sync
   hooks in `src/api.ts:206-235` key off insert/update and are unaffected — keep it that
   way (never route QUERY bodies through `create`/`update` helpers).
10. **Client symmetry (backlog):** `serializeQuery` exists for GET query strings; for
    QUERY the body IS the `ParsedQuery`, so no client-side serializer is needed — note
    this in the README so users don't double-encode.

---

## Backlog / enhancements (not defects)

- **Populate options are not expressible via query string:** `PopulateOptions` supports
  `where`, `limit`, `offset`, `orderBy`, but `src/parser/populate-parser.ts` only parses
  `fields` and nested `populate`. Session 9's body queries cover this natively; extending
  the bracket syntax (`populate[rel][where][...]`, `populate[rel][limit]`) remains
  optional for GET.
- **PUT vs PATCH are identical (both partial update):** `src/handler/unified.ts:286-288`.
  Either implement PUT as full replace or document the deviation from REST semantics.
- **Bulk create over HTTP is rejected** (`handlePost` requires a single object,
  `src/handler/unified.ts:115-117`). If bulk insert should be exposed, accept arrays and
  reuse the executor's bulk path.
