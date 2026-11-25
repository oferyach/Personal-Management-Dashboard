/**
 * Tag service (packet 2A) — the only door into `tags` and `tag_links`.
 *
 * Every entry point takes an `Actor` and turns that actor's tag permission into a
 * visibility level *before* SQL is built, so the ownership predicate is part of
 * the query rather than a filter applied after the fact
 * (`docs/ARCHITECTURE.md` §9: "Database queries include ownership predicates
 * where visibility rules apply. UI hiding is not authorization.").
 *
 * Guessing another user's tag id answers `not_found` — the same answer as "no
 * such tag" — so probing cannot confirm that a private tag exists.
 *
 * Traceability: `README.md` §13 (tags and tag associations are first-class),
 * §22 (tag management), `docs/PLAN.md` §6 (`tags`, `tag_links`).
 */
import { randomUUID } from "crypto";

import { and, asc, eq, gt, inArray, or, SQL } from "drizzle-orm";
import { getDb } from "@/db/client";
import { type TagRow, resource_permissions, tag_links, tags } from "@/db/schema";
import {
  MAX_PAGE_SIZE,
  MAX_RESOURCE_ID_LENGTH,
  ProductivityError,
  clampPageSize,
  isProductivityResourceKind,
  isUniqueConstraintError,
  normalizeTagName,
  requireResourceId,
  type ProductivityResourceKind,
} from "./productivity";
import { authorize, can } from "./rbac";
import type { Actor } from "./rbac";

/** What a caller may learn about a tag. Never a raw row: the schema's columns stay server-side. */
export interface TagSummary {
  id: string;
  name: string;
  normalized: string;
  createdAt: string;
  updatedAt: string;
}

/** A tag link as seen through this service. `ownerUserId` is the resource's owner. */
export interface TagLinkSummary {
  id: string;
  tagId: string;
  resourceType: ProductivityResourceKind;
  resourceId: string;
  createdAt: string;
}

/**
 * Which tags this actor can see, expressed as one predicate. The views are a
 * **union**, not a preference: the `user` role holds both `tags.view.own` and
 * `tags.view.shared`, and neither may cancel the other. `all` is `tags.view.any`;
 * `empty` means the actor holds a tag view key but nothing matches yet; `none`
 * means no tag view key at all, which callers turn into a raised
 * `AuthorizationError` rather than a silently empty list.
 */
/**
 * Exported for `src/lib/events.ts`: the event tag join below has to apply the
 * same visibility union, and a second implementation would let tag visibility
 * drift between the two services.
 */
export type TagView =
  { kind: "none" } | { kind: "empty" } | { kind: "all" } | { kind: "where"; predicate: SQL };

export async function tagView(actor: Actor): Promise<TagView> {
  if (await can(actor, "tags.view.any")) return { kind: "all" };
  const holdsOwn = await can(actor, "tags.view.own");
  const holdsShared = await can(actor, "tags.view.shared");
  if (!holdsOwn && !holdsShared) return { kind: "none" };

  const clauses: SQL[] = [];
  if (holdsOwn) clauses.push(eq(tags.ownerUserId, actor.userId));
  if (holdsShared) {
    const ids = await sharedTagIds(actor);
    if (ids.length > 0) clauses.push(inArray(tags.id, ids));
  }
  if (clauses.length === 0) return { kind: "empty" };
  // drizzle types `or()` as possibly undefined because it tolerates undefined
  // arguments; this list is non-empty, so the first clause is the fallback.
  const combined = or(...clauses);
  return { kind: "where", predicate: combined ?? clauses[0]! };
}

/**
 * Tag ids explicitly shared with this actor through Phase 1's
 * `resource_permissions` table (packet 2L's sharing UI writes them). Read as a
 * bounded id list rather than a correlated subquery: a user is not going to be
 * shared thousands of tags without that list becoming a page of its own.
 */
async function sharedTagIds(actor: Actor): Promise<string[]> {
  const rows = await getDb()
    .select({ resourceId: resource_permissions.resourceId })
    .from(resource_permissions)
    .where(
      and(
        eq(resource_permissions.granteeUserId, actor.userId),
        eq(resource_permissions.resourceType, "tag"),
        eq(resource_permissions.permissionKey, "tags.view.shared"),
      ),
    )
    .limit(MAX_PAGE_SIZE);
  return rows.map((row) => row.resourceId);
}

/**
 * Resolve one tag for this actor, with the visibility predicate inside the
 * `where`. A tag that exists but is not visible to this actor reads as absent.
 * Exported for `src/lib/events.ts`, which resolves the tag id an event is about
 * to link before it writes the link.
 */
