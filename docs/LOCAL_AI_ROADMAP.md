# Local-AI Implementation Roadmap — Phases 2–6

Status: execution playbook for the remaining roadmap. Phase 1 is the stable base. The normative product requirements remain in `README.md`; `docs/PLAN.md` remains the high-level phase plan; this file defines small implementation and verification boundaries for a local AI.

Ready-to-copy, self-contained prompts for every packet are indexed in `docs/prompts/README.md`. Packet 2A is hand-authored in extra detail; the other 57 prompts are deterministically generated from this roadmap.

## 1. Why this plan exists

The original Phases 2–6 are too large for a smaller model to hold in working memory. This roadmap divides them into packets that:

- have one primary concern;
- normally add at most one migration;
- can be tested without unfinished later packets;
- end in a green commit and a short handoff note;
- never require the model to redesign authentication, RBAC, migrations, or the app shell;
- keep the expensive/high-risk review work concentrated in a few marked packets.

Do **one packet per chat and one packet per commit**. Do not ask a local model to implement an entire numbered phase in one run.

## 2. Mandatory operating protocol for every packet

### 2.1 Context packet to give the AI

Give the model only:

1. `AGENTS.md` in full.
2. This file: sections 2–5 plus the single packet being implemented.
3. The exact referenced section of `README.md`.
4. The relevant section of `docs/ARCHITECTURE.md`.
5. The last green commit hash and `git status --short`.
6. Existing source files in the module being changed; do not preload unrelated modules.

For Next.js work, the AI must read the relevant installed guide under `node_modules/next/dist/docs/` before editing. Training-memory Next.js conventions are not authoritative for this repository.

### 2.2 Standard prompt

Use this prompt, replacing the packet ID:

> Implement only packet `<ID>` from `docs/LOCAL_AI_ROADMAP.md`. Read `AGENTS.md`, the packet, its referenced README sections, the relevant architecture section, and the installed Next.js guide for any Next API you will touch. Inspect the current implementation before proposing changes. Preserve all existing user changes and the untracked `Modelfile`. Do not rewrite old migrations. Add the required tests, run the packet micro-gate, update `PROGRESS.md` with measured results, and stop. Do not begin the next packet. Report files changed, migration added, commands/results, risks, and the proposed commit message.

### 2.3 Scope limits

A normal packet should stay within:

- one migration and its snapshot/journal update;
- eight production files, excluding generated migration metadata;
- four test files;
- one UI screen or one domain service, not both when either is substantial;
- no unrelated refactor, dependency upgrade, formatting sweep, or naming cleanup.

If the packet cannot fit, stop and split it into `a`/`b` before writing code. Never silently broaden scope.

### 2.4 Migration rules

- Existing migration files are immutable history.
- Generate a new append-only migration from the current schema.
- Review the SQL before running it.
- Preserve `drizzle/meta` parent IDs and journal order.
- Add or extend the Phase 0 → current migration-upgrade integration test.
- Never drop/recreate a table merely to rename a column without an explicit data-copy test.
- Seed changes must be idempotent and must remove obsolete grants as well as add new ones.

### 2.5 Authorization and data rules

- Every service receives an authenticated actor or an actor-derived context.
- Every resource query is scoped by owner, membership, or an explicit grant.
- Guessing another user's ID returns the documented 403/404 without disclosing the record.
- UI hiding is not authorization.
- New mutations use the existing action guard, rate limiter where sensitive, audit/activity recording, Zod validation, and same-origin rules.
- Store timestamps in UTC. Render and calculate user-facing boundaries in the user's IANA timezone.
- Hebrew and English dictionary keys ship together; Hebrew remains the default.
- No fake “working” external integration or invented metadata.

### 2.6 Test/build rules

- Never run `next dev` and `next build` concurrently; both write `.next`.
- Stop the dev server before a production build.
- Do not run `npm run build` in parallel with `npm run typecheck`.
- Use a temporary SQLite database for unit/integration tests.
- E2E must use visible controls and the production standalone server.
- A skipped test needs a specific external prerequisite; unfinished local work is not a valid skip reason.
- Do not weaken an assertion just to make a test green. Diagnose whether the product or the test contract is wrong.

