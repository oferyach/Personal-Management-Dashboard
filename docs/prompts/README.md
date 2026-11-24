# Local-AI Prompt Library

Each file is a self-contained copy/paste prompt for one roadmap packet. Start a fresh model chat in `C:\src\mysite` for each packet and use only one prompt at a time.

Packet 2A is intentionally hand-authored with extra detail. All other prompt files are generated from `docs/LOCAL_AI_ROADMAP.md`.

Regenerate after changing the roadmap:

```powershell
node scripts/generate-local-ai-prompts.mjs
node scripts/generate-local-ai-prompts.mjs --check
```

| Packet | Scope | File |
| --- | --- | --- |
| 2A | Shared productivity vocabulary and schema | [prompt](./2A-shared-productivity-vocabulary-and-schema.md) |
| 2B | Event schema and repository | [prompt](./2B-event-schema-and-repository.md) |
| 2C | Non-recurring event service and API | [prompt](./2C-non-recurring-event-service-and-api.md) |
| 2D | Event form, agenda, and detail UI | [prompt](./2D-event-form-agenda-and-detail-ui.md) |
| 2E | Pure recurrence engine and ADR | [prompt](./2E-pure-recurrence-engine-and-adr.md) |
| 2F | Recurrence persistence and reads | [prompt](./2F-recurrence-persistence-and-reads.md) |
| 2G | Recurrence edit/delete modes | [prompt](./2G-recurrence-edit-delete-modes.md) |
| 2H | Calendar month/week/day views | [prompt](./2H-calendar-month-week-day-views.md) |
| 2I | Calendar interactions and filters | [prompt](./2I-calendar-interactions-and-filters.md) |
| 2J | iCalendar export | [prompt](./2J-icalendar-export.md) |
| 2K | iCalendar import preview and commit | [prompt](./2K-icalendar-import-preview-and-commit.md) |
| 2L | Task schema and rule ADR | [prompt](./2L-task-schema-and-rule-adr.md) |
| 2M | Task CRUD API and list UI | [prompt](./2M-task-crud-api-and-list-ui.md) |
| 2N | Subtasks, tags, notes, and history | [prompt](./2N-subtasks-tags-notes-and-history.md) |
| 2O | Bulk actions and alternate task views | [prompt](./2O-bulk-actions-and-alternate-task-views.md) |
| 2P | Project persistence and API | [prompt](./2P-project-persistence-and-api.md) |
| 2Q | Project UI and overview | [prompt](./2Q-project-ui-and-overview.md) |
| 2R | Activity centre | [prompt](./2R-activity-centre.md) |
| 2S | Global search | [prompt](./2S-global-search.md) |
| 2T | Dashboard aggregates and Phase 2 gate | [prompt](./2T-dashboard-aggregates-and-phase-2-gate.md) |
| 3A | Job schema and state machine | [prompt](./3A-job-schema-and-state-machine.md) |
| 3B | Transactional claim/retry engine | [prompt](./3B-transactional-claim-retry-engine.md) |
| 3C | Worker process and single-instance guard | [prompt](./3C-worker-process-and-single-instance-guard.md) |
| 3D | SMTP adapter and templates | [prompt](./3D-smtp-adapter-and-templates.md) |
| 3E | Reminder schema and one-time planner | [prompt](./3E-reminder-schema-and-one-time-planner.md) |
| 3F | Recurring reminders and overdue policy | [prompt](./3F-recurring-reminders-and-overdue-policy.md) |
| 3G | Idempotent delivery pipeline | [prompt](./3G-idempotent-delivery-pipeline.md) |
| 3H | Notification centre | [prompt](./3H-notification-centre.md) |
| 3I | Job and delivery administration | [prompt](./3I-job-and-delivery-administration.md) |
| 3J | Restart durability and Phase 3 gate | [prompt](./3J-restart-durability-and-phase-3-gate.md) |
| 4A | Asset schema and invariants | [prompt](./4A-asset-schema-and-invariants.md) |
| 4B | Safe local upload and storage | [prompt](./4B-safe-local-upload-and-storage.md) |
| 4C | Image metadata extraction | [prompt](./4C-image-metadata-extraction.md) |
| 4D | Video metadata capability | [prompt](./4D-video-metadata-capability.md) |
| 4E | Thumbnail job and cache security | [prompt](./4E-thumbnail-job-and-cache-security.md) |
| 4F | Asset browse API | [prompt](./4F-asset-browse-api.md) |
| 4G | Grid, list, detail, and preview UI | [prompt](./4G-grid-list-detail-and-preview-ui.md) |
| 4H | Virtual organization and bulk metadata | [prompt](./4H-virtual-organization-and-bulk-metadata.md) |
| 4I | Read-only directory scan | [prompt](./4I-read-only-directory-scan.md) |
| 4J | Asset search/dashboard and Phase 4 gate | [prompt](./4J-asset-search-dashboard-and-phase-4-gate.md) |
| 5A | Provider contract and missing-credentials UI | [prompt](./5A-provider-contract-and-missing-credentials-ui.md) |
| 5B | Graph transport and mock server | [prompt](./5B-graph-transport-and-mock-server.md) |
| 5C | OAuth/token ADR and encrypted persistence | [prompt](./5C-oauth-token-adr-and-encrypted-persistence.md) |
| 5D | Connect, callback, status, disconnect | [prompt](./5D-connect-callback-status-disconnect.md) |
| 5E | Folder browsing and selection | [prompt](./5E-folder-browsing-and-selection.md) |
| 5F | Full-scan sync engine | [prompt](./5F-full-scan-sync-engine.md) |
| 5G | Provider thumbnails and protected cache | [prompt](./5G-provider-thumbnails-and-protected-cache.md) |
| 5H | Delta sync and throttling | [prompt](./5H-delta-sync-and-throttling.md) |
| 5I | Sync status, schedule, and administration | [prompt](./5I-sync-status-schedule-and-administration.md) |
| 5J | Documentation, optional real check, and Phase 5 gate | [prompt](./5J-documentation-optional-real-check-and-phase-5-gate.md) |
| 6A | Dependency and test inventory | [prompt](./6A-dependency-and-test-inventory.md) |
| 6B | Security review and fixes | [prompt](./6B-security-review-and-fixes.md) |
| 6C | Online backup and guarded restore | [prompt](./6C-online-backup-and-guarded-restore.md) |
| 6D | Production web image | [prompt](./6D-production-web-image.md) |
| 6E | Worker compose and shutdown durability | [prompt](./6E-worker-compose-and-shutdown-durability.md) |
| 6F | Caddy and HTTPS deployment | [prompt](./6F-caddy-and-https-deployment.md) |
| 6G | Operator and integration documentation | [prompt](./6G-operator-and-integration-documentation.md) |
| 6H | Final validation and release report | [prompt](./6H-final-validation-and-release-report.md) |
