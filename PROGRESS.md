# PROGRESS LOG — Personal Management Dashboard

Living log of what has been done, what was actually verified, and what is waiting.
Rules: nothing is marked `DONE` unless the listed command/test was actually executed with the result recorded here. A phase gate never advances without your approval.

Legend: `NOT_STARTED` · `PLANNED` · `IN_PROGRESS` · `VERIFIED` (tests executed & green) · `AWAITING_APPROVAL` · `BLOCKED` · `DONE (approved)`

---

## Current state

**Phases 0 and 1 are APPROVED. Phase 2 is running as small local-AI packets: packets 2A and 2B are VERIFIED and await approval.** Your answers are recorded in `docs/PLAN.md` §12.1 and in the decisions log below: Hebrew stays the default with English selectable, timezone `Asia/Jerusalem`, and external hosting/OneDrive credentials remain deferred until required.

```
Phase 0  Foundation & tooling gate      APPROVED (2026-11-22) — committed
A-1/A-2  Port 4000 + Hebrew/RTL shell   APPROVED + VERIFIED
Phase 1  Auth, users, RBAC, MFA, shell  DONE (approved 2026-11-24) — pushed
Phase 2  Calendar, tasks, projects,     IN PROGRESS — packets 2A + 2B VERIFIED
         dashboard, activity, search    (2C–2T NOT_STARTED)
Phase 3  SMTP, reminders, jobs, worker, NOT_STARTED
         notification centre
Phase 4  Asset management               NOT_STARTED
Phase 5  OneDrive / Microsoft Graph     NOT_STARTED
Phase 6  Production readiness           NOT_STARTED
```

What exists now — real code, executed tests, measured output (no placeholders):

| Area                                                                | What is real, and what proves it                                                                                                                                                                                                      |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/PLAN.md`, `docs/ARCHITECTURE.md`                              | Phase plan + architecture, now including the binding amendments §0A                                                                                                                                                                   |
| `src/app/` layout + status page (`layout.tsx`, `page.tsx`)          | Hebrew-first RTL landing page showing only measured runtime/DB state; language switch (server action form, works with JS disabled). Proven by Playwright on desktop + mobile                                                          |
| `src/i18n/` (locales, dictionaries, actions, toggle)                | Typed dictionaries — `he` primary/source-of-truth, `en` typed against it; server-side locale resolution; RTL from one `dir` attribute. Proven by `tests/unit/i18n.test.ts` + `tests/e2e/i18n.spec.ts`                                 |
| `src/lib/env.ts` (port 4000 default, `DEFAULT_LANGUAGE=he`)         | Zod-validated config; production refuses to boot without real secrets; dev/test generate throwaway secrets. Proven by `tests/unit/env.test.ts`                                                                                        |
| `src/db/` + `drizzle/` migration 0000                               | better-sqlite3 with WAL / FK / busy_timeout / synchronous=NORMAL, baseline migration applied. Proven by `tests/unit/db.test.ts`, integration health test                                                                              |
| `src/lib/{health,http,log,csp,runtime,serverStart}`, `src/proxy.ts` | Health snapshot (two endpoints), error envelope, redacting logger, per-request CSP nonce via the Next 16 `proxy` convention, fail-closed startup. Proven by unit + integration + E2E                                                  |
| `Dockerfile`, `docker-compose.yml`, `scripts/`                      | Standalone production artifact, port **4000**, healthcheck scripts, E2E server runner. **Docker build itself not verified — Docker is not installed on this machine**                                                                 |
| `README.md`                                                         | Untouched, byte-for-byte. sha256 re-checked 2026-11-22: `bff38cafa2617c7f1cb867af280c89a76f5bf5badede2f8b0500ff7818aa5e70` = baseline                                                                                                 |
| Phase 1 identity and security                                       | Better Auth + Argon2id, four-role RBAC, privileged MFA policy, hashed recovery codes, session/password administration, persistent rate limits, audit trails, first-admin CLI, and append-only migration upgrade test                  |
| Phase 1 product surface                                             | Authenticated RTL shell, working mobile/collapse navigation, profile/preferences and validated profile images, security and user administration screens, confirmation dialogs, and `/api/v1` profile/users/roles/admin/OpenAPI routes |
| Local-AI implementation handoff                                     | `docs/LOCAL_AI_ROADMAP.md` splits Phases 2–6 into 58 independently testable packets; `docs/prompts/` contains one self-contained copy/paste prompt per packet, verified by `npm run prompts:check`                                    |

---

## Status by work item

Updated at each gate. IDs match `docs/PLAN.md`.

| ID       | Item                                                        | Status              | Verified by                                                                                                                                                                 |
| -------- | ----------------------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P.0      | Read spec, audit environment, write plan + architecture     | **VERIFIED**        | commands below (2026-11-22)                                                                                                                                                 |
| 0.1–0.6  | Repo/tooling/gate skeleton                                  | **VERIFIED**        | Gate G-0 run, 2026-11-22 (commands + output below)                                                                                                                          |
| A-1      | Local port 4000 (was 3000 — occupied here by another site)  | **VERIFIED**        | `npm run dev` → `http://localhost:4000` HTTP 200; `tests/unit/env.test.ts`, `tests/unit/csp.test.ts`, E2E on 4100/4111                                                      |
| A-2      | Hebrew primary + RTL, English secondary                     | **VERIFIED**        | `tests/unit/i18n.test.ts` (18 tests), `tests/e2e/i18n.spec.ts` (6 tests × desktop+mobile), live `curl` check of `lang="he-IL" dir="rtl"`                                    |
| 1.1–1.12 | Foundation / auth / RBAC / MFA / shell / settings           | **DONE (approved)** | User verified login, MFA, and navigation; 17 Vitest files / 93 tests; production build; 54 Playwright tests (51 passed, 3 stateful mobile duplicates intentionally skipped) |
| 2A       | Shared vocabulary, tags, activity services                  | **VERIFIED**        | `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test` (21 files / 123 tests), `npm run build` — 2026-11-25                                                |
| 2B       | Event + participant schema, event repository                | **VERIFIED**        | `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test` (25 files / 153 tests), `npm run build` — 2026-11-25                                                |
| 2.1–2.12 | Calendar / tasks / projects / dashboard / activity / search | NOT_STARTED         | —                                                                                                                                                                           |
| 3.1–3.9  | SMTP / reminders / job subsystem / worker / notifications   | NOT_STARTED         | —                                                                                                                                                                           |
| 4.1–4.8  | Asset management                                            | NOT_STARTED         | —                                                                                                                                                                           |
| 5.1–5.9  | OneDrive integration                                        | NOT_STARTED         | —                                                                                                                                                                           |
| 6.1–6.7  | Production readiness                                        | NOT_STARTED         | —                                                                                                                                                                           |