### 2.7 Micro-gate required for every packet

Run, in this order:

1. the packet's targeted unit tests;
2. the packet's targeted integration tests;
3. `npm test`;
4. `npm run typecheck`;
5. `npm run lint`;
6. `npm run format:check`;
7. `npm run build`;
8. the packet's E2E test when it has a user-visible or HTTP boundary.

Record actual counts and failures in `PROGRESS.md`. Commit only when the micro-gate is green.

### 2.8 Handoff format

Every packet ends with:

```text
Packet:
Commit:
Implemented:
Migration:
Targeted tests:
Full tests/build:
E2E:
Known limitations:
Files the next packet should read first:
```

## 3. Model-budget strategy

Use capability tiers rather than one expensive model for everything:

| Tier | Use                                             | Reasoning level   | Typical packets                                                                                               |
| ---- | ----------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------- |
| L    | A competent local coding model                  | medium            | bounded schema additions, forms, list/detail UI, translations, docs                                           |
| M    | The strongest local model available             | high              | actor-scoped services, transactions, import/export, worker code, cache/path security                          |
| H    | A top model used only to design/review the diff | high, not maximum | recurrence mutation semantics, lease/idempotency, OAuth/token security, backup/restore, final security review |

Budget rule: let L/M implement and test. Use H for a short pre-implementation contract review and a post-implementation diff review only. Do not spend H-model context on generated SQL, CSS polish, translations, or routine CRUD.

Mandatory H review packets: **2E, 2G, 3B, 3F, 3G, 3J, 5C, 5H, 6B, 6C, 6E**.

Escalate from local AI when it:

- proposes changing a prior migration;
- cannot state the transaction/idempotency invariant;
- invents a Next.js API without citing the installed docs;
- removes an authorization predicate to fix a test;
- needs real credentials to make local tests pass;
- cannot explain a DST, recurrence, retry, OAuth-state, or path-containment edge case;
- produces a diff larger than the packet limits.

## 4. Dependency order

```text
Phase 2 shared data
  ├─ calendar → recurrence → calendar UI/import-export
  ├─ tasks → task views
  ├─ projects
  └─ activity + search → dashboard

Phase 3 jobs/worker
  ├─ SMTP adapter
  ├─ reminder planner
  └─ delivery pipeline → notifications/admin

Phase 4 asset schema/upload/metadata
  ├─ thumbnails + browse UI
  ├─ organization + local scan
  └─ asset search/dashboard

Phase 5 provider/Graph/OAuth
  └─ folders → full sync → delta/retry/status

Phase 6 verification/security
  ├─ backup/restore
  ├─ Docker/worker/Caddy
  └─ deployment docs + final gate
```

Do not begin a child until its parent packet is green and committed.

## 5. Phase 2 packets — productivity

Requirements: `README.md` §§5–8, 16–17, 22; `docs/PLAN.md` §6; `docs/ARCHITECTURE.md` §§1–3, 8–10.

### 2A — Shared productivity vocabulary and schema

**Tier:** M. **Depends on:** Phase 1.

Implement only generic foundations used by later modules:

- typed resource/status/date contracts;
- `tags`, `tag_links`, and user-visible `activity_log` tables with indexes;
- event/task/project/search permission keys and exact four-role grants;
- service helpers for actor-scoped tag lookup and activity insertion;
- append-only migration and seed-upgrade assertions.

Do not create events, tasks, or project UI yet. Test idempotent RBAC seeding, tag ownership, cross-user tag denial, activity redaction, and Phase 1 database upgrade. Commit: `phase 2A: add shared productivity foundations`.

### 2B — Event schema and repository

**Tier:** M. **Depends on:** 2A.

Add `events` and `event_participants` with owner, UTC start/end, IANA timezone, all-day flag, status/category/color/location, optimistic `updated_at`, and indexes for owner/date/status. Add repository queries scoped by owner/participant and bounded date window. No recurrence yet.

Test constraints, end-after-start validation, all-day normalization, participant authorization, UTC round-trip, pagination, and ID guessing. No UI/E2E. Commit: `phase 2B: add actor-scoped event persistence`.

