---
"@datrix/core": patch
"@datrix/api": patch
"@datrix/adapter-json": patch
---

Add password reset flow to auth system, fix WhereClause optional fields, update adapter-json readme

- `AuthenticatedUser` extended with `resetToken` and `resetTokenExpiry` fields
- `AuthConfig` now accepts a second generic `TUser extends DatrixEntry` for typed user population in callbacks
- `AuthConfig.passwordReset` block added: `tokenExpirySeconds` and `onForgotPassword` callback
- `DEFAULT_API_AUTH_CONFIG` updated with `forgotPassword` and `resetPassword` endpoint defaults
- `WhereClause` fix: optional scalar fields (`field?: string`) no longer resolve to `never` in typed where clauses
- New endpoints: `POST /auth/forgot-password` and `POST /auth/reset-password`
- `AuthManager` and `AuthHandlerConfig` updated with `TUser` generic
- `@datrix/adapter-json` README updated