---

## Gate queue (approval protocol)

| Gate       | Contents                                                                                                        | Status                    | Your decision                                                               |
| ---------- | --------------------------------------------------------------------------------------------------------------- | ------------------------- | --------------------------------------------------------------------------- |
| G-P (plan) | `docs/PLAN.md`, `docs/ARCHITECTURE.md`, 4 open questions (Docker, README handling, external creds, target host) | **APPROVED (2026-11-22)** | given; Q3/Q4 deferred, Q5 answered                                          |
| G-0        | install / typecheck / lint / unit smoke / build / start / health 200 / no-secrets-in-git                        | **PASSED → APPROVED**     | given 2026-11-22                                                            |
| G-1        | auth+RBAC+MFA integration suite, isolation suite, E2E flows 1,2,11,12                                           | **PASSED → APPROVED**     | user validated login/MFA/navigation and requested GitHub commit, 2026-11-24 |
| G-2        | recurrence unit matrix, CRUD/isolation integration, E2E 3–8 desktop+mobile                                      | NOT_RUN                   | —                                                                           |
| G-3        | restart-durability test, dedupe/no-double-send test, mock SMTP delivery, E2E 9,10,14                            | NOT_RUN                   | —                                                                           |
| G-4        | index/browse/bulk-edit integration, originals-unchanged checksum test, E2E asset flows                          | NOT_RUN                   | —                                                                           |
| G-5        | mocked-Graph integration (pagination, 429/Retry-After, resume), E2E 13, degraded-without-creds test             | NOT_RUN                   | —                                                                           |
| G-6        | full `npm run verify`, security review, backup/restore run, docs, spec §26 checklist                            | NOT_RUN                   | —                                                                           |

---

## Log (append-only, newest first)

### 2026-11-25 — Packet 2C implemented: event service + `/api/v1/events*` wire contract