### 2C — Non-recurring event service and API

**Tier:** M. **Depends on:** 2B.

Add create/read/update/delete/duplicate/search/filter services and `/api/v1/events` routes. Validate Zod bodies/query strings, serialize dates consistently, record activity, and update OpenAPI. A duplicate gets a new ID and no recurrence identity.

Integration tests cover every method, invalid ranges, another user's ID, participant visibility, filters, duplicate semantics, audit/activity rows, and no stack leaks. Commit: `phase 2C: add event CRUD API`.

### 2D — Event form, agenda, and detail UI

**Tier:** L. **Depends on:** 2C.

Build an agenda/list page first, plus create/edit form and detail dialog/page. Include empty/loading/error states, keyboard labels, localized enum labels, LTR date islands, mobile layout, and confirmation before delete. Do not build month/week/day grids or drag-and-drop.

E2E: create → view → edit → duplicate → delete on desktop and mobile; verify Hebrew RTL and English switch. Commit: `phase 2D: add event agenda workflow`.

### 2E — Pure recurrence engine and ADR

**Tier:** H review, M implementation. **Depends on:** 2B.

Install and pin the recurrence dependency only here. Write an ADR defining canonical RRULE storage, occurrence key, inclusivity, timezone/DST behavior, `COUNT`/`UNTIL`, `EXDATE`, and bounded expansion. Implement a pure module with no database or UI.

Unit matrix: daily/weekly/monthly/yearly/custom interval, month-end, leap day, `COUNT`, `UNTIL`, exception, Jerusalem DST, another DST zone, all-day recurrence, invalid/unbounded input, and deterministic occurrence keys. Property: no occurrence outside the requested window. Commit: `phase 2E: define and test recurrence expansion`.

### 2F — Recurrence persistence and reads

**Tier:** M. **Depends on:** 2E, 2C.

Add `event_recurrence_rules` and `event_occurrence_exceptions`. Extend event create/read APIs to store a rule and expand occurrences only inside a required query window. Keep the series row separate from virtual occurrences.

Test migration upgrade, series isolation, bounded queries, exception application, participant visibility, and stable keys across repeated reads. UI only needs recurrence fields in the existing form. Commit: `phase 2F: persist and query recurring events`.

### 2G — Recurrence edit/delete modes

**Tier:** H review, M implementation. **Depends on:** 2F.

Implement transactions for: one occurrence, this-and-future, entire series; and the matching delete modes. “This-and-future” truncates the old series and creates a new linked series without duplicating prior exceptions. Define rollback behavior and activity entries before code.

Integration tests seed a series then assert exact occurrences before/after every edit/delete mode, including DST and first/last occurrence. Verify rollback on invalid split and cross-user denial. Commit: `phase 2G: add recurring series mutations`.

### 2H — Calendar month/week/day views

**Tier:** L. **Depends on:** 2F.

Add month, week, and day rendering using bounded event queries. Clearly separate all-day and timed lanes; use user timezone and logical RTL CSS. Reuse existing detail/form UI. No drag-and-drop yet.

E2E at desktop and 375px: switch views, navigate date windows, open an occurrence, and verify all-day/timezone placement. Commit: `phase 2H: add calendar visual views`.

### 2I — Calendar interactions and filters

**Tier:** M. **Depends on:** 2G, 2H.

Add click-date creation, reliable drag/drop rescheduling with optimistic UI rollback, category/status/participant filters, search, and quick duplicate. Do not allow a drag to choose a recurrence edit scope implicitly; prompt for scope.

E2E covers successful drag, server-rejected drag rollback, one-occurrence drag, keyboard fallback, and mobile behavior without requiring drag. Commit: `phase 2I: add calendar interactions`.

### 2J — iCalendar export

**Tier:** M. **Depends on:** 2G.

Add authorized `.ics` export for one event, one series, and a filtered collection. Serialize UID, timezone, all-day values, RRULE, EXDATE, descriptions, locations, and line folding. No import.

Unit tests parse exported bytes with an independent parser and assert round-trip fields, CRLF/folding, Unicode/Hebrew, recurrence, exceptions, and authorization. Commit: `phase 2J: add iCalendar export`.