export async function findTag(
  actor: Actor,
  tagId: string,
): Promise<typeof tags.$inferSelect | null> {
  if (typeof tagId !== "string" || tagId.length === 0 || tagId.length > MAX_RESOURCE_ID_LENGTH) {
    return null;
  }
  const view = await tagView(actor);
  if (view.kind === "none") {
    // No tag visibility at all: raise rather than return null, so the caller
    // cannot use this as an existence oracle either.
    await authorize(actor, "tags.view.own");
    return null;
  }
  if (view.kind === "empty") return null;
  const where = view.kind === "all" ? eq(tags.id, tagId) : and(eq(tags.id, tagId), view.predicate);
  const rows = await getDb().select().from(tags).where(where).limit(1);
  return rows[0] ?? null;
}

const summaryOf = (row: TagRow): TagSummary => ({
  id: row.id,
  name: row.name,
  normalized: row.nameNormalized,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

/**
 * Create the actor's own tag. Uniqueness is decided by the database
 * (`tags_owner_name_unique`), so two concurrent "Work" tags cannot both land;
 * the loser is told it is a duplicate rather than being handed a second tag.
 */
export async function createTag(actor: Actor, input: { name: unknown }): Promise<TagSummary> {
  await authorize(actor, "tags.create");
  const name = normalizeTagName(input.name);
  const now = new Date().toISOString();
  const id = randomUUID();
  try {
    await getDb().insert(tags).values({
      id,
      ownerUserId: actor.userId,
      name: name.display,
      nameNormalized: name.normalized,
      createdAt: now,
      updatedAt: now,
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new ProductivityError("duplicate_tag", `A tag named "${name.display}" already exists.`);
    }
    throw error;
  }
  return { id, name: name.display, normalized: name.normalized, createdAt: now, updatedAt: now };
}

/**
 * Rename the actor's own tag. Renaming keeps the id, so every `tag_links` row
 * and every activity entry that referenced it stays valid — which is why this
 * is an update and never a delete plus a create.
 */
export async function updateTag(
  actor: Actor,
  input: { tagId: string; name: unknown },
): Promise<TagSummary> {
  await authorize(actor, "tags.edit.own");
  const existing = await findTag(actor, input.tagId);
  if (existing === null) throw new ProductivityError("not_found", "No such tag.");
  if (existing.ownerUserId !== actor.userId) {
    // Visible to this actor (an admin holding tags.view.any) but not theirs to
    // rename through this door: tags.edit.any is the administration key, and
    // cross-user tag administration is deliberately not part of packet 2A.
    throw new ProductivityError("not_authorized", "This tag belongs to another user.");
  }
  const name = normalizeTagName(input.name);
  const now = new Date().toISOString();
  try {
    await getDb()
      .update(tags)
      .set({ name: name.display, nameNormalized: name.normalized, updatedAt: now })
      .where(and(eq(tags.id, existing.id), eq(tags.ownerUserId, actor.userId)));
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new ProductivityError("duplicate_tag", `A tag named "${name.display}" already exists.`);
    }
    throw error;
  }
  return {
    id: existing.id,
    name: name.display,
    normalized: name.normalized,
    createdAt: existing.createdAt,
    updatedAt: now,
  };
}

/**
 * Delete the actor's own tag. `tag_links.tag_id` cascades, so the links go with
 * it; the tagged resources themselves are untouched — they are separate rows
 * owned by the resource modules.
 */
export async function deleteTag(actor: Actor, input: { tagId: string }): Promise<void> {
  await authorize(actor, "tags.edit.own");
  const existing = await findTag(actor, input.tagId);
  if (existing === null) throw new ProductivityError("not_found", "No such tag.");
  if (existing.ownerUserId !== actor.userId) {
    throw new ProductivityError("not_authorized", "This tag belongs to another user.");
  }
  await getDb().delete(tags).where(eq(tags.id, existing.id));
}

/**
 * Tags visible to the actor, ordered by normalized name then id so paging is
 * stable even when two tags share a name. The cursor is the last id of the
 * previous page; it is re-resolved through `findTag` so a cursor cannot be
 * used to walk into someone else's tags.
 */
export async function listTags(
  actor: Actor,
  query: { limit?: number; cursor?: string | null } = {},
): Promise<{ items: TagSummary[]; nextCursor: string | null }> {
  const view = await tagView(actor);
  if (view.kind === "none") {
    await authorize(actor, "tags.view.own");
    return { items: [], nextCursor: null };
  }
  if (view.kind === "empty") return { items: [], nextCursor: null };
  const limit = clampPageSize(query.limit);
  const db = getDb();
  const visibility: SQL | undefined = view.kind === "all" ? undefined : view.predicate;

  const cursor = typeof query.cursor === "string" && query.cursor.length > 0 ? query.cursor : null;
  let after: SQL | undefined;
  if (cursor !== null) {
    const anchor = await findTag(actor, cursor);
    if (anchor === null) {
      throw new ProductivityError("not_found", "The pagination cursor is not a visible tag.");
    }
    after = or(
      gt(tags.nameNormalized, anchor.nameNormalized),
      and(eq(tags.nameNormalized, anchor.nameNormalized), gt(tags.id, anchor.id)),
    );
  }

  const where = and(visibility, after);
  const rows = await db
    .select()
    .from(tags)
    .where(where)
    .orderBy(asc(tags.nameNormalized), asc(tags.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page.map((row) => summaryOf(row)),
    nextCursor: rows.length > limit && last !== undefined ? last.id : null,
  };
}

/**
 * Attach one of the actor's own tags to a resource.
 *
 * Packet 2A has no resource tables, so this door validates the vocabulary and
 * the tag's ownership, then writes the link. It does **not** prove the resource
 * exists: `tag_links.resource_id` is polymorphic and the tables arrive later
 * (events 2B, tasks 2D, projects 2G, assets Phase 4). The owning module's service
 * must call this with an id it just read under its own edit permission — see
 * `assertTagUsable`. Packet 2B+ is where the resource-side existence check and
 * the "may this actor edit that resource" check live.
 */
export async function attachTag(
  actor: Actor,
  input: { tagId: string; resourceType: unknown; resourceId: unknown },
): Promise<TagLinkSummary> {
  await authorize(actor, "tags.attach");
  if (!isProductivityResourceKind(input.resourceType)) {
    throw new ProductivityError("unknown_resource_kind", "Unsupported resource type.");
  }
  const resourceId = requireResourceId(input.resourceId);
  const tag = await findTag(actor, input.tagId);
  if (tag === null) throw new ProductivityError("not_found", "No such tag.");
  if (tag.ownerUserId !== actor.userId) {
    throw new ProductivityError("not_authorized", "This tag belongs to another user.");
  }

  const now = new Date().toISOString();
  const id = randomUUID();
  try {
    await getDb().insert(tag_links).values({
      id,
      tagId: tag.id,
      resourceType: input.resourceType,
      resourceId,
      ownerUserId: tag.ownerUserId,
      linkedBy: actor.userId,
      createdAt: now,
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      // Already tagged: an idempotent no-op, reported as such rather than as a
      // second link or an error the caller has to interpret.
      const existing = await getDb()
        .select()
        .from(tag_links)
        .where(
          and(
            eq(tag_links.tagId, tag.id),
            eq(tag_links.resourceType, input.resourceType),
            eq(tag_links.resourceId, resourceId),
          ),
        )
        .limit(1);
      const row = existing[0];
      if (row !== undefined) {
        return {
          id: row.id,
          tagId: row.tagId,
          resourceType: row.resourceType as ProductivityResourceKind,
          resourceId: row.resourceId,
          createdAt: row.createdAt,
        };
      }
      throw new ProductivityError("duplicate_link", "This tag is already attached.");
    }
    throw error;
  }

  return {
    id,
    tagId: tag.id,
    resourceType: input.resourceType,
    resourceId,
    createdAt: now,
  };
}

/**
 * Detach the actor's own tag from a resource. Scoped by the tag's owner, so
 * actor A cannot remove actor B's tag from a shared resource id.
 */
export async function detachTag(
  actor: Actor,
  input: { tagId: string; resourceType: unknown; resourceId: unknown },
): Promise<boolean> {
  await authorize(actor, "tags.attach");
  if (!isProductivityResourceKind(input.resourceType)) {
    throw new ProductivityError("unknown_resource_kind", "Unsupported resource type.");
  }
  const resourceId = requireResourceId(input.resourceId);
  const tag = await findTag(actor, input.tagId);
  if (tag === null) throw new ProductivityError("not_found", "No such tag.");
  if (tag.ownerUserId !== actor.userId) {
    throw new ProductivityError("not_authorized", "This tag belongs to another user.");
  }
  const result = await getDb()
    .delete(tag_links)
    .where(
      and(
        eq(tag_links.tagId, tag.id),
        eq(tag_links.resourceType, input.resourceType),
        eq(tag_links.resourceId, resourceId),
        eq(tag_links.ownerUserId, actor.userId),
      ),
    )
    .returning({ id: tag_links.id });
  return result.length > 0;
}

/**
 * Which of the actor's own tags are attached to one resource. Used by the
 * later resource screens; the resource id is supplied by a caller that already
 * passed its own module's edit/view check.
 */
export async function tagsForResource(
  actor: Actor,
  input: { resourceType: unknown; resourceId: unknown },
): Promise<TagSummary[]> {
  const view = await tagView(actor);
  if (view.kind === "none") {
    await authorize(actor, "tags.view.own");
    return [];
  }
  if (!isProductivityResourceKind(input.resourceType)) {
    throw new ProductivityError("unknown_resource_kind", "Unsupported resource type.");
  }
  const resourceId = requireResourceId(input.resourceId);
  const rows = await getDb()
    .select()
    .from(tag_links)
    .innerJoin(tags, eq(tags.id, tag_links.tagId))
    .where(
      and(
        eq(tag_links.resourceType, input.resourceType),
        eq(tag_links.resourceId, resourceId),
        eq(tag_links.ownerUserId, actor.userId),
      ),
    )
    .orderBy(asc(tags.nameNormalized))
    .limit(MAX_PAGE_SIZE);
  return rows.map((row) => summaryOf(row.tags));
}
