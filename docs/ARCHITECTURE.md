# Architecture (Phase 1 implemented; later feature phases remain planned)

The Phase 1 cross-cutting foundation is implemented and Gate G-1 verified. This document also defines the target module shape for Phases 2–6. The foundation satisfies spec §3 through thin route/action boundaries and actor-aware services; larger feature domains will add the repository split shown below as their schemas arrive.

## 1. Modules and boundaries

```
UI (src/app + src/components)
   │  fetch to /api/v1/*  (Zod-validated, typed client helpers in src/lib/http)
   ▼
API handlers (src/app/api/v1/**/route.ts)      ← thin: parse+validate, call service, map errors
   │  actor context (session user, roles, permissions)
   ▼
Domain services (src/lib in Phase 1; src/server/<module>/service.ts as domains grow)
                                                ← business rules, transactions, authorization
   │
   ├── Repositories (src/server/<module>/repository.ts) ← the ONLY place that touches SQL
   │        ▼
   │   Drizzle ORM → better-sqlite3 → data/app.db  (WAL)
   │
   └── Cross-cutting: audit, activity, notifications, jobs (enqueue), email, search

Worker (src/worker)  → job handlers (email.deliver, onedrive.sync, asset.thumbnail, reminder.scan, maintenance.*)
External adapters (src/server/onedrive, src/server/email)  ← behind provider interfaces, injectable mocks in tests
```

Rules enforced by lint/review:

1. UI never imports repositories; services never import UI.
2. Every service function receives an explicit `Actor` and returns authorization-filtered data. No "get by id without owner check".
3. Only `route.ts` files parse HTTP. Phase 1 SQL is encapsulated in actor-aware `src/lib` services; new multi-entity feature domains split SQL into `repository.ts` modules as shown above.
4. External systems (Graph, SMTP) are only reachable through adapters with a mock implementation used by tests.

## 2. Request/authorization flow

```
request → session cookie verified → rate limit check → requirePermission('event:write')
        → handler validates body/query with Zod → service.execute(actor, input)
        → service loads resource scoped by actor (owner or explicit grant) → transaction write
        → audit.log + activity.record → response (201/204/400/403/404/409/429)
```

Authorization model:

- `roles` → `role_permissions` (permission keys like `event:read_own`, `event:read_all`, `user:manage`, `settings:smtp:read`)
- `resource_permissions` for explicit sharing (`resource_type`, `resource_id`, `grantee_user_id`, `level: read|write`)
- Ownership is a column on every user-owned table (`owner_user_id`) and is always part of the query predicate, so an unguessable/other-user ID yields 404 (no existence leak), while unauthorized-but-existing IDs of shared resources yield 403 where disclosure is safe.
- UI hiding of controls is cosmetic only; tests assert the server rejects regardless.

## 3. Data design principles

- All timestamps stored UTC in ISO-8601 `TEXT`; each user-owned record carries/derives a timezone for rendering and scheduling (`Asia/Jerusalem` default).
- No SQLite-only constructs in business queries (no `datetime('localtime')`, no `AUTOINCREMENT`-dependent logic); portable through Drizzle dialects so Postgres remains a swap.
- Versioned Drizzle migrations in `drizzle/`, committed, generated → reviewed (never blind-accepted).
- Indexes declared explicitly with the query patterns they serve (owner+date ranges, status+due, tag lookups, FTS5 for search).
- Secrets (Graph tokens, MFA TOTP secrets) stored encrypted (AES-256-GCM, key version prefix) in dedicated columns; password hashes Argon2id; recovery codes hashed; nothing secret in `audit_logs`.

Core entity groups (full table list in spec §13, planned mapping):

| Group        | Tables                                                                                                                                                                                                            | Phase |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| Identity     | users, sessions, accounts, verify_tokens (auth lib), profiles, roles, permissions, role_permissions, user_roles, resource_permissions, mfa_credentials, recovery_codes, user_preferences, rate_limits, audit_logs | 1     |
| Calendar     | events, event_participants, event_recurrence_rules, event_exceptions                                                                                                                                              | 2     |
| Work         | projects, project_members, tasks, task_history, task_notes                                                                                                                                                        | 2     |
| Shared       | tags, tag_links, activity_log                                                                                                                                                                                     | 2     |
| Assets       | assets, asset_variants, asset_metadata_extracted, asset_metadata_provider, collections, collection_items, asset_sources                                                                                           | 4     |
| Integrations | onedrive_connections, onedrive_folders, sync_jobs, sync_states                                                                                                                                                    | 5     |
| Messaging    | jobs, job_runs, schedules, reminder_schedules, notifications, email_delivery_attempts                                                                                                                             | 3     |

