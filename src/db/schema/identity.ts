import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { users } from "./auth";

/**
 * RBAC and user-preference tables (Phase 1, work items 1.2 and 1.9).
 *
 * RBAC is deliberately ours (`roles`, `permissions`, `role_permissions`,
 * `resource_permissions`) even though Better Auth ships an `admin` plugin: the
 * spec's permission model is fine-grained (per-resource sharing for calendars
 * and tasks, audited role changes) and must be readable in one place. Better
 * Auth's plugin only supplies the role *string* on `users.role`; every check
 * goes through `src/lib/rbac.ts`.
 *
 * The four roles come from the spec. Their permission sets are seeded
 * (`src/db/seed/rbac.ts`) into `role_permissions`, so the matrix is data, not a
 * wall of `if` statements — and tests can diff it against the plan.
 */

export const ROLES = ["super_admin", "admin", "user", "read_only"] as const;
export type RoleKey = (typeof ROLES)[number];

export const roles = sqliteTable("roles", {
  key: text("key").primaryKey(),
  /** Privileged roles require MFA enrollment (spec §12 policy). */
  privileged: integer("privileged", { mode: "boolean" }).notNull().default(false),
  /** Lower rank = more powerful; used for role assignment checks and ordering. */
  rank: integer("rank").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const permissions = sqliteTable("permissions", {
  /** Stable machine key, e.g. `calendar.edit.own`. Labels live in the i18n dictionaries. */
  key: text("key").primaryKey(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const role_permissions = sqliteTable(
  "role_permissions",
  {
    roleKey: text("role_key")
      .notNull()
      .references(() => roles.key, { onDelete: "cascade" }),
    permissionKey: text("permission_key")
      .notNull()
      .references(() => permissions.key, { onDelete: "cascade" }),
    grantedAt: text("granted_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.roleKey, table.permissionKey] }),
    index("role_permissions_permission_idx").on(table.permissionKey),
  ],
);

/**
 * Per-resource grants (spec §12 "resource-level permissions ... share specific
 * items with specific users"). Populated from Phase 2 onward when items are
 * shared; `src/lib/rbac.ts` reads it, and the sharing UI renders from it so
 * users can see who can see what.
 */
export const resource_permissions = sqliteTable(
  "resource_permissions",
  {
    id: text("id").primaryKey(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id").notNull(),
    granteeUserId: text("grantee_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    permissionKey: text("resource_permission_key")
      .notNull()
      .references(() => permissions.key, { onDelete: "cascade" }),
    grantedBy: text("granted_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("resource_permissions_target_idx").on(table.resourceType, table.resourceId),
    uniqueIndex("resource_permissions_unique_grant").on(
      table.resourceType,
      table.resourceId,
      table.granteeUserId,
      table.permissionKey,
    ),
  ],
);

/** Per-user preferences (Phase 1.9): language, timezone, calendar week, reminder defaults. */
export const user_preferences = sqliteTable("user_preferences", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  /** 'he' | 'en'; NULL means "use the server default". */
  language: text("language"),
  timezone: text("timezone").notNull().default("Asia/Jerusalem"),
  /** Days per week in calendar views: 5 (Shabbat off), 6, or 7. */
  workweekDays: integer("workweek_days").notNull().default(5),
  /** Working hours per day, used by reminder planning in Phase 2. */
  workdayStartHour: integer("workday_start_hour").notNull().default(9),
  workdayEndHour: integer("workday_end_hour").notNull().default(17),
  defaultTaskReminderOffsets: text("default_task_reminder_offsets").notNull().default("[]"),
  defaultCalendarReminderOffsets: text("default_calendar_reminder_offsets").notNull().default("[]"),
  /**
   * 'system' | 'light' | 'dark' (1.8/1.9). Written to `<html data-theme>`; `system`
   * means "follow the device", which is what `prefers-color-scheme` already does in
   * globals.css. The value is validated in `src/lib/preferences.ts`, like every other
   * enum in this table.
   */
  theme: text("theme").notNull().default("system"),
  updatedAt: text("updated_at").notNull(),
});

/**
 * Audit log (work item 1.11, spec §20): every security-relevant event records
 * actor, target, action, IP address, timestamp and outcome. One table for both
 * "auth events" and "audit log" so the Activity view in Phase 8 has exactly one
 * source, and nothing can log a security event by writing somewhere else.
 */
export const audit_logs = sqliteTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    /** Null for anonymous failures (a wrong password has no actor yet). */
    actorUserId: text("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    targetUserId: text("target_user_id").references(() => users.id, { onDelete: "set null" }),
    targetKind: text("target_kind"),
    targetId: text("target_id"),
    sessionId: text("session_id"),
    action: text("action").notNull(),
    outcome: text("outcome").notNull(),
    /** Structured detail (JSON string). Never contains secrets or raw codes. */
    detail: text("detail"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("audit_logs_actor_idx").on(table.actorUserId, table.createdAt),
    index("audit_logs_target_idx").on(table.targetUserId, table.createdAt),
    index("audit_logs_action_idx").on(table.action),
  ],
);