### 2K — iCalendar import preview and commit

**Tier:** M. **Depends on:** 2J.

Implement upload limits, parser validation, dry-run preview, duplicate detection, timezone mapping, and explicit commit. Never mutate data during preview. Reject unsupported or malicious constructs with bounded resource use.

Integration: export → preview → import → export equivalence; duplicate import; invalid file; oversized file; unknown TZ; rollback when one item fails. E2E covers preview and confirmation. Commit: `phase 2K: add safe iCalendar import`.

### 2L — Task schema and rule ADR

**Tier:** M. **Depends on:** 2A.

Record the status/progress ADR, then add `tasks` with six statuses, four priorities, owner/assignee, parent, dates, progress, and reminder fields. Intentionally omit the project link until 2P can add it with a real foreign key. Implement pure transition validation.

Rules: Completed forces 100 and `completed_at`; reopen clears completion; progress 100 alone does not complete; parent cycles are impossible. Test all transition pairs, midnight overdue boundaries in user timezone, hierarchy cycles, and assignment authorization. Commit: `phase 2L: define task persistence and transitions`.

### 2M — Task CRUD API and list UI

**Tier:** M. **Depends on:** 2L.

Add actor-scoped task services/routes and a paginated/filterable/sortable list with create/edit/detail/delete/complete/reopen. Record task history for meaningful changes and update OpenAPI.

Integration covers CRUD, isolation, assignment, filters, sort, pagination, completion/reopen, and activity. E2E covers the basic task workflow on desktop/mobile. Commit: `phase 2M: add task list workflow`.

### 2N — Subtasks, tags, notes, and history

**Tier:** M. **Depends on:** 2M.

Add `task_notes`, task tags, subtask UI, and immutable history with actor plus before/after values. Notes are append/edit/delete only by allowed actors; history is not editable.

Test parent deletion policy, cycle denial, note isolation, tag isolation, exact history entries, and no secret/unbounded payload in history. Commit: `phase 2N: add task collaboration history`.

### 2O — Bulk actions and alternate task views

**Tier:** M. **Depends on:** 2N.

Add transactional bulk status/complete, duplicate, Kanban, and due-date calendar. A failed item rolls back the entire bulk action and reports the offending ID safely. Drag has a keyboard/select fallback. Project grouping waits for 2Q.

Integration asserts rollback and exact history rows. E2E covers Kanban move, bulk completion, overdue styling, due calendar, and 375px usability. Commit: `phase 2O: add advanced task views`.

### 2P — Project persistence and API

**Tier:** M. **Depends on:** 2L.

Add `projects` and `project_members`, plus a new nullable task→project foreign key, owner/member authorization, statuses/dates, manual progress, optional computed progress, and task assignment. Define the manual-override invariant before implementation.

Test CRUD, membership, ID guessing, member removal, computed stats, manual override, overdue counts, next deadline, and transactional task assignment. Commit: `phase 2P: add project domain`.

### 2Q — Project UI and overview

**Tier:** L. **Depends on:** 2P, 2O.

Build project list/detail/forms, member management, associated tasks, progress mode control, and overview statistics. Include empty/error states and confirmation dialogs.

E2E: create project → add member/task → update progress → verify stats → remove member; desktop/mobile. Commit: `phase 2Q: add project management UI`.

### 2R — Activity centre

**Tier:** M. **Depends on:** 2C, 2M, 2P.

Build actor-scoped activity queries/API/UI with chronological pagination, type/date filters, actor filter for authorized admins, and direct resource links. Keep security audit logs distinct.

Test visibility for owner/member/admin/read-only, deleted-resource entries, pagination stability, filters, and absence of audit-only details. Commit: `phase 2R: add activity centre`.

### 2S — Global search

**Tier:** M. **Depends on:** 2C, 2M, 2P.

Add permission-filtered search for event/task/project titles and descriptions, type filter, ranking, pagination, and direct links. Add FTS infrastructure only if measured to be appropriate; keep an adapter boundary for Phase 4 assets.

