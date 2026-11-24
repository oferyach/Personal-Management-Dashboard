# ADR-0001 — Auth: Better Auth owns every credential and session row

Status: **accepted** (closed by the Phase 1.1 spike, 2026-11-22).
Closes the open decision "Better Auth MFA/admin plugin viability vs own TOTP layer" from
`docs/ARCHITECTURE.md` §11. Referenced from `src/lib/auth.ts`, `src/lib/betterAuthCall.ts`,
`src/lib/accountSecurity.ts`, `src/lib/adminBootstrap.ts`.

## Context

Spec §12 requires: Argon2id password hashing, session cookies with rotation, TOTP two-factor
with backup/recovery codes, ban/banishment, rate limiting on credential attempts, and custom
security flags on the user record. `docs/PLAN.md` §2 offered three candidates — Better Auth,
Auth.js v5, hand-rolled — plus a fallback (own `mfa_credentials`/`recovery_codes` tables over
`otplib`).

Hand-rolling is forbidden by the spec ("no homemade crypto"), and the failure modes that matter
are exactly the ones a library hides: which SQLite row it writes, which cookie it rotates, what
it does when a second factor is enrolled but unproven. So this decision had to be made by
measurement, not by reading docs.

## The spike (work item 1.1)

`tests/integration/authSpike.test.ts` runs the real library (`better-auth` **1.7.27**) through the
real app handler (`src/app/api/auth/[...all]/route.ts`) against a real SQLite file produced by our
own migrations (`tests/helpers/testDb.ts`). Every row below is an assertion of what was found, not
a presupposition.

| Probe                                                                                                      | Measured outcome                                                                                                                                                                                             | Consequence                                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| sign-up / sign-in against our seeded tables                                                                | the library writes into our Drizzle tables: `users`, `sessions`, `accounts` (the Argon2id PHC hash lives in `accounts.password`), `two_factor` (secret + backup codes), `verifications`, `rate_limit`        | the schema is library-shaped (`src/db/schema/auth.ts`); `src/db/schema/identity.ts` adds only project columns (`role`, `must_change_password`, `banned`…) |
| Argon2id hash hook                                                                                         | the library calls our `@lib/crypto` Argon2id (parameters printed in the install log)                                                                                                                         | no second KDF, no bcrypt fallback                                                                                                                         |
| password sign-in for an enrolled user                                                                      | **no session is issued**; a signed `pmd.two_factor` challenge cookie (~10 min) carries the pending step; the session exists only after the TOTP verifies                                                     | `/two-factor/verify` renders without a session; `ActionContext.state` for that user is `mfa_required`, not `authenticated`                                |
| enrollment generated but not confirmed                                                                     | `two_factor.verified = false` until the user proves the scan                                                                                                                                                 | `pendingMfaEnrollment()` is a real, rendered state with its own cancel form                                                                               |
| `disableTwoFactor`, `revokeSessions`, `revokeUserSessions`, `generateBackupCodes` called with headers only | `400 [body] Invalid input` — the client types require a body                                                                                                                                                 | one cast helper, `asBodyCall` in `@lib/betterAuthCall`, pinned by a unit test                                                                             |
| cookie rotation                                                                                            | `/two-factor/disable` issues a new `pmd.session_token`; `/revoke-sessions` issues empty `pmd.session_token`, `pmd.session_data`, `pmd.dont_remember`; `/two-factor/enable` and `/change-password` issue none | a server action must hand the response headers back, or the browser keeps a dead cookie — this is why actions return headers, not just a status           |
| cookie names                                                                                               | `pmd.session_token`, `pmd.session_data`, `pmd.two_factor` from `cookiePrefix: "pmd"` (`src/lib/auth.ts`)                                                                                                     | `requestAuth.ts` clears owned cookies by name, never by wildcard                                                                                          |
| repeated wrong passwords                                                                                   | after the configured limit the account locks and the library answers `TOO_MANY_REQUESTS`                                                                                                                     | login lockout is a library feature asserted, not reimplemented                                                                                            |
| session cookie flags                                                                                       | `HttpOnly`, `SameSite`, `Secure` (production https flag) as configured                                                                                                                                       | tests assert the flags on the `Set-Cookie` header rather than re-setting them                                                                             |

## Decision

1. **Better Auth owns every credential, session, MFA-secret and recovery-code row.** Application
   code never writes those rows; it calls `auth.api.*` and forwards the library's own cookies by
   name (`pmd.session_token`, `pmd.session_data`, `pmd.two_factor`, `pmd.dont_remember`). The only
   identity columns written directly are project-owned ones (`must_change_password`, and `role`
   during bootstrap) plus audit rows.
2. **No hand-rolled TOTP in production.** The only TOTP generator in the repository is
   `tests/helpers/totp.ts` (RFC 6238), which exists to prove the library matches the standard and
   that the `otpauth://` URI carries the secret the factor was built from.
3. **Library quirks are adapted once**, not per call site: `src/lib/betterAuthCall.ts` (`asBodyCall`
   for the measured typing gap) and `src/lib/actionError.ts` (`noticeForAuthError` maps status and
   `APIError.code` — which can be a number or an HTTP reason phrase — onto the 17 stable `?notice=`
   codes pinned by `tests/unit/actionError.test.ts`). Library error objects never reach UI strings.
4. **Bootstrap does not use `auth.api.setRole`.** That call needs an existing privileged session and
   at bootstrap there is none, so `adminBootstrap.ts` creates the credential through the library's
   own `/sign-up/email` (Argon2id, rate-limited) and writes the single `role` column directly. That
   write is audited as such and is the deliberate exception — it is not a credential or session row.
5. **RBAC stays ours** (`roles`, `permissions`, `role_permissions`, `resource_permissions`). The
   library's built-in role tables are not used for authorization; every decision lives in
   `src/lib/rbac.ts` and `src/lib/actionGuard.ts`, so the auth library can never be the reason a
   privileged action is allowed.
6. **Secrets never enter the durable store or the URL.** `otpauth://` URIs and backup codes exist
   only in `src/lib/oneShot.ts` for one render; Better Auth keeps the durable copies encrypted
   (AES-256-GCM under `APP_ENCRYPTION_KEY`) and hashed.

## Rejected

- **Auth.js v5** — weaker account-management story (ban/banishment, session listing, admin revoke).
- **Own `mfa_credentials`/`recovery_codes` over `otplib`** — the fallback in `docs/PLAN.md` §2; never
  needed once the spike showed the library's factor layer works with our tables and our Argon2id
  hooks.
- **Hand-rolled cookies/crypto** — forbidden by spec §12 and unreproducible against real rotation.

## Still open (deliberately)

- Fingerprinting (IP, UA) of sessions is the library's design; our tests assert the cookie flags and
  the observed rotation, not the internals.
- Rate-limit constants are environment-tunable; only the observable outcome (locked vs. refused) is
  asserted in tests.
