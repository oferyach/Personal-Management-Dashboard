import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createFirstAdmin } from "@/lib/adminBootstrap";
import { closeDatabase } from "@/db/client";
import { ProductivityError } from "@/lib/productivity";
import { resetAuthInstance } from "@/lib/auth";
import {
  addEventTag,
  addParticipant,
  createEvent,
  duplicateEvent,
  listEventTags,
  listEvents,
  listEventsAttendedBy,
  readEvent,
  searchEvents,
  listEventParticipants,
  updateEvent,
} from "@/lib/events";
import { createTag } from "@/lib/tags";
import { activityForResource } from "@/lib/activity";
import { type Actor } from "@/lib/rbac";
import { resetTestDatabase } from "../helpers/testDb";

/**
 * Packet 2C integration half: the non-recurring event service as one surface —
 * create, edit with an optimistic token, duplicate, attended-by, and search —
 * against real seeded roles, so every assertion about who may see or change a
 * row is the resolver's decision rather than a mocked one.
 */

const PASSWORD = "Event-Service-Password-2026!";

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

const WINDOW = { from: "2026-11-24T00:00:00.000Z", to: "2026-11-28T00:00:00.000Z" };

let admin: Actor;
let host: Actor;
let mate: Actor;
let stranger: Actor;
let workSyncId = "";
let deepWorkId = "";
let percentId = "";
let lunchId = "";

beforeAll(async () => {
  resetTestDatabase("events-service");
  resetAuthInstance();

  const privileged = await createFirstAdmin({
    name: "Service Admin",
    email: "service-admin@example.internal",
    password: PASSWORD,
    role: "admin",
  });
  const owning = await createFirstAdmin({
    name: "Event Host",
    email: "event-host@example.internal",
    password: PASSWORD,
    role: "user",
  });
  const invited = await createFirstAdmin({
    name: "Invited Mate",
    email: "invited-mate@example.internal",
    password: PASSWORD,
    role: "user",
  });
  const outsider = await createFirstAdmin({
    name: "Total Stranger",
    email: "total-stranger@example.internal",
    password: PASSWORD,
    role: "user",
  });

  admin = actorFor(privileged);
  host = actorFor(owning);
  mate = actorFor(invited);
  stranger = actorFor(outsider);

  workSyncId = (
    await createEvent(host, {
      actor: host,
      title: "Standup sync",
      description: "Weekly sync call",
      start: "2026-11-25T09:00:00Z",
      end: "2026-11-25T10:00:00Z",
      category: "work",
      location: "Room 4",
    })
  ).id;
  deepWorkId = (
    await createEvent(host, {
      actor: host,
      title: "Deep work block",
      description: "Draft the roadmap",
      start: "2026-11-25T14:00:00Z",
      end: "2026-11-25T15:00:00Z",
      category: "",
      location: "",
    })
  ).id;
  percentId = (
    await createEvent(host, {
      actor: host,
      title: "Release 100% done",
      start: "2026-11-26T09:00:00Z",
      end: "2026-11-26T10:00:00Z",
    })
  ).id;
  lunchId = (
    await createEvent(host, {
      actor: host,
      title: "Invite lunch",
      start: "2026-11-26T12:00:00Z",
      end: "2026-11-26T13:00:00Z",
    })
  ).id;
  await addParticipant(host, { actor: host, eventId: lunchId, userId: mate.userId });
});

afterAll(async () => {
  await closeDatabase();
});

