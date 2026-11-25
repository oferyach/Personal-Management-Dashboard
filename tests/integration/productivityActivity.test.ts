import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createFirstAdmin } from "@/lib/adminBootstrap";
import { getDb, getSqlite } from "@/db/client";
import { resource_permissions } from "@/db/schema";
import { ProductivityError } from "@/lib/productivity";
import {
  activityForResource,
  listActivity,
  recordActivity,
  sanitizeActivityDetail,
} from "@/lib/activity";
import { REDACTED } from "@/lib/redact";
import { AuthorizationError, type Actor } from "@/lib/rbac";
import { resetAuthInstance } from "@/lib/auth";
import { closeTestDatabases, resetTestDatabase } from "../helpers/testDb";

const password = "Activity-Service-Password-2026!";

/**
 * Packet 2Q has no routes yet, so the actor is built the way a verified session
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

function record(input: {
  actor: Actor;
  resourceType?: string;
  resourceId?: string;
  action?: string;
  detail?: unknown;
  ownerUserId?: string;
}) {
  return recordActivity({
    actor: input.actor,
    resourceType: input.resourceType ?? "task",
    resourceId: input.resourceId ?? "task-1",
    action: input.action ?? "created",
    detail: input.detail,
    ownerUserId: input.ownerUserId,
  });
}

/** Writes the grant row the later sharing UI will write. */
async function grantActivityView(
  resourceType: string,
  resourceId: string,
  granteeId: string,
  granterId: string,
): Promise<void> {
  await getDb()
    .insert(resource_permissions)
    .values({
      id: randomUUID(),
      resourceType,
      resourceId,
      granteeUserId: granteeId,
      permissionKey: "activity.view.shared",
      grantedBy: granterId,
      createdAt: new Date().toISOString(),
    })
    .run();
}

let owner: Actor;
let other: Actor;
let admin: Actor;