Tests prove another user's terms never leak through counts/snippets, Unicode/Hebrew search, ranking, pagination, empty query bounds, and deleted records. E2E covers keyboard search and navigation. Commit: `phase 2S: add authorized global search`.

### 2T — Dashboard aggregates and Phase 2 gate

**Tier:** M. **Depends on:** all Phase 2 packets.

Replace productivity placeholders with real calendar/task/project/activity aggregates, date-range filters, quick actions, widget links, overdue indicators, and per-user layout/visibility. Add a short TTL cache only with explicit mutation invalidation and tests; otherwise prefer indexed SQL.

Gate: aggregate fixtures equal SQL results before/after mutations; no cross-user counts; timezone boundaries; widget preferences; E2E flows 3–8 desktop/mobile; full coverage/build/start. Update `PROGRESS.md` and stop for approval. Commit: `phase 2T: complete productivity gate`.

## 6. Phase 3 packets — jobs, reminders, email, notifications

Requirements: `README.md` §§11, 15, 22; `docs/PLAN.md` §7; `docs/ARCHITECTURE.md` §§4–5, 9–10.

### 3A — Job schema and state machine

**Tier:** M. Add `jobs`, `job_runs`, and `schedules` with typed states, dedupe key, attempts, lease fields, indexes, and transition validation. No worker process. Test legal/illegal transitions, unique dedupe, due ordering, migration upgrade, and payload redaction. Commit: `phase 3A: add persistent job state`.

### 3B — Transactional claim/retry engine

**Tier:** H review, M implementation. Implement `BEGIN IMMEDIATE` claim, lease expiry, completion/failure, exponential backoff with bounded jitter, max attempts, and manual retry service. Keep job execution outside the claim transaction. Test two competing claimers, stale lease recovery, deterministic injected clock/randomness, dedupe, rollback, and exact attempt rows. Commit: `phase 3B: add reliable job engine`.

### 3C — Worker process and single-instance guard

**Tier:** M. Add worker lock/heartbeat, handler registry, polling loop, bounded concurrency, SIGTERM drain, `dev:worker`/`start:worker`, and worker health/status. Test second-worker refusal, heartbeat expiry takeover, graceful drain, unknown job type, and queued-job preservation. Commit: `phase 3C: add standalone worker`.

### 3D — SMTP adapter and templates

**Tier:** M. Add configuration validation, adapter interface, Nodemailer implementation, record-only test adapter, admin connection/test-email service, and HTML+text templates. With no credentials, expose `not_configured` and keep the app functional. Test redaction, escaping, both template parts, TLS modes, fake delivery, and stable degraded state. Commit: `phase 3D: add SMTP boundary`.

### 3E — Reminder schema and one-time planner

**Tier:** M. Add `reminder_schedules` and user/item offsets. Implement pure offset-to-UTC calculations for non-recurring events/tasks and transactional replace/cancel on edit/delete. Test all standard/custom offsets, Jerusalem DST, due-at-midnight, past times, override precedence, edit replacement, and deletion cancellation. Commit: `phase 3E: add reminder planning`.

### 3F — Recurring reminders and overdue policy

**Tier:** H review, M implementation. Materialize a bounded rolling horizon from Phase 2 occurrence keys and document overdue policy. Make horizon extension idempotent. Test DST-crossing series, exception/split edits, horizon overlap, daily digest cap, and no reminder for past events. Commit: `phase 3F: add recurring reminder policy`.

### 3G — Idempotent delivery pipeline

**Tier:** H review, M implementation. Add `email_delivery_attempts` and `notifications`; implement due scan → enqueue → email attempt → in-app mirror with unique idempotency keys and transactional status changes. Test success, transient/permanent failure, retry, crash at each state boundary, and exactly-once visible outcome. Commit: `phase 3G: add reminder delivery pipeline`.

### 3H — Notification centre

**Tier:** L. Add authorized paginated API/UI for unread/read, upcoming reminders, mark-read, and mark-all-read. Do not expose other users' notification content or raw delivery errors. E2E covers read state, pagination, links, mobile layout, and no-SMTP in-app notifications. Commit: `phase 3H: add notification centre`.

### 3I — Job and delivery administration

