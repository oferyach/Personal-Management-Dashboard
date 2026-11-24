# Local-AI Prompt 2A — Shared productivity vocabulary and schema

This is the fully expanded first-packet prompt. Copy everything inside the block into a **new local-model chat** started in `C:\src\mysite`.

```text
You are implementing exactly one bounded packet in the Personal Management Dashboard repository.

WORKING DIRECTORY
C:\src\mysite

PACKET
2A — Shared productivity vocabulary and schema

BASELINE

The minimum green implementation baseline is:
ff85d68 docs: split remaining work into local AI packets

Use the current HEAD if later commits contain only this prompt library or other approved documentation. Before changing anything, run:

- git status --short
- git branch --show-current
- git log -3 --oneline

The repository may contain these unrelated untracked files:

- Modelfile
- tokens for admin.txt

Do not read, edit, stage, delete, or commit either file. Preserve every unrelated user change.

READ BEFORE ACTING

Read these files and sections in order:

1. AGENTS.md — read it completely and follow it.
2. docs/LOCAL_AI_ROADMAP.md:
   - Section 2: Mandatory operating protocol
   - Section 3: Model-budget strategy
   - Section 4: Dependency order
   - Section “2A — Shared productivity vocabulary and schema” only
3. docs/PLAN.md:
   - Section 3: Cross-cutting foundations
   - Section 6: Phase 2
4. docs/ARCHITECTURE.md:
   - Sections 1–3
   - Sections 8–10
5. README.md:
   - §5 Dashboard
   - §6 Calendar and Event Management
   - §7 Task Management
   - §8 Project Management
   - §16 Activity History and Reporting
   - §17 Search
   - §22 Testing and Quality Assurance
6. PROGRESS.md current state and newest log entry.

Before editing, inspect:

- package.json
- all current files under src/db/schema/
- all current files under src/db/seed/
- src/lib/rbac.ts
- src/lib/audit.ts
- src/lib/actionGuard.ts
- tests/integration/migrationUpgrade.test.ts
- existing RBAC, audit, database, and migration tests

If you need to modify any Next.js API, first read the relevant installed documentation under node_modules/next/dist/docs/. Do not rely on remembered Next.js conventions.

Inspect the existing implementation before proposing changes. Present a short file-level plan, then implement. Do not ask for clarification unless a genuinely blocking product decision is absent from the specification.

OBJECTIVE

Implement only the shared productivity foundations required by later calendar, task, project, activity, dashboard, and search packets.

This packet must be independently usable and testable. Do not implement events, tasks, projects, dashboard widgets, search UI, calendar UI, or placeholder APIs.

REQUIRED DELIVERABLES

1. Shared typed vocabulary

Create appropriately located TypeScript types/constants for shared productivity concepts.

Include only concepts genuinely shared by later modules, such as:

- supported productivity resource kinds;
- resource ownership/visibility vocabulary;
- stable activity resource/action vocabulary;
- shared date/query-window validation contracts where justified.

Do not prematurely define full event, task, or project models.

Use string unions or constants that prevent arbitrary machine codes from entering persisted activity data.

2. Tags schema

Add normalized tables for tags and tag links.

Requirements:

- stable text IDs consistent with the existing project;
- owner user ID;
- tag name;
- optional color only if justified by the specification;
- normalized name or equivalent uniqueness mechanism;
- created and updated UTC timestamps;
- unique tag name per owner using a documented case-normalization rule;
- tag links reference tag ID, supported resource type, and resource ID;
- suitable owner/name and resource lookup indexes;
- foreign keys and intentional delete behavior.

A user must not be able to read or attach another user's private tag.

Do not create event, task, project, or asset tables in this packet.

3. User-visible activity schema

Add an activity_log table separate from audit_logs.

It must support:

- actor user ID where available;
- owner or visibility subject needed for authorization;
- supported resource type;
- resource ID;
- stable activity action;
- bounded, sanitized JSON detail;
- UTC creation timestamp;
- chronological pagination indexes;
- optional direct-link metadata only if it cannot create an open redirect.

Security audit information and user-visible activity must remain separate.

Passwords, tokens, MFA secrets, recovery codes, authorization headers, and unrestricted request bodies must never be persisted in activity details.

4. RBAC permissions

Add the Phase 2 permission vocabulary needed by future calendar, task, project, activity, dashboard, and search work.

Follow the repository's existing permission naming style.

Requirements:

- define exact permission keys;
- grant them deliberately to super_admin, admin, user, and read_only;
- preserve the distinction between own, explicitly shared, and any/all resources;
- read_only receives no write permissions;
- ordinary users receive no global any access;
- RBAC seeding remains idempotent;
- obsolete grants are removed, not merely ignored.

Do not implement the future resources themselves.

5. Shared actor-scoped services

Implement only the minimal services necessary to prove the foundation:

- create/list/update/delete an actor's own tags;
- reject another user's tag ID without revealing private data;
- attach/detach a tag only through an actor-scoped interface;
- insert a sanitized activity entry;
- list activity entries visible to the actor with stable chronological pagination.

If generic tag attachment cannot be safely completed before resource tables exist, implement and test the validation/service boundary without inventing fake resources. Document exactly what remains for packet 2B or 2L.

Do not add UI screens.

6. Migration

Create one new append-only Drizzle migration.

Rules:

- do not edit, rename, delete, or regenerate previous migration SQL;
- inspect the generated SQL;
- preserve drizzle/meta snapshot lineage;
- extend the migration-upgrade integration test so it reconstructs the Phase 0 database, upgrades through Phase 1, applies this migration, proves existing identity/audit data remains, and proves the new tables/indexes exist.

7. Documentation

Update PROGRESS.md with:

- packet 2A status;
- migration name;
- exact tests and commands run;
- measured results;
- any consciously deferred attachment behavior.

Do not mark Phase 2 complete.

NON-GOALS

Do not implement:

- events or recurrence;
- calendar screens;
- tasks or projects;
- dashboard aggregates;
- global search;
- notifications or background jobs;
- assets;
- SMTP or OneDrive;
- broad refactors;
- dependency upgrades;
- generated placeholder data.

Do not change authentication, sessions, MFA, or existing Phase 1 behavior unless a test proves a direct regression caused by this packet. If such a problem appears, stop and report it instead of broadening scope.

AUTHORIZATION REQUIREMENTS

- Every service receives an authenticated actor or actor-derived context.
- Database queries include the ownership/visibility predicate.
- UI hiding is never authorization.
- Guessing another user's tag or activity ID produces the documented 403/404 behavior without confirming its existence.
- Add exact tests for super_admin, admin, user, and read_only behavior.
- Avoid a generic get-by-ID service without actor scoping.

MIGRATION SAFETY

Existing migration files are immutable history.

If the schema generator proposes rewriting a previous migration, stop. Do not accept it.

Only add one new migration and its correctly linked metadata.

TESTS REQUIRED

Add focused unit tests covering:

- shared resource/action vocabulary rejects unknown values;
- activity detail sanitizer removes secret-like keys recursively;
- tag-name normalization and validation;
- exact new permission matrix for all four roles;
- read_only has no new write permissions;
- ordinary user has no new global any permissions.

Add focused integration tests covering:

- new migration applies to an empty database;
- Phase 0/Phase 1 database upgrades without data loss;
- tag CRUD for the owner;
- duplicate normalized tag name is rejected;
- user A cannot read/update/delete user B's tag;
- read_only cannot create or modify tags;
- tag listing is owner-scoped;
- activity insertion stores a sanitized bounded detail object;
- activity listing is visibility-scoped;
- chronological pagination has stable ordering;
- RBAC seeding twice produces the same grants.

Use temporary SQLite databases with production pragmas.

MICRO-GATE

Run commands sequentially in this order.

Never run next dev and next build concurrently. Never run npm run build in parallel with npm run typecheck.

1. Targeted unit tests for packet 2A.
2. Targeted integration tests for packet 2A.
3. npm test
4. npm run typecheck
5. npm run lint
6. npm run format:check
7. npm run build

There is no E2E requirement for this packet because it must not add UI or an HTTP route.

If a command fails:

- diagnose the actual cause;
- fix product code or a genuinely incorrect test contract;
- do not weaken assertions, authorization, validation, or migration guarantees;
- rerun the failed command and all later micro-gate commands.

Do not claim a command passed unless it was actually run.

SCOPE LIMIT

Aim for:

- one new migration;
- no more than eight production files, excluding generated migration metadata;
- no more than four test files;
- no unrelated cleanup.

If this cannot be implemented accurately within those limits, stop and propose splitting 2A into 2A.1 and 2A.2 before editing.

WORKING STYLE

- Use rg or rg --files for repository searches.
- Use apply_patch for file edits.
- Preserve unrelated user changes.
- Do not use destructive Git commands.
- Do not stage or commit Modelfile or tokens for admin.txt.
- Keep Hebrew and English dictionary parity if any presentation string is introduced.
- Use UTC timestamps in persistence.
- Do not create a commit until every micro-gate command is green.

FINAL RESPONSE AND HANDOFF

Stop after packet 2A. Do not begin packet 2B.

Report exactly:

Packet:
Commit:
Implemented:
Migration:
Changed files:
Targeted tests:
Full tests/build:
E2E:
Known limitations:
Files the next packet should read first:

Include exact command results and test counts.

If all gates are green, create only this commit:

phase 2A: add shared productivity foundations

Do not push to GitHub unless explicitly instructed.
```