describe("activity service (packet 2Q)", () => {
  beforeEach(async () => {
    resetTestDatabase("productivity-activity");
    resetAuthInstance();
    const privileged = await createFirstAdmin({
      name: "Super Admin",
      email: "admin@example.internal",
      password,
      role: "super_admin",
    });
    const first = await createFirstAdmin({
      name: "Feed Owner",
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

  it("records entries and reads them back newest first", async () => {
    const first = await record({ actor: owner, action: "created" });
    const second = await record({ actor: owner, action: "updated", detail: { title: "Draft" } });
    expect(first?.action).toBe("created");
    expect(second?.detail).toEqual({ title: "Draft" });
    expect(second?.ownerUserId).toBe(owner.userId);

    const page = await listActivity(owner);
    // Both entries land in the same millisecond, so the feed's tie-break is the
    // id; assert the set rather than a wall-clock order that cannot be predicted.
    expect(page.items.map((item) => item.action).sort()).toEqual(["created", "updated"]);
    expect(page.nextCursor).toBeNull();

    const forResource = await activityForResource(owner, {
      resourceType: "task",
      resourceId: "task-1",
    });
    expect(forResource.map((item) => item.id).sort()).toEqual([first!.id, second!.id].sort());
    expect(
      await activityForResource(owner, { resourceType: "task", resourceId: "task-none" }),
    ).toEqual([]);
  });

  it("keeps another user's history out of this actor's feed", async () => {
    await record({ actor: other, resourceId: "task-9", resourceType: "project" });
    expect((await listActivity(owner)).items).toEqual([]);
    expect(
      await activityForResource(owner, { resourceType: "project", resourceId: "task-9" }),
    ).toEqual([]);
    expect((await listActivity(other)).items.length).toBe(1);
  });

  it("lets activity.view.any see every feed, and writes on behalf of another owner", async () => {
    await record({ actor: other, resourceType: "event", resourceId: "event-3" });
    const onBehalf = await record({
      actor: admin,
      ownerUserId: other.userId,
      resourceType: "event",
      resourceId: "event-3",
      action: "synchronized",
    });
    expect(onBehalf?.actorUserId).toBe(admin.userId);
    expect(onBehalf?.ownerUserId).toBe(other.userId);

    expect((await listActivity(admin)).items.length).toBe(2);
    expect((await listActivity(other)).items.map((item) => item.action).sort()).toEqual([
      "created",
      "synchronized",
    ]);
  });

  it("redacts secret-shaped keys and values before they reach the row", async () => {
    const secretValue = "a".repeat(40);
    const entry = await record({
      actor: owner,
      resourceId: "task-2",
      detail: { password: "hunter2", api_key: secretValue, session_token: "safe", note: "kept" },
    });
    expect(entry?.detail).toEqual({
      password: REDACTED,
      api_key: REDACTED,
      session_token: REDACTED,
      note: "kept",
    });

    const raw = getSqlite()
      .prepare("select detail from activity_log where resource_id = 'task-2'")
      .get() as { detail: string | null };
    expect(raw.detail).not.toContain("hunter2");
    expect(raw.detail).not.toContain(secretValue);
    expect(raw.detail).toContain("kept");
  });

  it("bounds the payload rather than trusting it", async () => {
    expect(sanitizeActivityDetail({ a: { b: { c: { d: { e: "buried" } } } } }).detail).toEqual({
      a: { b: { c: { d: "[truncated]" } } },
    });

    const many = sanitizeActivityDetail(
      Object.fromEntries(Array.from({ length: 25 }, (_, index) => [`k${index}`, index])),
    ).detail as Record<string, unknown>;
    expect(Object.keys(many).length).toBe(25);
    expect(many.truncated).toBe(true);

    // A 301-character note is truncated to the cap plus an ellipsis. The payload
    // has to be non-secret-shaped or `redact()` would replace it wholesale.
    const long = sanitizeActivityDetail({ note: `${"x".repeat(300)} ok` }).detail as Record<
      string,
      unknown
    >;
    expect(long.note as string).toHaveLength(301);
    expect(long.note as string).toMatch(/…$/);

    expect(await reasonOf((async () => sanitizeActivityDetail(["not", "an", "object"]))())).toBe(
      "invalid_detail",
    );
    // Strings are capped before the size check, so the JSON cap is reached by
    // many capped-sized children rather than one oversized string.
    const wide = Object.fromEntries(
      Array.from({ length: 24 }, (_, index) => [`k${index}`, `${"x".repeat(300)} ok`]),
    );
    expect(await reasonOf(record({ actor: owner, resourceId: "task-3", detail: wide }))).toBe(
      "invalid_detail",
    );
    expect(
      await activityForResource(owner, { resourceType: "task", resourceId: "task-3" }),
    ).toEqual([]);
  });

  it("refuses vocabulary and permissions it was not given", async () => {
    expect(await reasonOf(record({ actor: owner, resourceType: "widget" }))).toBe(
      "unknown_resource_kind",
    );
    expect(await reasonOf(record({ actor: owner, action: "exploded" }))).toBe(
      "unknown_activity_action",
    );
    expect(await reasonOf(record({ actor: owner }))).toBeNull();

    const passive = await createFirstAdmin({
      name: "Passive User",
      email: "passive@example.internal",
      password,
      role: "read_only",
    });
    let denied = false;
    try {
      await record({ actor: actorFor(passive) });
    } catch (error) {
      denied = error instanceof AuthorizationError;
    }
    expect(denied).toBe(true);
    expect((await listActivity(actorFor(passive))).items).toEqual([]);
  });

  it("pages by (created_at, id) and rejects a malformed window", async () => {
    for (const action of ["created", "updated", "completed"]) {
      await record({ actor: owner, action });
    }

    const all = (await listActivity(owner)).items;
    expect(all.map((item) => item.action).sort()).toEqual(["completed", "created", "updated"]);

    const page1 = await listActivity(owner, { limit: 2 });
    expect(page1.items.map((item) => item.id)).toEqual(all.slice(0, 2).map((item) => item.id));
    expect(page1.nextCursor).not.toBeNull();
    const page2 = await listActivity(owner, { limit: 2, cursor: page1.nextCursor });
    expect(page2.items.map((item) => item.id)).toEqual(all.slice(2, 3).map((item) => item.id));
    expect(page2.nextCursor).toBeNull();

    const future = new Date(Date.now() + 60_000).toISOString();
    const weekAhead = new Date(Date.now() + 7 * 86_400_000).toISOString();
    expect((await listActivity(owner, { window: { from: future, to: weekAhead } })).items).toEqual(
      [],
    );
    expect(
      await reasonOf(listActivity(owner, { window: { from: "yesterday", to: weekAhead } })),
    ).toBe("invalid_window");
    expect(
      await reasonOf(
        listActivity(owner, {
          window: { from: new Date(Date.now() - 400 * 86_400_000).toISOString(), to: weekAhead },
        }),
      ),
    ).toBe("window_too_large");
  });

  it("unions the actor's own feed with entries for resources shared with them", async () => {
    await record({ actor: other, resourceId: "task-7", action: "completed" });
    await record({ actor: owner, resourceId: "task-own" });
    expect((await listActivity(owner)).items.map((item) => item.resourceId)).toEqual(["task-own"]);

    await grantActivityView("task", "task-7", owner.userId, other.userId);

    const shared = await listActivity(owner);
    expect(shared.items.map((item) => item.resourceId).sort()).toEqual(["task-7", "task-own"]);
    expect((await listActivity(other)).items.map((item) => item.resourceId)).toEqual(["task-7"]);
  });
});
