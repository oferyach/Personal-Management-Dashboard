import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createFirstAdmin } from "@/lib/adminBootstrap";
import { getDb } from "@/db/client";
import { resource_permissions, tag_links, tags } from "@/db/schema";
import { ProductivityError } from "@/lib/productivity";
import type { TagLinkSummary, TagSummary } from "@/lib/tags";
import {
  attachTag,
  createTag,
  deleteTag,
  detachTag,
  listTags,
  tagsForResource,
  updateTag,
} from "@/lib/tags";
import { resetAuthInstance } from "@/lib/auth";
import { type Actor } from "@/lib/rbac";
import { closeTestDatabases, resetTestDatabase } from "../helpers/testDb";

const password = "Tags-Service-Password-2026!";

/**
 * Packet 2A has no routes yet, so the actor is built the way a verified session
 * hands one to a service. `twoFactorEnabled` is set because privileged roles
 * require an enrolled authenticator before any authorization passes.
 */
function actorFor(user: { id: string; role: Actor["role"] }): Actor {
  return { userId: user.id, role: user.role, twoFactorEnabled: true, sessionFresh: true };
}

/** Returns the machine-readable reason, or null when the call succeeded. */
async function reasonOf(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    expect(error, String(error)).toBeInstanceOf(ProductivityError);
    return (error as ProductivityError).reason;
  }
}

/** Writes the grant row the later sharing UI will write. */
async function grantTagView(tagId: string, granteeId: string, granterId: string): Promise<void> {
  await getDb().insert(resource_permissions).values({
    id: randomUUID(),
    resourceType: "tag",
    resourceId: tagId,
    granteeUserId: granteeId,
    permissionKey: "tags.view.shared",
    grantedBy: granterId,
    createdAt: new Date().toISOString(),
  });
}

function countRows(table: "tags" | "tag_links"): number {
  return table === "tags"
    ? getDb().select({ id: tags.id }).from(tags).all().length
    : getDb().select({ id: tag_links.id }).from(tag_links).all().length;
}

let owner: Actor;
let other: Actor;
let admin: Actor;