## 4. Background processing design (single VPS, no Redis)

`jobs(id, type, payload_json, run_at, status[queued|running|succeeded|failed|cancelled], attempts, max_attempts, backoff_until, dedupe_key UNIQUE, locked_by, lease_expires_at, priority, created_at, updated_at, last_error)`

- Claim: `BEGIN IMMEDIATE` → select due unclaimed (`status='queued' AND run_at<=now AND (lease_expires_at IS NULL OR lease_expires_at<now)`) → set `locked_by`, `lease_expires_at = now + lease` → commit → execute outside the transaction.
- Heartbeat extends lease for long jobs (Graph folder scans).
- On startup: any `running` job with expired lease → `queued` (attempt retained) — this is the restart-recovery path.
- `dedupe_key` prevents double scheduling (e.g. same reminder offset for the same occurrence).
- `schedules` table holds recurring system work (`reminder.scan` every 60s, `onedrive.delta` per configured folder, `maintenance.checkpoint`, `dashboard.stats.invalidate`) with `next_run_at`; only the single worker runs schedules (worker lock row `worker_lock(id=1, holder, heartbeat)` guards multi-instance duplication).
- Retries: exponential backoff with jitter (`base * 2^attempt`, capped), max attempts, permanent failure → `failed` + notification to admins where configured.
- Manual retry exposed in admin UI. Job status visible in admin settings.

Worker shutdown: stop claiming → finish in-flight (bounded grace) → release leases → close DB. `SIGTERM` handled; queued rows stay in SQLite.

## 5. Reminder pipeline

```
event/task saved or edited
  → reminder planner: resolve offsets (user default ← item override)
  → delete pending reminder_schedules for the item/occurrence
  → insert new pending rows with computed fire_at UTC (unique(item, occurrence_key, offset))
worker: reminder.scan
  → select fire_at <= now AND status='pending' (transaction) → mark 'queued' + enqueue email.deliver + notification.create
worker: email.deliver
  → render HTML+text → SMTP send → attempt row (success/failure, sanitized error) → mark schedule 'sent'
  → failure → job retry with backoff; final failure → admin-visible notification record
```

Recurring events: occurrences materialized for a rolling horizon (e.g. 60 days ahead) by a scheduled job, so a daily recurring event never creates unbounded rows; editing a single occurrence re-plans only that occurrence (`occurrence_key`).

Overdue policy (to be documented in `docs/` at Phase 3): overdue tasks produce at most N digest reminders per item; past events are not reminded; behaviour admin-configurable.

## 6. OneDrive integration design

- `IntegrationProvider` interface: `connect`, `disconnect`, `status`, `listChildren`, `getItem`, `getThumbnail`, `deltaSync`. OneDrive is one implementation; Google Drive/NAS become other implementations without schema change.
- Flow: user clicks connect → server creates stateful redirect (random state stored server-side) → Microsoft consent → callback exchanges code → tokens encrypted into `onedrive_connections` (per user) → browser only ever sees "connected / account name / status".
- Scopes: `offline_access Files.Read` (read-only). Write scopes are not requested in v1 (spec §10).
- Sync job per selected folder: paginated `children` (handles `@odata.nextLink`), filter supported media, upsert `assets` by `(provider, account, remote_id)`, fetch thumbnails into permission-isolated cache path, store `deltaLink` + `lastRunAt` in `sync_states`, resume from checkpoint after crash, honor `Retry-After` on 429, cap concurrency (per-user and global).
- Metadata separation: extracted-from-file vs provider-reported stored in distinct structures with provenance, so the UI can label sources and absent values stay absent.
- No remote rename/move/delete in v1. Future: proposal tables (`change_proposals`) with preview-and-approve — schema space reserved, feature not built.

## 7. Asset design

