/**
 * Activity feed service (packet 2A) — the only writer and reader of `activity_log`.
 *
 * Two logs, two audiences (`src/db/schema/productivity.ts` explains the split):
 * `audit_logs` is the operator's security trail, `activity_log` is the user's own
 * work history. This module never touches the other one.
 *
 * Authorization becomes a SQL predicate before the query is built, exactly as in
 * `src/lib/tags.ts`: `own` filters on `owner_user_id`, `shared` filters on the
 * resource ids the actor has been explicitly granted, `any` adds no owner
 * predicate. Entries that are not visible answer `not_found`.
 *
 * Traceability: `README.md` §16 (activity history and reporting), `docs/PLAN.md`
 * §6 (`activity_log`).
 */
import { randomUUID } from "node:crypto";

import { and, desc, eq, gte, lte, lt, or, SQL } from "drizzle-orm";

import { getDb } from "@/db/client";
import { type ActivityLogRow, activity_log, resource_permissions } from "@/db/schema";
import {
  MAX_PAGE_SIZE,
  ProductivityError,
  clampPageSize,
  isActivityAction,
  isActivityResourceKind,
  parseQueryWindow,
  requireResourceId,
  type ActivityAction,
  type ActivityResourceKind,
} from "./productivity";
import { type Actor, authorize, can } from "./rbac";
import { getLogger } from "./log";
import { REDACTED, isSecretKeyName, redact } from "./redact";

/** How deep a detail object may nest before it is flattened to a marker. */
const MAX_DETAIL_DEPTH = 4;
/** Keys per object / items per array. */
const MAX_DETAIL_CHILDREN = 24;
/** Longest string kept in a detail value. */
const MAX_DETAIL_STRING = 300;
/** Serialized cap; the JSON column is bounded, not open-ended. */
const MAX_DETAIL_JSON_LENGTH = 2048;

export interface ActivityInput {
  actor: Actor;
  /** Whose work history this entry belongs to; defaults to the actor. */
  ownerUserId?: string;
  resourceType: unknown;
  resourceId: unknown;
  action: unknown;
  detail?: unknown;
}

export interface ActivityEntry {
  id: string;
  actorUserId: string | null;
  ownerUserId: string;
  resourceType: ActivityResourceKind;
  resourceId: string;
  action: string;
  detail: Record<string, unknown> | null;
  createdAt: string;
}

/**
 * Bounds and sanitizes one detail payload.
 *
 * `redact()` already replaces secret-looking keys and values, but it neither
 * bounds size nor depth, and an activity payload is user-facing rather than a
 * log line. So this function owns both jobs: it walks the value itself,
 * replaces anything `redact()`'s pattern lists flag, drops anything past the
 * caps, and refuses payloads that are not plain JSON.
 */
export function sanitizeActivityDetail(value: unknown): {
  detail: Record<string, unknown> | null;
  json: string | null;
} {
  if (value === null || value === undefined) return { detail: null, json: null };
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new ProductivityError("invalid_detail", "Activity detail must be a plain object.");
  }
  const detail = clean(value, 1) as Record<string, unknown>;
  const json = JSON.stringify(detail);
  if (json.length > MAX_DETAIL_JSON_LENGTH) {
    throw new ProductivityError(
      "invalid_detail",
      `Activity detail must serialize to at most ${MAX_DETAIL_JSON_LENGTH} characters.`,
    );
  }
  return { detail, json };
}