**Tier:** M. Add admin status, sanitized failures, manual retry, schedules, worker heartbeat, and SMTP configuration state. No secret fields or private message bodies. Test RBAC, sanitized errors, retry transition, and stale worker display. Commit: `phase 3I: add worker administration`.

### 3J — Restart durability and Phase 3 gate

**Tier:** H review. Build process-level integration tests: enqueue → kill worker → expire/restart → exactly one delivery; running-job recovery; edit/delete cancellation; SIGTERM drain. Run E2E flows 9, 10, 14; verify app works without SMTP. Update progress and stop for approval. Commit: `phase 3J: complete notification durability gate`.

## 7. Phase 4 packets — digital assets

Requirements: `README.md` §9, relevant §§15–17, 19, 22; `docs/PLAN.md` §8; `docs/ARCHITECTURE.md` §§7, 9–10.

### 4A — Asset schema and invariants

**Tier:** M. Add assets, sources, extracted/provider metadata separation, file variants, collections/items, tags, statuses, and stable provider/account/remote-ID uniqueness. Define private ownership and the invariant that originals are never modified. Test constraints, dedupe, isolation, and migration upgrade. Commit: `phase 4A: add asset data model`.

### 4B — Safe local upload and storage

**Tier:** M. Add bounded streaming upload, extension/MIME/magic-byte allowlist, random storage names under `data/uploads`, path-containment checks, partial-file cleanup, and authorized original delivery. No metadata extraction. Test traversal, polyglots, size limits, unsupported media, duplicate bytes, interrupted upload, and cross-user reads. Commit: `phase 4B: add secure asset upload`.

### 4C — Image metadata extraction

**Tier:** M. Pin `sharp`/EXIF dependencies after a capability spike. Extract format, dimensions, orientation, and capture date with provenance; never invent absent values. Test JPEG/PNG/WebP/GIF fixtures, orientation, malformed EXIF, no date, Unicode filename, and unsupported HEIC state. Commit: `phase 4C: extract image metadata`.

### 4D — Video metadata capability

**Tier:** M. Detect `ffprobe`, extract duration/resolution for supported fixtures, and store explicit `unavailable` when absent/failing. Never transcode. Test present/absent executable, timeout, corrupt video, and no invented fields. Commit: `phase 4D: add graceful video metadata`.

### 4E — Thumbnail job and cache security

**Tier:** M. Add worker thumbnail handler, permission-isolated cache paths, size/format policy, cache metadata, and bounded eviction. Originals stay byte-identical. Test path containment, another-user denial, deterministic variant key, regeneration, eviction, and source checksum. Commit: `phase 4E: add protected thumbnail cache`.

### 4F — Asset browse API

**Tier:** M. Add authorized pagination, filter/sort, filename search, metadata detail, and thumbnail/original endpoints. Return extracted and provider metadata separately. Test every filter, stable pagination, ID guessing, missing variant, range/stream behavior, and error redaction. Commit: `phase 4F: add asset browse API`.

### 4G — Grid, list, detail, and preview UI

**Tier:** L. Build responsive grid/list, detail panel, image preview, MP4 preview, and explicit non-previewable video state. Include lazy thumbnails, empty/loading/error states, multi-select, keyboard navigation, and 375px checks. Commit: `phase 4G: add asset browsing UI`.

### 4H — Virtual organization and bulk metadata

**Tier:** M. Add collection/tag/category/description/note services and bulk edits. No endpoint may rename/move/delete original files. Test collection membership, transactional bulk rollback, tag ownership, concurrent edits, and original checksums. E2E covers collections and bulk tagging. Commit: `phase 4H: add virtual asset organization`.

### 4I — Read-only directory scan

**Tier:** M. Add optional `ASSET_SCAN_DIR`, containment/capability validation, resumable scan job, stable local source identity, and delete-record-without-delete-file behavior. Snapshot checksums before/after integration tests. Test symlink escape, inaccessible files, interruption/resume, duplicate scan, and disabled state. Commit: `phase 4I: add non-destructive local indexing`.

### 4J — Asset search/dashboard and Phase 4 gate