Created `src/lib/eventsApi.ts` (query-string schemas `eventListParams` / `eventSearchParams`, `parseQuery`, `toEventQuery`, body → status mapping) and the route tree `src/app/api/v1/events/{route,search,attending,[id]}`: `GET` list, `GET /search`, `GET /attending`, `POST` create, `POST /{id}` duplicate, `PATCH /{id}` optimistic edit, `DELETE /{id}`. Extended `src/lib/events.ts` with the service surface behind them (list / search / attending / read / create / update / remove / duplicate, cursor paging on `(start_at, id)`, participant visibility clause, owner-scoped reads so another user's id and a nonexistent id fail identically as 404 `not_found`). `src/lib/productivity.ts` gained the search vocabulary (`MAX_SEARCH_QUERY_LENGTH`, `invalid_query` / `query_too_long` / `invalid_filter`) and the `version_conflict → 409` rationale. `src/lib/api.ts` gained a 32 KB body cap enforced before parsing, `parseOptionalJson` for path-only inputs, and the `ProductivityError` → HTTP table. `src/app/api/v1/openapi.json/route.ts` documents the new endpoints.

Two defects found while wiring the packet, both fixed:

1. `apiErrorResponse` had no branch for rbac's `AuthorizationError`. The 2C services call `authorize` directly — there is no `runAction` wrapper converting it to an `ActionError` — so **every** authorization denial would have surfaced as a 500. It now maps `missing_permission` / `unknown_role` / `mfa_required` → 403 and `stale_session` → 401, with a test pinning each.
2. The E2E bootstrap provisioned only one ordinary session, so the spec could not distinguish "not allowed to see" from "not allowed to change". `scripts/e2e-server.mjs` now also bootstraps a `reader` account that holds `calendar.view.shared` but no write grant, and `tests/e2e/helpers.ts` exports its credentials; `tests/e2e/eventsApi.spec.ts` asserts that session gets 200 on the shared list and 403 `missing_permission` on every write method.

Also removed two scratch `tests/unit/probe*.test.ts` files left in the tree by earlier exploration — they were not tests of behaviour.

| Command                | Executed result                                                                                                                                                                                                |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`    | **passed**, 0 TypeScript errors                                                                                                                                                                                |
| `npm run lint`         | **passed**, 0 ESLint errors/warnings                                                                                                                                                                           |
| `npm run format:check` | **passed**, all files Prettier-clean (after `prettier --write` on packet files)                                                                                                                                |
| `npm test`             | **25 files / 174 tests passed** (was 25 / 153 at 2B: +21 across `tests/unit/events.test.ts`, `tests/integration/eventsService.test.ts`, `tests/integration/eventsApi.test.ts`)                                 |
| `npm run build`        | **passed**, Next 16.4.6 Webpack production build                                                                                                                                                               |
| `npm run test:e2e`     | **59 passed / 3 skipped** (62 collected; the 3 skips are the pre-existing desktop-only `auth.spec.ts` lifecycle cases). `tests/e2e/eventsApi.spec.ts` **4/4 in both** `desktop-chromium` and `mobile-chromium` |

Note for future E2E work: both Playwright projects share one bootstrapped SQLite database, so cross-project row-count assertions race. `eventsApi.spec.ts` namespaces its marker category by project (`e2e-wire-<project>`).

### 2026-11-25 — Packet 2B implemented: event + participant schema, event repository

Added migration `0003_phase2b_events` with two tables. `events` carries the owner, `start_at`/`end_at` as UTC ISO strings, all-day flag, IANA `timezone`, status, color, location, category, description and the visibility columns, guarded by **12 CHECK constraints** (UTC shape via `glob`, `end_at > start_at`, status enum, boolean encoding, and every field length bound) plus four indexes: `(owner_user_id, start_at, id)`, `(owner_user_id, status, start_at)`, `(status, start_at)` and the primary key. `event_participants` is the `(event_id, user_id)` join with a unique index both directions. `src/db/schema/events.ts` mirrors all of it in Drizzle; `src/db/schema/index.ts` re-exports it.

`src/lib/events.ts` is the repository: `createEvent`, `updateEvent`, `readEvent`, `listEvents`, `listEventsAttendedBy`, `listEventParticipants`, `addParticipant`, `removeParticipant`, `listEventTags`, `addEventTag`, `removeEventTag`, with `EventRecord` / `EventInput` / `EventUpdate` / `EventPage` / `ParticipantRecord`. Every operation takes an `Actor` and re-checks the RBAC key on the server — a page never decides what it is allowed to see. Keyset pagination is `(start_at, id)` with an opaque `{ startAt, id }` cursor, and every read requires a bounded window: unbounded or over `MAX_QUERY_WINDOW_DAYS` is rejected rather than scanned. `ProductivityError` reasons are reused (`invalid_instant`, `invalid_window`, `window_too_large`, `invalid_status`, `invalid_status_field` …) so 2A and 2B fail the same way. Event vocabulary (`EVENT_STATUSES`, `isEventStatus`, the `MAX_EVENT_*` bounds, `EVENT_COLOR_PATTERN`) lives in `src/lib/productivity.ts` next to the constraints it mirrors, not in the events module, because the schema and the UI both need it.

To keep tag visibility from drifting, `tagView` and `findTag` in `src/lib/tags.ts` are now exported and reused by the event tag join instead of being reimplemented there.

Two untracked scratch files (`tests/unit/probe.test.ts`, `tests/unit/probe2.test.ts`) had no `vitest` imports and broke `npm run typecheck` and `npm run build` before this packet could be gated. They were not deleted; they were given the missing `expect`/`it` imports so the gate runs. They are throwaway probes and should be removed by you before the next commit.

Verification (executed 2026-11-25): `npm run typecheck` clean; `npm run lint` clean; `npm run format:check` — all files Prettier-clean; `npm test` → **25 files / 153 tests passed** (`tests/unit/events.test.ts` 19 tests, `tests/integration/events.test.ts` 9 tests); `npm run build` compiled successfully. `npm run test:e2e` not run — 2B adds no routes or UI.

Not done: no calendar/task/project UI, no routes, no reminders, no `.ics` export — later packets own those.

### 2026-11-25 — Packet 2A implemented: shared vocabulary, tag service, activity service

Added migration `0002_phase2a_productivity` (`tags`, `tag_links`, `activity_log` with resource-kind and action CHECK constraints plus the `(created_at, id)` feed indexes), the shared vocabulary in `src/lib/productivity.ts`, the tag service in `src/lib/tags.ts` and the activity service in `src/lib/activity.ts`. No routes or UI yet — later packets own those.

Bug found while testing the packet: tag and activity visibility were resolved as a _single strongest level_, so a role holding both `*.view.own` and `*.view.shared` (the `user` role) was narrowed to the shared grant list and could not see its own tags or its own feed. Both services now build the **union** of every held view (`tagView` / `activityView`), distinguish "holds no view key" (raises `AuthorizationError`) from "holds a view key but nothing matches" (empty page), and keep `activity.view.any` unrestricted. Phase 1 services were checked: none read `*.view.shared`, so the defect was confined to 2A.

Also corrected stale Phase 1 expectations that the new migration invalidated: `tests/integration/authSpike.test.ts` table list (+`tags`, `tag_links`, `activity_log`) and `tests/integration/migrationUpgrade.test.ts` applied-migration count (2 → 3).

Packet coverage added on top of the services: `tests/integration/rbacSeed.test.ts` (re-seeding is a no-op, the seeded rows equal the declared matrix, privileged flags stay stable) and a new case in `tests/unit/rbac.test.ts` pinning the exact four-role grants for the shared productivity keys.

| Command                | Executed result                                                                                 |
| ---------------------- | ----------------------------------------------------------------------------------------------- |
| `npm run typecheck`    | **passed**, 0 TypeScript errors                                                                 |
| `npm run lint`         | **passed**, 0 ESLint errors/warnings                                                            |
| `npm run format:check` | **passed**, all files formatted (after `prettier --write` on packet files)                      |
| `npm test`             | **21 files / 123 tests passed** (was 17 / 93: +1 vocabulary unit, +3 seed, +7 tag, +8 activity) |
| `npm run build`        | **passed**, Next 16.4.6 Webpack production build                                                |

Not yet run for this packet: `npm run test:e2e` (2A adds no routes or UI, so the Phase 1 E2E surface is unchanged) and `npm run test:coverage`. Committed as `phase 2A: add shared productivity foundations`; the micro-gate is green and awaits your approval before 2B opens.

### 2026-11-24 — Phase 1 accepted, pushed, and local-AI roadmap prepared

The user validated the real local flow (login, MFA enrollment, and authenticated navigation) and requested the result be committed to GitHub. Gate G-1 is therefore approved. The verified history was pushed to `main` at `https://github.com/oferyach/Personal-Management-Dashboard` (`4bee35f`).

Phases 2–6 are now decomposed in `docs/LOCAL_AI_ROADMAP.md` into 58 independently testable, one-commit packets: 2A–2T, 3A–3J, 4A–4J, 5A–5J, and 6A–6H. The playbook includes context limits, migration/authorization rules, per-packet tests and commit boundaries, model capability tiers, escalation triggers, macro gates, and a standard handoff format.

### 2026-11-24 — Phase 1 implemented; Gate G-1 PASSED and awaits approval

Implemented the complete Phase 1 foundation: migration-safe Better Auth identity tables, first-admin bootstrap, exact four-role permission matrix and ownership guards, privileged-role MFA, QR enrollment, Argon2id recovery-code hashes, session/password administration, persistent rate limiting, security audit coverage, verified locale preferences, profile image validation and authenticated delivery, responsive RTL shell, users/roles UI, native confirmation dialogs, and the documented `/api/v1` surface with Zod validation and public OpenAPI description.

Important corrections found during the gate: the original Phase 0 migration was restored and Phase 1 made append-only; locale lookup now verifies the session instead of trusting a cookie identifier; audit filters combine actor and action; the mobile/collapse checkbox selectors now operate on their real DOM structure; and API origin comparison uses the configured public URL rather than an internal reverse-proxy URL.

| Command                 | Executed result                                                                                                                                                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`     | **passed**, 0 TypeScript errors                                                                                                                                                                                                             |
| `npm run lint`          | **passed**, 0 ESLint errors/warnings                                                                                                                                                                                                        |
| `npm run format:check`  | **passed**, all files formatted                                                                                                                                                                                                             |
| `npm test`              | **17 files / 93 tests passed**                                                                                                                                                                                                              |
| `npm run test:coverage` | **passed**; 56.08% statements, 52.08% branches, 58.88% functions, 58.04% lines. Security service highlights: account security 94.38%, auth 86.95%, rate limiter 100%, dashboard 100%                                                        |
| `npm run build`         | **passed** with Next 16.4.6 Webpack production build; all Phase 1 pages and API routes emitted                                                                                                                                              |
| `npm run test:e2e`      | **54 tests: 51 passed / 3 intentional stateful mobile duplicates skipped** across desktop and Pixel 7 projects; API authorization/mutation, MFA/RBAC, RTL, mobile open navigation, desktop collapse, startup and security headers all green |
| migration upgrade test  | included in the green integration suite; reconstructs the Phase 0 database then applies Phase 1 migrations successfully                                                                                                                     |

Intentional, documented deferrals do not block G-1: SMTP-backed email reset remains Phase 3, with the Phase 1 admin-reset/forced-change path operational; Docker cannot be executed on this host because Docker is not installed. The three skipped mobile cases are duplicate, state-mutating identity lifecycles run once on desktop; the remaining mobile project tests cover login failure, API authorization, RTL, shell rendering, and actual menu opening.

### 2026-11-22 (night) — Phase 0 APPROVED, committed as `64e06d6`, Phase 1 started

Your decisions, recorded verbatim where they change the build:

| Your instruction                                         | What it changes                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| "Phase 0 approved"                                       | Gate G-0 closed as **PASSED → APPROVED**; Gate G-P (plan) approved; Phase 1 becomes the current phase                                                                                                                                                                                                                                |
| "Keep Hebrew default language – allow English selection" | D-11 approved and now permanent: `he` primary, `en` shipped and selectable, parity enforced by the `Dictionary` type and the i18n tests. Removing English would now be a deliberate spec change, not an implementation shortcut                                                                                                      |
| "Commit this phase"                                      | `64e06d6 — Phase 0: foundation + tooling gate (approved), port 4000, Hebrew-first RTL`; the commit message itself carries the G-0 evidence and the unverified-Docker caveat. `git status` after the commit: clean; `README.md` still byte-identical                                                                                  |
| "timezone Jerusalem"                                     | D-5 **closed**: `Asia/Jerusalem` is the default timezone and later phases must prove date/time behaviour against it in tests (DST boundary, `he-IL` date rendering) rather than assume it                                                                                                                                            |
| "Hosting and OneDrive will come when required"           | Phase 5 (OneDrive) and the SMTP half of Phase 3 are built behind the adapter interfaces with fakes, integration-ready but not activated. No phase waits for a hostname or tenant. Anything requiring real Microsoft/SMTP credentials stays `skip`-with-reason in the test output and is listed as a gap, never described as verified |

Still open (non-blocking for Phase 1): Q1 Docker locally, Q2 whether to normalize a copy of the spec into `docs/PROJECT-SPEC.md`.

### 2026-11-22 (evening) — Status recheck + Gate G-0 executed + amendments A-1/A-2 implemented

**Trigger:** you asked for a status recheck, port 4000 locally, and Hebrew/RTL as the primary UI language.

#### What the recheck actually found

| Finding                                                                                                                                                                                                                                                                                                                                             | Evidence                                                                                      | Action taken                                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Port 3000 on this machine is **not ours** — it is held by an unrelated dev server from another project (`C:/Users/ofery/Documents/Codex/2026-08-24/t/outputs/ester-streit-wurzel-site`, `vinext dev --hostname 0.0.0.0`, PID 66272, started 16:57). `curl http://localhost:3000/api/v1/health` returned that site's HTML (`<title>אסתר שטרייט־וורצל | האתר הרשמי</title>`), not this app's JSON.                                                    | `netstat` + `Get-CimInstance Win32_Process` + `curl`                                                                       | Moved this project to **4000** everywhere (amendment A-1). That other process was left running — it belongs to a different site, I did not touch it. |
| `PROGRESS.md` was stale: it claimed "Phase 0: NOT STARTED, docs only" while the whole Phase 0 skeleton existed (app shell, DB, migrations, health, CSP proxy, Docker files, tests).                                                                                                                                                                 | `git status`, `find src`                                                                      | Corrected below with executed evidence.                                                                                    |
| Next.js in use is **16.4.6**, while `docs/PLAN.md` still said "Next.js 15"; PLAN also assumed `next-intl`, which was never installed.                                                                                                                                                                                                               | `package.json`, `next build` output                                                           | PLAN §2 corrected (framework row, i18n row) + decisions D-10/D-11 recorded.                                                |
| `metadata` + `generateMetadata` in the same layout is a hard build error in Next 16.                                                                                                                                                                                                                                                                | `next build` failure: `"metadata" and "generateMetadata" cannot be exported at the same time` | Fixed: single `generateMetadata()` carrying robots + icons + localized title/description.                                  |
| Git: repo initialised, **no commit yet**, 73 files staged.                                                                                                                                                                                                                                                                                          | `git log` → "does not have any commits yet"                                                   | Left as-is pending your call — say the word and I make the first commit (staging is already clean; `.env` is not tracked). |

#### Gate G-0 — commands run and their real output (2026-11-22)

| Command                                                                                                              | Result                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck` (`tsc --noEmit`)                                                                                 | **0 errors** (no output)                                                                                                                                                                                                               |
| `npm run lint` (`eslint .`)                                                                                          | **0 errors, 0 warnings**                                                                                                                                                                                                               |
| `npm run format:check`                                                                                               | `All matched files use Prettier code style!` (`README.md` is prettier-ignored to keep it byte-identical)                                                                                                                               |
| `npm test` (vitest: unit + integration)                                                                              | **7 files / 65 tests passed** in 2.42s                                                                                                                                                                                                 |
| `npm run test:unit`                                                                                                  | **5 files / 55 tests passed**                                                                                                                                                                                                          |
| `npx next build`                                                                                                     | **success** (Turbopack, `output: standalone`); routes `ƒ /`, `ƒ /_not-found`, `ƒ /api/v1/health`, `ƒ /health`, `ƒ Proxy (Middleware)`. `/_not-found` became dynamic — expected, because the layout now resolves a locale per request   |
| `npm run dev` (now `next dev -p 4000`)                                                                               | `- Local: http://localhost:4000`, `✓ Ready`, startup log `{"env":"development","port":4000,"database":"./data/app.db","migrationsApplied":1,"smtp":"not_configured","onedrive":"not_configured"}`                                      |
| `curl http://localhost:4000/`                                                                                        | **200**, `<html lang="he-IL" dir="rtl" data-locale="he" data-default-language="he">`, `<title>לוח ניהול אישי</title>`; body contains `מסד נתונים`, `סביבת ריצה`, `תהליך רקע`, `אינטגרציות`, `36× ltr-island`                           |
| `curl http://localhost:4000/api/v1/health`                                                                           | 200, `"status":"ok"`, `journalMode":"wal"`, real sqlite version                                                                                                                                                                        |
| `curl -H "Cookie: pmd_locale=en" http://localhost:4000/`                                                             | `<html lang="en" dir="ltr">` + `<title>Personal Management Dashboard</title>` — secondary language works end to end                                                                                                                    |
| `curl -H "Cookie: pmd_locale=de" http://localhost:4000/`                                                             | falls back to `lang="he-IL" dir="rtl"` — an invalid/hostile value cannot reach the DOM                                                                                                                                                 |
| `npm run test:e2e` (Playwright, real standalone production server on **4100**, fail-closed startup test on **4111**) | **34 tests passed** in 13.3s (17 × desktop-chromium, 17 × mobile-chromium), including "the language switch works without JavaScript" and RTL/`dir` assertions                                                                          |
| `sha256sum README.md`                                                                                                | `bff38cafa2617c7f1cb867af280c89a76f5bf5badede2f8b0500ff7818aa5e70` = the baselined value → your spec is still byte-for-byte untouched                                                                                                  |
| secret scan of the staged tree (`git grep --cached -niE "session_secret\|encryption_key\|password\|token"`)          | Only **declarations** (env var names in `src/lib/env.ts`, `docker-compose.yml`), the word "tokens" in the design-token CSS comment, and `js-tokens` in `package-lock.json`. No secret **values**. `.env` is not tracked (`git ls-files | grep -c '^\.env$'` → 0) |

Honest exclusions from G-0: `tests/helpers/testDb.ts` and `scripts/e2e-server.mjs` contain **fixed dummy test values** for `SESSION_SECRET` / `APP_ENCRYPTION_KEY` — long enough to pass production validation, used only against `127.0.0.1` and temp SQLite files, never usable against a real deployment. Docker/Compose was **not** verified (Docker is still not installed here) — unchanged from the Phase 6 limitation.

#### Amendment A-1 — port 4000 (what changed)

`package.json` (`dev: next dev -p 4000`), `src/lib/env.ts` (`PORT` default 4000, `APP_URL` default `http://localhost:4000`), `src/lib/csp.ts` (dev-host fallback), `scripts/healthcheck.mjs`, `scripts/start-production.mjs`, `scripts/e2e-server.mjs` (E2E 4100), `playwright.config.ts` (4100), `.env.example`, `Dockerfile` (`ENV PORT=4000`, `EXPOSE 4000`), `docker-compose.yml` (`127.0.0.1:4000:4000`), `tests/helpers/testDb.ts`, `tests/unit/env.test.ts`, `tests/unit/csp.test.ts` (new test asserting the fallback host is `localhost:4000`), `tests/e2e/startup.spec.ts` (4111).

#### Amendment A-2 — Hebrew primary + RTL (what changed)

New `src/i18n/`: `locales.ts` (locale set, `dir`/`lang` mapping, total `resolveLocale`), `dictionaries/he.ts` (**primary, source of truth for the key shape**, includes the 11 spec §4 menu labels in Hebrew for the Phase 1 shell), `dictionaries/en.ts` (secondary, typed against `Dictionary` derived from `he`), `dictionaries/types.ts`, `requestLocale.ts` (cookie → `DEFAULT_LANGUAGE` → `he`, resolved server-side), `actions.ts` (`"use server"` locale switch with same-origin return-path validation), `LanguageToggle.tsx` (plain form POST, no client JS).

Changed: `src/app/layout.tsx` (`<html lang="he-IL" dir="rtl">`, localized metadata), `src/app/page.tsx` (all labels from the dictionary; measured values rendered as LTR islands; localized badge text with the raw machine code kept in `data-value`), `src/app/globals.css` (Hebrew-capable font fallbacks, `.ltr-island` utility), `src/lib/env.ts` (`DEFAULT_LANGUAGE` enum reordered to `["he","en"]`, default `he`), `.env.example`, `Dockerfile`/`docker-compose.yml` (`DEFAULT_LANGUAGE=he`).

New tests: `tests/unit/i18n.test.ts` (18 tests: dictionary parity, every menu label must be Hebrew, English must not leak into the Hebrew UI, locale resolution is total, hostile values rejected) and `tests/e2e/i18n.spec.ts` (6 tests × 2 viewports: RTL document, Hebrew title, switch persists in an httpOnly cookie, works with JavaScript disabled, hostile cookie falls back to Hebrew, paths stay LTR, zero console/CSP errors).

Design note recorded for Phase 1: the status page deliberately does **not** fake a navigation menu (plan rule 2 — no placeholder pages, no fake buttons). The Hebrew nav labels are shipped in `he.nav` and test-locked, and Phase 1 item 1.8 renders them in the real shell.

Additions found while rechecking (a real page a real user lands on must not be an exception to the language rule): localized `src/app/not-found.tsx` (Hebrew 404, RTL, no internals — uses `next/link`), and the worker card now shows a Hebrew explanation (`states.workerDetail`) with the raw English diagnostic kept as a separate labeled LTR row (`labels.diagnostics`), so nothing English leaks into the Hebrew UI as if it were a label. New E2E test: "even the 404 page arrives Hebrew and RTL". Gate re-run after these additions: **65 vitest + 36 Playwright passed**, typecheck/lint/format/build clean.

### 2026-11-22 — Planning (no code written)

Environment audit — executed commands and results:

| Command                                      | Result                                                                                                              |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `node -v` / `npm -v`                         | v24.19.0 / 11.17.0                                                                                                  |
| `docker --version`, `docker compose version` | **not found** (Docker not installed on this machine)                                                                |
| `git --version` / `git status`               | 2.55.0.windows.3 / **not a git repository** here                                                                    |
| `pnpm -v`                                    | not installed → use npm                                                                                             |
| `uname -a`                                   | MINGW64_NT-10.0-26300 (Windows 11, Git Bash)                                                                        |
| `df -h .`                                    | 688 GB free on C:                                                                                                   |
| `curl https://registry.npmjs.org/`           | HTTP 200 — registry reachable                                                                                       |
| `ls` / `find` (depth 2)                      | directory contains **only `README.md`** → greenfield                                                                |
| `wc -l README.md`                            | 3042 lines; 27 numbered sections verified present                                                                   |
| `sha256sum README.md`                        | baseline `bff38caf…5e70` — recorded so any later change to your spec file is provable                               |
| format checks                                | CRLF endings; Markdown is escaped (`\#`×274, `\*\*`/`\*`×964, `\.`×964) so the spec does **not** render as Markdown |

Findings and consequences:

1. Greenfield directory, no existing user code to preserve → safe to scaffold at repo root (spec §2 "no second nested project").
2. Two housekeeping blockers raised for you: git repo not initialised (will `git init` at 0.1) and Docker missing (verification limitation at Phase 6).
3. Spec file formatting flagged, original left byte-for-byte untouched.
4. Node 24 is newer than some tutorials assume → dependency versions will be pinned deliberately at 0.2 rather than copy-pasted, and native modules (`better-sqlite3`, `sharp`) are called out as an early risk with a Windows verification step at Gate 1.
5. Highest-risk logic identified up front: recurring-event expansion + DST/timezone correctness (Phase 2.3) and reminder idempotency across restarts (Phase 3.2/3.5). Both got dedicated test matrices in their gates before any UI work.

Written: `docs/PLAN.md` (7 phases incl. Phase 0 gate phase, 62 work items, 7 gate definitions, DoD traceability table, 4 blocking questions, 8 named risks with mitigations) and `docs/ARCHITECTURE.md` (module boundaries, authz flow, table→phase mapping, SQLite job queue design with lease/recovery, reminder pipeline, OneDrive provider interface, testing seams, 5 spikes that must end in ADRs).

Explicitly **not** done, on purpose: no `package.json`, no dependencies installed, no source files, no `git init`, no database — implementation starts only after you approve this plan.

---

## Decisions log

| #    | Decision                                                                                                                             | Status                                                                              | Rationale                                                                                                                                                                                       |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-1  | Next.js App Router + TypeScript, single app at repo root (installed and verified: **Next.js 16.4.6**)                                | **amended from "Next 15 (draft)"**                                                  | spec-preferred; verified in practice: `output: "standalone"`, the `proxy` convention (replaces `middleware`), per-request CSP nonces, `metadata` and `generateMetadata` cannot both be exported |
| D-2  | Drizzle ORM + better-sqlite3 (WAL, FK on)                                                                                            | proposed                                                                            | SQL-visible, FTS5 + online backup API accessible, Postgres swap stays feasible                                                                                                                  |
| D-3  | Better Auth + Argon2id + own RBAC tables; TOTP fallback path                                                                         | proposed (spike 1.1 in progress)                                                    | mature library, spec forbids custom crypto; viability proven by the Phase 1 spike, recorded in `docs/adr/0001-auth-library.md`                                                                  |
| D-4  | Custom DB-backed job queue (no Redis)                                                                                                | proposed                                                                            | restart-safe, single-VPS appropriate, spec §15                                                                                                                                                  |
| D-5  | UTC storage + per-record timezone, `Asia/Jerusalem` default                                                                          | **CONFIRMED by you 2026-11-22 — closed**                                            | You confirmed Jerusalem. It is the `DEFAULT_TIMEZONE` default and must be test-locked, not assumed                                                                                              |
| D-6  | `rrule` for recurrence                                                                                                               | proposed                                                                            | RFC 5545 correctness over hand-rolled logic                                                                                                                                                     |
| D-7  | Originals never mutated in v1; organization is metadata-only                                                                         | proposed (mandatory)                                                                | spec §9 hard requirement                                                                                                                                                                        |
| D-8  | External adapters (SMTP, Graph) always behind an interface with a fake implementation                                                | proposed                                                                            | enables credential-free integration tests                                                                                                                                                       |
| D-9  | `README.md` untouched until Phase 6, spec copied to `docs/PROJECT-SPEC.md` first                                                     | proposed                                                                            | spec §2 "don't overwrite user files"                                                                                                                                                            |
| D-10 | Local port is **4000** (E2E 4100, fail-closed startup test 4111)                                                                     | **yours (amendment A-1) - implemented**                                             | Port 3000 on this machine belongs to an unrelated site; `next dev` would silently have landed on 3001 and every script/healthcheck would point at the wrong process                             |
| D-11 | i18n = first-party typed dictionaries in `src/i18n/`; **Hebrew primary + RTL**, English selectable as secondary; `next-intl` dropped | **APPROVED by you 2026-11-22** — “Hebrew default language, allow English selection” | Hebrew-first needs no locale-prefixed URLs; `he` defines the key shape so a missing translation fails the build; one `dir` attribute + logical properties instead of a parallel RTL stylesheet  |
| D-12 | UI labels localized; machine values never translated and also exposed as `data-value`                                                | implemented                                                                         | RTL cannot reorder a path or version; tests assert the raw fact (`not_installed`, `wal`) whatever the UI language is                                                                            |

## Blockers / open questions (need your answer)

| #   | Question                                                                                                              | Blocks                                                                                                          | Default if unanswered                                                   |
| --- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Q1  | Install Docker Desktop here now, or verify Docker/HTTPS on the VPS at Phase 6?                                        | Phase 6 verification honesty                                                                                    | author early, verify on VPS, state "not verified locally"               |
| Q2  | Leave `README.md` byte-identical, or normalize a copy into `docs/PROJECT-SPEC.md` (currently escaped Markdown, CRLF)? | Phase 6 README swap                                                                                             | leave original untouched, normalized copy only                          |
| Q3  | Will Entra app registration + SMTP credentials be available during Phases 3 and 5?                                    | real end-to-end verification of email/OneDrive                                                                  | build fully, mock-verify, document unverified parts                     |
| Q4  | Target VPS host + domain name?                                                                                        | cookie `Secure` scope, Caddy domain, backup retention                                                           | generic Ubuntu LTS + Caddy docs with placeholder domain                 |
| Q5  | Hebrew is primary. Keep English selectable in the UI (it is today), or Hebrew-only in v1?                             | whether the English dictionary + language switch stay shipped, and how much translation work each phase carries | keep both: Hebrew default, English selectable, parity enforced by tests |
| Q6  | Make the first git commit now? (73 files staged, repo has **no commits yet**)                                         | a clean diff/history baseline for every later gate                                                              | commit Phase 0 as one commit with the G-0 evidence in the message       |

**Answered 2026-11-22 with the Phase 0 approval:** Q3 → hosting and OneDrive “will come when required”, so both integrations are built behind their adapter interface and mocked in tests, never activated and never claimed as verified. Q4 → deferred; no phase blocks on a hostname. Q5 → **Hebrew stays the default language, English remains selectable**. Q6 → **yes, commit Phase 0** (done: see the log entry below). Timezone → **`Asia/Jerusalem` confirmed** (D-5 closed). Still open: Q1 (Docker locally) and Q2 (README normalization).

## Next action

Start only **packet 2D — Event form, agenda, and detail UI** from `docs/LOCAL_AI_ROADMAP.md`. 2C is implemented and its micro-gate is green (unit + integration + full E2E); complete 2D and land its green commit before opening 2E. Do not ask a local AI to implement all of Phase 2 in one task.

Current truth for running it locally:

```
npm run dev          → http://localhost:4000   (Hebrew, RTL)
npm run verify       → typecheck + lint + format + unit/integration + build + e2e
npm run test:e2e     → real production artifact on 127.0.0.1:4100 (+ 4111 for the fail-closed test)
npm run healthcheck  → http://127.0.0.1:${PORT:-4000}/health
```

Explicitly **not** done yet: calendar/tasks/projects/dashboard and all Phase 2 UI (packets 2A–2B shipped only the tag, activity and event services, no routes or screens), SMTP/reminders/worker (Phase 3), assets (Phase 4), OneDrive (Phase 5), and production verification (Phase 6). Placeholder screens must not claim these features work before their packets pass.
