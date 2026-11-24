# Local-AI Prompt 4B — Safe local upload and storage

Generated from `docs/LOCAL_AI_ROADMAP.md` by `scripts/generate-local-ai-prompts.mjs`.

Copy everything inside the block into a **new local-model chat** started in `C:\src\mysite`.

```text
You are implementing exactly one bounded packet in the Personal Management Dashboard repository.

WORKING DIRECTORY
C:\src\mysite

PACKET
4B — Safe local upload and storage

BASELINE AND SAFETY

Before changing anything, run:

- git status --short
- git branch --show-current
- git log -1 --oneline

Treat the current green HEAD as the baseline. If the worktree contains changes you did not create, preserve them and work around them. Do not use git reset --hard, git checkout --, or destructive cleanup.

The repository may contain these unrelated untracked files:

- Modelfile
- tokens for admin.txt

Do not read, edit, stage, delete, or commit either file.

READ BEFORE ACTING

Read these sources before writing code:

1. AGENTS.md in full.
2. docs/LOCAL_AI_ROADMAP.md sections 2–4 and packet 4B.
3. `README.md` §9, relevant §§15–17, 19, 22; `docs/PLAN.md` §8; `docs/ARCHITECTURE.md` §§7, 9–10.
4. The relevant sections of docs/ARCHITECTURE.md cited by the roadmap.
5. PROGRESS.md current state and newest log entry.
6. Existing production and test files in the module this packet changes.

For every Next.js API or convention you touch, first read the relevant installed guide under node_modules/next/dist/docs/. The installed Next.js documentation is authoritative; do not rely on training-memory conventions.

Inspect the existing implementation and tests before proposing new abstractions. Prefer extending existing actor, RBAC, audit/activity, validation, error, localization, and database patterns.

SOURCE PACKET CONTRACT

**Tier:** M. Add bounded streaming upload, extension/MIME/magic-byte allowlist, random storage names under `data/uploads`, path-containment checks, partial-file cleanup, and authorized original delivery. No metadata extraction. Test traversal, polyglots, size limits, unsupported media, duplicate bytes, interrupted upload, and cross-user reads. Commit: `phase 4B: add secure asset upload`.

SCOPE CONTROL

Implement only packet 4B. Do not begin the next packet, create speculative later-phase tables, add placeholder APIs, or perform unrelated refactors/dependency upgrades.

A normal packet should stay within:

- one append-only migration and its generated metadata;
- eight production files, excluding migration metadata;
- four test files;
- one primary service or one primary UI surface when either is substantial.

If accurate implementation cannot fit, stop before editing and propose a smaller 4B.1/4B.2 split with reasons and independent gates.

MIGRATION AND DATA RULES

- Existing migration SQL is immutable history.
- If this packet changes schema, add one new migration; otherwise do not create a migration.
- Never rewrite, rename, or delete an old migration.
- For schema changes, review generated SQL, preserve snapshot parent IDs and journal order, and extend the migration-upgrade integration test.
- Seed changes must be idempotent and remove obsolete grants as well as add new grants.
- Store timestamps in UTC and apply the user's IANA timezone at presentation/scheduling boundaries.
- Do not invent unavailable external or media metadata.

AUTHORIZATION AND SECURITY

- Every service receives an authenticated actor or actor-derived context.
- Every resource query includes owner, membership, or explicit-grant scoping.
- Guessing another user's ID must return the documented 403/404 without leaking the record.
- UI hiding is never authorization.
- Mutations use existing validation, same-origin, action guard, rate-limit where sensitive, and audit/activity patterns.
- Add explicit cross-user and read_only denial tests.
- Never persist or log passwords, tokens, MFA/recovery secrets, authorization headers, or unbounded request bodies.

LOCALIZATION AND UI

- Hebrew remains the default; English remains complete and selectable.
- Add Hebrew and English dictionary keys together.
- Use logical RTL CSS properties.
- Keep machine values as LTR islands.
- Include empty/loading/error states, labels, keyboard access, and confirmation for destructive actions when this packet has UI.

TEST REQUIREMENTS

Implement every test named by the source packet contract. Add regression coverage for:

- happy path;
- invalid input and boundary values;
- another-user isolation;
- read_only denial for writes;
- persistence across a fresh database connection;
- migration from the prior committed schema when a migration is added;
- Hebrew/English parity when strings are added;
- no stack trace or secret leakage at HTTP boundaries.

Use temporary SQLite databases with production pragmas. E2E tests must use visible controls against the production standalone server; do not bypass the UI with invented test-only APIs.

MICRO-GATE

Run commands sequentially. Never run next dev and next build concurrently. Never run npm run build in parallel with npm run typecheck.

1. Packet-specific unit tests.
2. Packet-specific integration tests.
3. npm test
4. npm run typecheck
5. npm run lint
6. npm run format:check
7. npm run build
8. Packet-specific E2E when the packet changes UI or HTTP behavior.

If a command fails, diagnose the real cause. Do not weaken an assertion, authorization predicate, validation rule, or migration guarantee merely to make it green. Rerun the failed command and every later gate command.

PROGRESS AND COMMIT

Update PROGRESS.md with the packet status, migration name if any, commands actually run, measured test counts, and honest limitations. Do not mark the parent phase complete unless this is its macro-gate packet.

Do not stage Modelfile or tokens for admin.txt.

If and only if every required gate is green, create one commit with this message:

phase 4B: add secure asset upload

Do not push to GitHub unless explicitly instructed.

FINAL HANDOFF

Stop after packet 4B. Report:

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

Include exact command results and test counts. Do not begin the next packet.
```