**Tier:** M. Add asset FTS adapter to global search and real dashboard counts/sizes/recent items. Run upload/index/browse/edit/collection/scan E2E, cross-user thumbnail tests, 375px grid, and original-byte checksum gate. Update progress and stop for approval. Commit: `phase 4J: complete asset gate`.

## 8. Phase 5 packets — OneDrive

Requirements: `README.md` §10 and relevant §§15, 19, 22, 24; `docs/PLAN.md` §9; `docs/ARCHITECTURE.md` §6.

### 5A — Provider contract and missing-credentials UI

**Tier:** M. Define `IntegrationProvider` types for connection status, folder listing, item metadata, thumbnails, and delta pages. Add configuration validation and a stable “configuration required” UI/API when Graph credentials are absent. No fake connection. Test app startup and all existing features with Graph absent. Commit: `phase 5A: add integration provider boundary`.

### 5B — Graph transport and mock server

**Tier:** M. Implement typed Graph HTTP transport with pagination, normalized error taxonomy, request IDs, cancellation, response bounds, and a local mock server/fixtures. No OAuth or DB. Test page traversal, malformed JSON, 401/403/404/429/5xx, timeout, and no token logging. Commit: `phase 5B: add tested Graph transport`.

### 5C — OAuth/token ADR and encrypted persistence

**Tier:** H review, M implementation. Decide confidential/public client and PKCE in an ADR; define exact scopes (`offline_access Files.Read`), callback/state/nonce rules, token refresh, and reauth taxonomy. Add connection table with versioned AES-GCM storage. Test tamper detection, user isolation, state expiry/replay, token redaction, and key/version failure. Commit: `phase 5C: secure OneDrive connection state`.

### 5D — Connect, callback, status, disconnect

**Tier:** M. Implement consent redirect/callback, account status, and disconnect through the provider boundary. With mock identity endpoints, test success, denied consent, invalid/replayed state, callback error, refresh failure, disconnect token purge, and another-user access. Real credentials remain optional. Commit: `phase 5D: add OneDrive connection lifecycle`.

### 5E — Folder browsing and selection

**Tier:** M. Add paginated folder traversal, picker UI, selected-folder persistence, include/exclude flags, and actor scoping. Test deep pagination, empty drive, permission errors, stable IDs, selection persistence, and cross-user isolation. Commit: `phase 5E: add OneDrive folder selection`.

### 5F — Full-scan sync engine

**Tier:** M. Add job-per-folder full scan, supported-media mapping into Phase 4 assets, stable `item.id` dedupe, progress/checkpoints, and interruption-safe resume. Avoid full downloads. Test duplicate filenames/different IDs, same ID rename, partial failure, resume, removed selection, and exact progress counts. Commit: `phase 5F: add resumable OneDrive full scan`.

### 5G — Provider thumbnails and protected cache

**Tier:** M. Fetch available thumbnails through the provider, store them via Phase 4 cache boundaries, and fall back to a generated/absent state. Test authorization, cache isolation, expired URL, size/content validation, retry, and no full-size private caching. Commit: `phase 5G: add OneDrive thumbnails`.

### 5H — Delta sync and throttling

**Tier:** H review, M implementation. Add delta-link checkpointing, pagination, deletion/update handling, `Retry-After`, backoff, global/per-user concurrency, token-expiry refresh, and safe resume. Commit delta link only after a complete page chain.

Mock integration covers 429, expiry mid-page, crash before checkpoint, replay, remote deletion, rename with stable ID, malformed delta, and duplicate suppression. Commit: `phase 5H: add resilient OneDrive delta sync`.

### 5I — Sync status, schedule, and administration

**Tier:** M. Add user/admin status, last run and counts, sanitized errors, manual sync, default-off schedule, reauthentication call to action, and disconnect cleanup. Test RBAC, rate limits, schedule dedupe, error redaction, and folder-level failure isolation. Commit: `phase 5I: add OneDrive sync operations`.

### 5J — Documentation, optional real check, and Phase 5 gate

**Tier:** M. Write Entra registration/scopes/redirect documentation. Run mocked Graph gate, missing-credentials E2E flow 13, and full app regression without Graph env. If credentials are supplied, run a read-only smoke test and record exactly what was verified; otherwise mark only real-tenant verification external. Stop for approval. Commit: `phase 5J: complete OneDrive gate`.

