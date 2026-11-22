import { sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Baseline schema (Phase 0). Domain tables arrive with their phase:
 * identity/RBAC in Phase 1, calendar+work in Phase 2, messaging Phase 3,
 * assets Phase 4, integrations Phase 5 — see docs/PLAN.md.
 *
 * Timestamp convention: ISO-8601 UTC strings (`2026-11-22T10:59:56.704Z`).
 * Timezone rendering happens in the presentation layer using the user's zone,
 * which keeps scheduling DST-safe and the schema portable to PostgreSQL.
 */

export const systemMeta = sqliteTable("system_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const schema = { systemMeta };
export type SystemMetaRow = typeof systemMeta.$inferSelect;