function clean(value: unknown, depth: number): unknown {
  if (depth > MAX_DETAIL_DEPTH) return "[truncated]";
  if (typeof value === "string") {
    if (redact(value) !== value) return REDACTED;
    return value.length > MAX_DETAIL_STRING ? `${value.slice(0, MAX_DETAIL_STRING)}…` : value;
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (typeof value !== "object" || value === null) return "[unsupported]";
  if (Array.isArray(value)) {
    return value.slice(0, MAX_DETAIL_CHILDREN).map((item) => clean(item, depth + 1));
  }
  const out: Record<string, unknown> = {};
  let kept = 0;
  for (const [key, item] of Object.entries(value)) {
    if (kept >= MAX_DETAIL_CHILDREN) {
      out["truncated"] = true;
      break;
    }
    if (isSecretKeyName(key) || (typeof item === "string" && redact(item) !== item)) {
      out[key] = REDACTED;
    } else {
      out[key] = clean(item, depth + 1);
    }
    kept += 1;
  }
  return out;
}

/**
 * Record one user-visible action.
 *
 * Like `recordAudit`, this never throws to the caller for a *storage* failure:
 * a productivity mutation that succeeded must not be reported as failed because
 * its feed entry could not be written; the failure is logged instead. Invalid
 * input does throw, because that is a caller bug and swallowing it would hide
 * it.
 */
export async function recordActivity(input: ActivityInput): Promise<ActivityEntry | null> {
  await authorize(input.actor, "activity.record");
  if (!isActivityResourceKind(input.resourceType)) {
    throw new ProductivityError("unknown_resource_kind", "Unsupported activity resource type.");
  }
  if (!isActivityAction(input.action)) {
    throw new ProductivityError("unknown_activity_action", "Unsupported activity action.");
  }
  const resourceId = requireResourceId(input.resourceId);
  const ownerUserId =
    typeof input.ownerUserId === "string" && input.ownerUserId.length > 0
      ? input.ownerUserId
      : input.actor.userId;
  const { detail, json } = sanitizeActivityDetail(input.detail ?? null);
  const createdAt = new Date().toISOString();
  const entry: ActivityEntry = {
    id: randomUUID(),
    actorUserId: input.actor.userId,
    ownerUserId,
    resourceType: input.resourceType,
    resourceId,
    action: input.action as ActivityAction,
    detail,
    createdAt,
  };
  try {
    await getDb().insert(activity_log).values({
      id: entry.id,
      actorUserId: entry.actorUserId,
      ownerUserId: entry.ownerUserId,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      action: entry.action,
      detail: json,
      createdAt: entry.createdAt,
    });
  } catch (error) {
    getLogger("activity").error("activity write failed", {
      action: entry.action,
      resourceType: entry.resourceType,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
  return entry;
}

/**
 * Which activity entries this actor can see, as one predicate. The views are a
 * **union**: a role holding both `activity.view.own` and `activity.view.shared`
 * sees its own entries *plus* entries for resources shared with it, and neither
 * key may cancel the other. `all` is `activity.view.any`; `empty` means the actor
 * holds a view key but nothing matches yet; `none` means no activity view key at
 * all, which callers turn into a raised `AuthorizationError` through `authorize`
 * rather than a silently empty feed.
 */
type ActivityView =
  { kind: "none" } | { kind: "empty" } | { kind: "all" } | { kind: "where"; predicate: SQL };

async function activityView(actor: Actor): Promise<ActivityView> {
  if (await can(actor, "activity.view.any")) return { kind: "all" };
  const holdsOwn = await can(actor, "activity.view.own");
  const holdsShared = await can(actor, "activity.view.shared");
  if (!holdsOwn && !holdsShared) return { kind: "none" };

  const clauses: SQL[] = [];
  if (holdsOwn) clauses.push(eq(activity_log.ownerUserId, actor.userId));
  if (holdsShared) {
    const grants = await getDb()
      .select({
        resourceType: resource_permissions.resourceType,
        resourceId: resource_permissions.resourceId,
      })
      .from(resource_permissions)
      .where(eq(resource_permissions.granteeUserId, actor.userId))
      .limit(MAX_PAGE_SIZE);
    for (const grant of grants) {
      const clause = and(
        eq(activity_log.resourceType, grant.resourceType),
        eq(activity_log.resourceId, grant.resourceId),
      );
      if (clause !== undefined) clauses.push(clause);
    }
  }
  if (clauses.length === 0) return { kind: "empty" };
  // drizzle types `or()` as possibly undefined because it tolerates undefined
  // arguments; this list is non-empty, so the first clause is the fallback.
  const combined = or(...clauses);
  return { kind: "where", predicate: combined ?? clauses[0]! };
}

/** A page of activity: newest first, paged by the pair `(created_at, id)`. */
export interface ActivityPage {
  items: ActivityEntry[];
  nextCursor: { createdAt: string; id: string } | null;
}

/**
 * Activity visible to the actor, newest first. The cursor is the same pair the
 * index covers, so two actions recorded in one millisecond still have a stable
 * order and a page boundary cannot skip or repeat a row.
 */
export async function listActivity(
  actor: Actor,
  query: {
    limit?: number;
    window?: { from: unknown; to: unknown };
    cursor?: { createdAt: string; id: string } | null;
  } = {},
): Promise<ActivityPage> {
  const view = await activityView(actor);
  if (view.kind === "none") {
    await authorize(actor, "activity.view.own");
    return { items: [], nextCursor: null };
  }
  if (view.kind === "empty") return { items: [], nextCursor: null };

  const conditions: SQL[] = [];
  if (view.kind === "where") conditions.push(view.predicate);
  if (query.window) {
    const window = parseQueryWindow(query.window);
    conditions.push(
      gte(activity_log.createdAt, window.from),
      lte(activity_log.createdAt, window.to),
    );
  }
  if (query.cursor) {
    const createdAt = requireInstant(query.cursor.createdAt);
    const id = requireResourceId(query.cursor.id);
    const cursorCondition = or(
      lt(activity_log.createdAt, createdAt),
      and(eq(activity_log.createdAt, createdAt), lt(activity_log.id, id)),
    );
    if (cursorCondition) conditions.push(cursorCondition);
  }

  const rows = await getDb()
    .select()
    .from(activity_log)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(activity_log.createdAt), desc(activity_log.id))
    .limit(clampPageSize(query.limit) + 1);

  const limit = clampPageSize(query.limit);
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page.map((row) => entryOf(row)),
    nextCursor:
      rows.length > limit && last !== undefined ? { createdAt: last.createdAt, id: last.id } : null,
  };
}

/** Entries about one resource, newest first, scoped to what the actor may see. */
export async function activityForResource(
  actor: Actor,
  input: { resourceType: unknown; resourceId: unknown; limit?: number },
): Promise<ActivityEntry[]> {
  const view = await activityView(actor);
  if (view.kind === "none") {
    await authorize(actor, "activity.view.own");
    return [];
  }
  if (view.kind === "empty") return [];
  if (!isActivityResourceKind(input.resourceType)) {
    throw new ProductivityError("unknown_resource_kind", "Unsupported activity resource type.");
  }
  const resourceId = requireResourceId(input.resourceId);
  const rows = await getDb()
    .select()
    .from(activity_log)
    .where(
      and(
        eq(activity_log.resourceType, input.resourceType),
        eq(activity_log.resourceId, resourceId),
        view.kind === "where" ? view.predicate : undefined,
      ),
    )
    .orderBy(desc(activity_log.createdAt), desc(activity_log.id))
    .limit(clampPageSize(input.limit));
  return rows.map((row) => entryOf(row));
}

function requireInstant(value: string): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new ProductivityError("invalid_window", "The pagination cursor is malformed.");
  }
  return value;
}

function entryOf(row: ActivityLogRow): ActivityEntry {
  let detail: Record<string, unknown> | null = null;
  if (row.detail) {
    try {
      const parsed: unknown = JSON.parse(row.detail);
      detail =
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : null;
    } catch {
      detail = null;
    }
  }
  return {
    id: row.id,
    actorUserId: row.actorUserId,
    ownerUserId: row.ownerUserId,
    resourceType: row.resourceType as ActivityResourceKind,
    resourceId: row.resourceId,
    action: row.action as ActivityAction,
    detail,
    createdAt: row.createdAt,
  };
}