`assets` = logical asset (identity + organization + status), `asset_sources` = where the bytes live (provider/account/remoteId or local path), `asset_variants` = derived thumbnails/previews with cache policy. Originals are never modified (upload and read-only scan only). Collections/albums/tags are pure metadata joins. Thumbnail serving goes through an authenticated route that checks actor↔asset permission before streaming bytes (no public cache directory).

## 8. Frontend design

- Next App Router, server components for page shells and initial data; client components for interactive views (calendar drag/drop, kanban, filters, bulk edit).
- Server-side pagination + filtering as the default (URL-driven state, shareable/bookmarkable), TanStack Table/Virtual for large lists.
- Layout (RTL-first, amendment A-2): collapsible sidebar — on the **right** in RTL, mirrored when the user switches to English — compact bottom/drawer nav on mobile, command-style global search, light/dark themes via CSS variables. Only logical properties (`margin-inline`, `padding-inline`, `text-align: start`, `ps/pe`) are allowed anywhere in the codebase, so RTL is a single `dir` attribute on `<html>` rather than a second stylesheet or a forked layout.
- Every list has explicit loading / empty / error states; destructive actions require confirm dialogs; all mutations surface toasts.
- i18n: **Hebrew is the primary UI language, English the secondary one** (spec §4 as amended). `src/i18n/` holds typed dictionaries — `he` is the source of truth for the key shape, every other locale is typed against `Dictionary` (derived from `he`), so an unfinished translation fails the build instead of falling back silently. Locale resolution is server-side and total: signed-in user preference (Phase 1) → `pmd_locale` cookie → `DEFAULT_LANGUAGE` → `he`. `<html lang dir>` is set from that result before any markup is sent, so there is no client-side language flip and no flash of the wrong language.
- Strings vs data: only presentation strings are translated. Measured values (file paths, hosts, SQLite pragma names, enum codes such as `not_installed`, ISO timestamps, versions) are rendered as **LTR islands** (`dir="ltr"` + `unicode-bidi: isolate`) with the raw code also exposed as `data-value`, so an RTL layout never reorders or reinterprets a fact, and tests can assert the machine value even when the visible label is localized.
- Language switch is a server action behind a plain `<form method="post">` (works with JavaScript disabled and under the production CSP), returning a validated same-origin path only. Locale values are validated against the supported set before they can reach the DOM or the cookie jar.

## 9. Error, logging and observability

- Structured JSON logger with levels, request ids, and a redaction layer (keys matching `*secret*|*token*|*password*|*authorization*` are never serialized).
- API errors are a stable envelope: `{ error: { code, message, requestId }, details? }`; unexpected errors are mapped to 500 with no stack trace in production; DB constraint violations mapped to 409/400 deliberately.
- Health endpoints: `/api/v1/health` (db read + migrations-at-head check + worker heartbeat freshness) used by Docker healthchecks and Caddy.

## 10. Testing seams built into the design

- `ADAPTER_MODE=fake|real` (or test-only DI) for SMTP and Graph so integration tests run against in-repo record/replay fakes — no credentials needed for local dev or CI.
- Test DB isolation: per-suite temp SQLite file in WAL mode with the same pragmas as production (so concurrency bugs are reproducible in tests).
- Every phase gate has an executable `npm run verify` subset; `PROGRESS.md` records the real command output, not a claim.

## 11. Known open decisions (to be closed by spikes, recorded as ADRs)

| Decision                                                               | Spike                                                                                                                                                                |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Better Auth MFA/admin plugin viability vs own TOTP layer               | Phase 1.1 → `docs/adr/0001`                                                                                                                                          |
| `rrule` expansion + exception model details (series editing semantics) | Phase 2.3 → `docs/adr/0002`                                                                                                                                          |
| msal-node client type + Graph access via SDK vs typed fetch            | Phase 5.1 → `docs/adr/0003`                                                                                                                                          |
| HEIC and video metadata capability (libvips build, ffprobe presence)   | Phase 4.2 → `docs/adr/0004`                                                                                                                                          |
| i18n layer: first-party typed dictionaries vs `next-intl`              | **closed 2026-11-22** (amendment A-2): dictionaries shipped in `src/i18n/`, `next-intl` dropped; revisit only if locale-prefixed routes are wanted → `docs/adr/0005` |
| Dashboard aggregate caching (TTL cache vs materialized stats)          | Phase 2.10 → `docs/adr/0005`                                                                                                                                         |