describe("create and edit", () => {
  it("creates an event the caller owns and records it in the feed", async () => {
    const created = await createEvent(host, {
      actor: host,
      title: "Interview prep",
      start: "2026-11-27T09:00:00Z",
      end: "2026-11-27T10:30:00Z",
    });
    expect(created.ownerUserId).toBe(host.userId);
    expect(created.status).toBe("tentative");
    expect(created.isAllDay).toBe(false);
    expect(created.description).toBeNull();
    expect(created.category).toBeNull();
    expect(created.location).toBeNull();

    const feed = await activityForResource(host, {
      resourceType: "event",
      resourceId: created.id,
    });
    expect(feed.map((entry) => entry.action)).toEqual(["created"]);
  });

  it("leaves omitted fields alone and clears only the ones sent as null", async () => {
    const before = await readEvent(host, workSyncId);
    const kept = await updateEvent(host, {
      actor: host,
      eventId: workSyncId,
      expectedUpdatedAt: before.updatedAt,
      title: "Standup sync (weekly)",
    });
    expect(kept.title).toBe("Standup sync (weekly)");
    expect(kept.description).toBe("Weekly sync call");
    expect(kept.category).toBe("work");
    expect(kept.location).toBe("Room 4");

    const cleared = await updateEvent(host, {
      actor: host,
      eventId: workSyncId,
      expectedUpdatedAt: kept.updatedAt,
      category: null,
    });
    expect(cleared.category).toBeNull();
    expect(cleared.location).toBe("Room 4");
    expect(cleared.title).toBe("Standup sync (weekly)");
  });

  it("refuses a stale token, a foreign row, and an inverted range", async () => {
    expect(
      await reasonOf(
        updateEvent(host, {
          actor: host,
          eventId: deepWorkId,
          expectedUpdatedAt: "2026-01-01T00:00:00.000Z",
          title: "Stale write",
        }),
      ),
    ).toBe("version_conflict");

    const visibleToStranger = await readEvent(stranger, deepWorkId).catch(() => null);
    expect(visibleToStranger).toBeNull();
    const before = await readEvent(host, deepWorkId);
    expect(
      await reasonOf(
        updateEvent(stranger, {
          actor: stranger,
          eventId: deepWorkId,
          expectedUpdatedAt: before.updatedAt,
          title: "Hijack",
        }),
      ),
    ).toBe("not_found");
    expect((await readEvent(host, deepWorkId)).title).toBe("Deep work block");

    expect(
      await reasonOf(
        updateEvent(host, {
          actor: host,
          eventId: deepWorkId,
          expectedUpdatedAt: before.updatedAt,
          start: "2026-11-25T15:00:00Z",
          end: "2026-11-25T14:00:00Z",
        }),
      ),
    ).toBe("inverted_range");

    const viaAdmin = await updateEvent(admin, {
      actor: admin,
      eventId: deepWorkId,
      expectedUpdatedAt: before.updatedAt,
      status: "confirmed",
    });
    expect(viaAdmin.ownerUserId).toBe(host.userId);
    expect(viaAdmin.status).toBe("confirmed");
  });

  it("copies a row for the caller and leaves the original alone", async () => {
    const tag = await createTag(host, { name: "lunch-week" });
    await addEventTag(host, { actor: host, eventId: lunchId, tagId: tag.id });

    const original = await readEvent(host, lunchId);
    const copy = await duplicateEvent(host, lunchId);
    expect(copy.id).not.toBe(lunchId);
    expect(copy.title).toBe(original.title);
    expect(copy.startAt).toBe(original.startAt);
    expect(copy.endAt).toBe(original.endAt);
    expect(copy.ownerUserId).toBe(host.userId);

    const untouched = await readEvent(host, lunchId);
    expect(untouched.id).toBe(lunchId);
    expect(untouched.updatedAt).toBe(original.updatedAt);

    // A copy is a fresh row: the invitation and the tag do not travel with it.
    expect(await listEventTags(host, lunchId)).toEqual(["lunch-week"]);
    expect(await listEventTags(host, copy.id)).toEqual([]);
    expect((await listEventParticipants(host, copy.id)).map((p) => p.userId)).toEqual([]);

    const byAdmin = await duplicateEvent(admin, lunchId);
    expect(byAdmin.ownerUserId).toBe(admin.userId);
    expect(byAdmin.title).toBe(original.title);

    expect(await reasonOf(duplicateEvent(stranger, lunchId))).toBe("not_found");
    expect(await reasonOf(duplicateEvent(host, "evt0000000000000000000000"))).toBe("not_found");
  });

  it("finds exactly the events the attended-by user takes part in", async () => {
    const forMate = await listEventsAttendedBy(mate, { window: WINDOW });
    expect(forMate.items.map((item) => item.id)).toEqual([lunchId]);

    const forStranger = await listEventsAttendedBy(stranger, {
      window: WINDOW,
    });
    expect(forStranger.items).toEqual([]);
    expect(forStranger.nextCursor).toBeNull();

    // The same question asked through the agenda filter, by someone who may
    // reach other accounts: host's own event, attended by mate.
    const viaFilter = await listEvents(admin, {
      window: WINDOW,
      attendeeUserId: mate.userId,
    });
    expect(viaFilter.items.map((item) => item.id)).toEqual([lunchId]);

    expect(
      await reasonOf(listEvents(stranger, { window: WINDOW, attendeeUserId: mate.userId })),
    ).toBe("not_authorized");
  });

  it("matches titles and descriptions inside the window, scoped to the caller", async () => {
    const byHost = await searchEvents(host, { window: WINDOW, text: "sync" });
    expect(byHost.items.map((item) => item.id)).toEqual([workSyncId]);

    const roadmap = await searchEvents(admin, { window: WINDOW, text: "roadmap" });
    expect(roadmap.items.map((item) => item.id)).toEqual([deepWorkId]);

    // A stranger cannot reach these rows at all, so no phrase matches them.
    const blind = await searchEvents(stranger, { window: WINDOW, text: "roadmap" });
    expect(blind.items).toEqual([]);

    // The attendee searches an event they did not create.
    const lunchSeen = await searchEvents(mate, { window: WINDOW, text: "lunch" });
    expect(lunchSeen.items.map((item) => item.id)).toEqual([lunchId]);

    expect(await reasonOf(searchEvents(host, { window: WINDOW, text: "   " }))).toBe(
      "invalid_query",
    );
  });

  it("escapes LIKE wildcards instead of treating them as syntax", async () => {
    const percent = await searchEvents(host, { window: WINDOW, text: "100%" });
    expect(percent.items.map((item) => item.id)).toEqual([percentId]);

    // An unescaped `_` would match the `%` in "100%"; it has to be literal text.
    const underscore = await searchEvents(host, { window: WINDOW, text: "100_" });
    expect(underscore.items).toEqual([]);

    const bare = await searchEvents(host, { window: WINDOW, text: "%" });
    expect(bare.items.map((item) => item.id)).toEqual([percentId]);
  });

  it("applies status, location, and category filters to the caller's rows", async () => {
    const tentative = await listEvents(admin, { window: WINDOW, status: "confirmed" });
    expect(tentative.items.map((item) => item.id)).toEqual([deepWorkId]);

    const near = await listEvents(host, { window: WINDOW, location: "room" });
    expect(near.items.map((item) => item.id)).toEqual([workSyncId]);

    // The category was cleared by an explicit null earlier, so it no longer matches.
    const work = await listEvents(host, { window: WINDOW, category: "work" });
    expect(work.items).toEqual([]);
  });

  it("records create, edit, and duplicate in the resource feed", async () => {
    const edits = await activityForResource(host, {
      resourceType: "event",
      resourceId: workSyncId,
    });
    const actions = edits.map((entry) => entry.action);
    expect(actions).toContain("created");
    expect(actions).toContain("updated");

    const copy = await duplicateEvent(host, percentId);
    const feed = await activityForResource(host, { resourceType: "event", resourceId: copy.id });
    expect(feed).toHaveLength(1);
    expect(feed.map((entry) => entry.action)).toEqual(["created"]);
    expect(feed[0]?.detail).toMatchObject({ duplicatedFrom: percentId });

    expect(
      await reasonOf(activityForResource(host, { resourceType: "bogus", resourceId: copy.id })),
    ).toBe("unknown_resource_kind");
  });
});
