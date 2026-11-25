/**
 * Shared productivity tables (packet 2A): tags, tag links, and the user-visible
 * activity feed.
 *
 * `activity_log` is deliberately a different table from `audit_logs`
 * (`src/db/schema/systemMeta.ts`):
 *
 * | Table        | Audience                                                 |
 * | ------------ | -------------------------------------------------------- |
 * | `audit_logs` | operators: authentication, authorization, administration  |
 * | `activity_log` | the user: what they did in the dashboard                |
 *
 * Merging them would put personal work history behind a security view and would
 * force the security trail to be filtered before it could be shown to its owner.
 *
 * `tag_links.resource_id` is a *polymorphic* id on purpose: the resource tables
 * arrive in later packets (events 2B, tasks 2D, projects 2G, assets Phase 4), so
 * no foreign key can exist yet. The owning module's service is therefore the
 * only thing allowed to create a link, and every read carries the owner/visibility
 * predicate — see `src/lib/tags.ts`. The CHECK constraints below are what keep
 * the kind and action vocabulary honest until then.
 */
import { sql } from "drizzle-orm";
import { check, index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { users } from "./auth";

/**
 * A tag belongs to exactly one user (spec §13: tags are personal, sharing is
 * per-resource). Uniqueness is on the *normalized* name, so "Work" and "work"
 * cannot become two tags; `name` keeps the user's own casing for display.
 */
export const tags = sqliteTable(
  "tags",
  {
    id: text("id").primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    nameNormalized: text("name_normalized").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    // The database, not the service, is the thing that makes "Work" and "work"
    // one tag: two concurrent creates race, and this index decides.
    uniqueIndex("tags_owner_name_unique").on(table.ownerUserId, table.nameNormalized),
    index("tags_owner_created_idx").on(table.ownerUserId, table.createdAt),
  ],
);

/**
 * Which tags are attached to which resource. The unique index is the invariant:
 * a resource carries a given tag at most once, so re-attaching is a no-op rather
 * than a duplicate row. `owner_user_id` is the resource owner, denormalized from
 * the link creator, so "my tagged tasks" is one indexed lookup instead of a join
 * through every resource table.
 */
export const tag_links = sqliteTable(
  "tag_links",
  {
    id: text("id").primaryKey(),
    tagId: text("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id").notNull(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    linkedBy: text("linked_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("tag_links_unique_link").on(table.tagId, table.resourceType, table.resourceId),
    index("tag_links_resource_idx").on(table.resourceType, table.resourceId),
    index("tag_links_owner_tag_idx").on(table.ownerUserId, table.tagId),
    check(
      "tag_links_resource_kind_chk",
      sql`"resource_type" in ('event', 'task', 'project', 'asset')`,
    ),
  ],
);

/**
 * The user-visible activity feed (spec §16). One row per user-visible action.
 *
 * - `owner_user_id` — the person whose work history this entry belongs to; the
 *    column every visibility predicate filters on.
 * - `actor_user_id` — who performed the action; differs from the owner when an
 *    administrator acts on someone else's resource.
 * - `resource_id` — polymorphic, same reason as `tag_links`.
 * - `detail` — bounded, sanitized JSON written only through
 *    `src/lib/activity.ts::sanitizeActivityDetail`. It is not a general-purpose
 *    payload column: secret-looking keys and values are replaced with
 *    `[redacted]` before the row is written.
 */
export const activity_log = sqliteTable(
  "activity_log",
  {
    id: text("id").primaryKey(),
    actorUserId: text("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id").notNull(),
    action: text("action").notNull(),
    detail: text("detail"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    // `id` is part of both time indexes: the feed paginates by (created_at, id),
    // and two actions recorded in the same millisecond still need a stable order.
    index("activity_log_owner_time_idx").on(table.ownerUserId, table.createdAt, table.id),
    index("activity_log_actor_time_idx").on(table.actorUserId, table.createdAt, table.id),
    index("activity_log_resource_idx").on(table.resourceType, table.resourceId),
    check(
      "activity_log_resource_kind_chk",
      sql`"resource_type" in ('event', 'task', 'project', 'asset', 'tag')`,
    ),
    check(
      "activity_log_action_chk",
      sql`"action" in ('created', 'updated', 'deleted', 'completed', 'reopened', 'progress_changed', 'tag_attached', 'tag_detached', 'metadata_changed', 'synchronized')`,
    ),
  ],
);
