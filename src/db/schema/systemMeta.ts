import { sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Baseline schema (Phase 0).
 *
 * Timestamp convention for every table in this project: ISO-8601 UTC strings
 * (`2026-11-22T10:59:56.704Z`). Timezone rendering happens in the presentation
 * layer using the user's zone (default `Asia/Jerusalem`), which keeps scheduling
 * DST-safe and the schema portable to PostgreSQL.
 */

export const systemMeta = sqliteTable("system_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull(),
});