## 9. Phase 6 packets — production readiness

Requirements: `README.md` §§13–14, 19–23, 26–27; `docs/PLAN.md` §10.

### 6A — Dependency and test inventory

**Tier:** M. Run the entire suite/coverage/audit, classify findings, remove dead dependencies, and create a spec-to-test inventory. Do not upgrade major versions inside this packet. Every accepted advisory needs rationale and mitigation. Commit: `phase 6A: inventory release quality`.

### 6B — Security review and fixes

**Tier:** H review. Review CSP/headers, CSRF/origins, cookies, rate limits, uploads/path traversal, logs/errors, secrets scan, MFA/session policy, IDOR, OAuth isolation, and worker/admin endpoints. Add regression tests for every finding. Do not combine dependency upgrades. Commit: `phase 6B: harden release security`.

### 6C — Online backup and guarded restore

**Tier:** H review, M implementation. Add online SQLite backup, integrity check, timestamped files/retention, and restore with exact target confirmation, pre-restore backup, stopped-process requirement, migration check, and atomic replacement. Test backup under writes, corrupt backup rejection, restore equality, wrong-path refusal, and rollback. Commit: `phase 6C: add verified backup restore`.

### 6D — Production web image

**Tier:** M. Verify/refine multi-stage Debian-slim Dockerfile, non-root UID, standalone assets/migrations, healthcheck, writable data only, no dev dependencies/secrets, and pinned Node. Test image build/start/health/migration/persistence if Docker exists; otherwise record exact external commands without claiming success. Commit: `phase 6D: harden web container`.

### 6E — Worker compose and shutdown durability

**Tier:** H review. Add web+worker compose services sharing only required volumes/env, health/restart policies, single-worker behavior, graceful shutdown, and migration ordering. Test restart during a claimed job and no duplicate processing. Commit: `phase 6E: deploy web and worker safely`.

### 6F — Caddy and HTTPS deployment

**Tier:** M. Add configurable Caddyfile, HTTPS, proxy headers, body limits, security headers without conflicting CSP, health routing, and domain placeholders. Document firewall/DNS/certificate steps. Verify with a disposable domain/VPS when available; otherwise mark external. Commit: `phase 6F: add HTTPS edge deployment`.

### 6G — Operator and integration documentation

**Tier:** L. Create the approved normalized spec copy/project README arrangement, local setup, env reference, commands, architecture tree, admin recovery, SMTP, OneDrive, backup, upgrade, troubleshooting, and deployment documents. Every command must match package scripts and be dry-run checked. Do not include real credentials. Commit: `phase 6G: complete operator documentation`.

### 6H — Final validation and release report

**Tier:** H review. Execute `npm run verify`, production start/health, migration upgrade, backup/restore, restart durability, secrets scan, desktop/mobile E2E, and Docker/VPS checks available in the environment. Reconcile every spec §26 item as verified, external-blocked, or incomplete—never silently omitted. Record exact outputs in `PROGRESS.md`, produce the §27 report, and stop for final approval. Commit: `phase 6H: complete release gate`.

## 10. Review checklist for the human between packets

Before accepting a packet, check:

- the diff contains only the named packet;
- migration history is append-only;
- permission keys and role grants are intentional;
- another-user denial is tested;
- Hebrew and English keys match;
- no secrets, absolute local paths, or fixture credentials entered production files;
- no fake external success state exists;
- tests prove persistence, not only mocked UI state;
- the production build was run with the dev server stopped;
- `PROGRESS.md` reports measured results and limitations;
- the commit is green before the next packet begins.

## 11. Recommended cadence

- Routine packet: one local-AI session, one review, one green commit.
- High-risk packet: contract review with H → local implementation → automated gate → H diff review → commit.
- After every five packets: run the full Playwright suite to catch cross-module regressions.
- At each `2T`/`3J`/`4J`/`5J`/`6H` macro gate: run all tests and wait for explicit user approval before the next original phase.
- If a packet fails three times for the same reason, stop. Preserve evidence and escalate instead of weakening the design.