describe("tag service (packet 2A)", () => {
  beforeEach(async () => {
    resetTestDatabase("productivity-tags");
    resetAuthInstance();
    const privileged = await createFirstAdmin({
      name: "Super Admin",
      email: "admin@example.internal",
      password,
      role: "super_admin",
    });
    const first = await createFirstAdmin({
      name: "Tag Owner",
      email: "owner@example.internal",
      password,
      role: "user",
    });
    const second = await createFirstAdmin({
      name: "Other User",
      email: "other@example.internal",
      password,
      role: "user",
    });
    owner = actorFor(first);
    other = actorFor(second);
    admin = actorFor(privileged);
  });

  afterAll(() => closeTestDatabases());

  it("creates one tag per normalized name, per user", async () => {
    const created = await createTagCall(owner, "Work");
    expect(created).toMatchObject({ name: "Work", normalized: "work" });
    expect(await reasonOf(createTagCall(owner, "  work\u00A0 "))).toBe("duplicate_tag");

    const theirs = await createTagCall(other, "Work");
    expect(theirs.id).not.toBe(created.id);
    expect(theirs.normalized).toBe("work");
  });

  it("answers not_found for another user's tag id, never a different error", async () => {
    const theirs = await createTagCall(other, "Private");
    const visible = await listTags(owner, { limit: 50 });
    expect(visible.items.map((tag) => tag.name)).toEqual([]);

    expect(await reasonOf(attachFor(owner, theirs.id))).toBe("not_found");
    expect(await reasonOf(updateTag(owner, { tagId: theirs.id, name: "Hijacked" }))).toBe(
      "not_found",
    );
    expect(await reasonOf(deleteTag(owner, { tagId: theirs.id }))).toBe("not_found");
  });

  it("lets an admin see every tag but not administer someone else's", async () => {
    const theirs = await createTagCall(other, "Private");
    const visible = await listTags(admin, { limit: 50 });
    expect(visible.items.map((tag) => tag.name)).toEqual(["Private"]);
    expect(await reasonOf(updateTag(admin, { tagId: theirs.id, name: "Renamed" }))).toBe(
      "not_authorized",
    );
    expect(await reasonOf(deleteTag(admin, { tagId: theirs.id }))).toBe("not_authorized");
  });

  it("shows a tag only after an explicit grant, and still refuses to attach it", async () => {
    const theirs = await createTagCall(other, "Shared one");
    expect((await listTags(owner, { limit: 50 })).items).toHaveLength(0);

    await grantTagView(theirs.id, owner.userId, other.userId);
    const shared = await listTags(owner, { limit: 50 });
    expect(shared.items.map((tag) => tag.name)).toEqual(["Shared one"]);
    // A shared tag is a read licence: attaching needs a tag the actor owns.
    expect(await reasonOf(attachFor(owner, theirs.id))).toBe("not_authorized");
    expect(
      (await tagsForResource(owner, { resourceType: "task", resourceId: "task-1" })).length,
    ).toBe(0);
  });

  it("attaches idempotently, detaches its own links, and cascades on delete", async () => {
    const tag = await createTagCall(owner, "Work");
    const first = await attachTag(owner, {
      tagId: tag.id,
      resourceType: "task",
      resourceId: "task-1",
    });
    const second = await attachTag(owner, {
      tagId: tag.id,
      resourceType: "task",
      resourceId: "task-1",
    });
    expect(second.id).toBe(first.id);
    expect(countRows("tag_links")).toBe(1);

    const names = (
      await tagsForResource(owner, { resourceType: "task", resourceId: "task-1" })
    ).map((t) => t.name);
    expect(names).toEqual(["Work"]);

    expect(
      await detachTag(owner, { tagId: tag.id, resourceType: "task", resourceId: "task-1" }),
    ).toBe(true);
    expect(
      await detachTag(owner, { tagId: tag.id, resourceType: "task", resourceId: "task-1" }),
    ).toBe(false);

    await attachTag(owner, { tagId: tag.id, resourceType: "event", resourceId: "event-1" });
    expect(
      await reasonOf(attachTag(owner, { tagId: tag.id, resourceType: "session", resourceId: "x" })),
    ).toBe("unknown_resource_kind");

    await deleteTag(owner, { tagId: tag.id });
    expect(countRows("tags")).toBe(0);
    expect(countRows("tag_links")).toBe(0);
  });

  it("renames in place, keeps links, and refuses a name another tag owns", async () => {
    const tag = await createTagCall(owner, "Work");
    await createTagCall(owner, "Home");
    await attachTag(owner, { tagId: tag.id, resourceType: "task", resourceId: "task-1" });

    const renamed = await updateTag(owner, { tagId: tag.id, name: "  work\u00A0two " });
    expect(renamed.id).toBe(tag.id);
    expect(renamed.name).toBe("work two");
    expect(renamed.normalized).toBe("work two");
    expect(
      (await tagsForResource(owner, { resourceType: "task", resourceId: "task-1" })).map(
        (t) => t.name,
      ),
    ).toEqual(["work two"]);

    expect(await reasonOf(updateTag(owner, { tagId: tag.id, name: "Home" }))).toBe("duplicate_tag");
  });

  it("pages by (name, id) and refuses a cursor outside the actor's view", async () => {
    for (const name of ["alpha", "beta", "gamma"]) await createTagCall(owner, name);
    const page1 = await listTags(owner, { limit: 2 });
    expect(page1.items.map((tag) => tag.name)).toEqual(["alpha", "beta"]);
    const page2 = await listTags(owner, { limit: 2, cursor: page1.nextCursor });
    expect(page2.items.map((tag) => tag.name)).toEqual(["gamma"]);
    expect(page2.nextCursor).toBeNull();

    const theirs = await createTagCall(other, "delta");
    expect(await reasonOf(listTags(owner, { limit: 2, cursor: theirs.id }))).toBe("not_found");
  });
});

function createTagCall(actor: Actor, name: string): Promise<TagSummary> {
  return createTag(actor, { name });
}

function attachFor(actor: Actor, tagId: string): Promise<TagLinkSummary> {
  return attachTag(actor, { tagId, resourceType: "task", resourceId: "task-1" });
}
