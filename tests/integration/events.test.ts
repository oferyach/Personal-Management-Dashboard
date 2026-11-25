import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createFirstAdmin } from "@/lib/adminBootstrap";
import { closeDatabase } from "@/db/client";
import { ProductivityError } from "@/lib/productivity";
import { resetAuthInstance } from "@/lib/auth";
import {
  addParticipant,
  createEvent,
  listEvents,
  listEventsAttendedBy,
  readEvent,
  removeParticipant,
  updateEvent,
} from "@/lib/events";
import type { EventRecord } from "@/lib/events";
import { type Actor } from "@/lib/rbac";
import { resetTestDatabase } from "../helpers/testDb";

/**
 * Packet 2B integration half: the accounts below are real rows created through
 * the same bootstrap path the other service suites use, so the permission
 * decisions exercised here are the ones the resolver will make in production.
 * `twoFactorEnabled` is set because privileged roles require an enrolled
 * authenticator before any authorization passes.
 */

const PASSWORD = "Events-Service-Password-2026!";

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

const WINDOW = { from: "2026-11-24T00:00:00.000Z", to: "2026-11-26T00:00:00.000Z" };

let admin: Actor;
let owner: Actor;
let guest: Actor;
let outsider: Actor;
let spectator: Actor;
let event: EventRecord;

beforeAll(async () => {
  resetTestDatabase("events-integration");
  resetAuthInstance();

  const privileged = await createFirstAdmin({
    name: "Calendar Admin",
    email: "calendar-admin@example.internal",
    password: PASSWORD,
    role: "admin",
  });
  const first = await createFirstAdmin({
    name: "Event Owner",
    email: "owner-events@example.internal",
    password: PASSWORD,
    role: "user",
  });
  const invited = await createFirstAdmin({
    name: "Invited Guest",
    email: "guest-events@example.internal",
    password: PASSWORD,
    role: "user",
  });
  const stranger = await createFirstAdmin({
    name: "Stranger",
    email: "outsider-events@example.internal",
    password: PASSWORD,
    role: "user",
  });
  const spectatorAccount = await createFirstAdmin({
    name: "Spectator",
    email: "spectator-events@example.internal",
    password: PASSWORD,
    role: "read_only",
  });

  admin = actorFor(privileged);
  owner = actorFor(first);
  guest = actorFor(invited);
  outsider = actorFor(stranger);
  spectator = actorFor(spectatorAccount);

  event = await createEvent(owner, {
    actor: owner,
    title: "Owner event",
    start: "2026-11-25T09:00:00Z",
    end: "2026-11-25T10:00:00Z",
    description: "Owned by the event owner",
    category: "work",
    color: "#ff0000",
    location: "Office",
  });
});

afterAll(async () => {
  closeDatabase();
});

describe("actor-scoped event reads", () => {
  it("returns the owner's event to the owner and to nobody else", async () => {
    const byOwner = await readEvent(owner, event.id);
    expect(byOwner.ownerUserId).toBe(owner.userId);
    expect(byOwner.title).toBe("Owner event");

    // A stranger sees the same answer as for an id that was never issued:
    // existence is not leaked, so ids are safe to put in URLs.
    expect(await reasonOf(readEvent(outsider, event.id))).toBe("not_found");
    expect(await reasonOf(readEvent(guest, event.id))).toBe("not_found");
    expect(await reasonOf(readEvent(admin, randomUUID()))).toBe("not_found");
  });

  it("lets an admin reach another account's event through the any-scope view", async () => {
    const byAdmin = await readEvent(admin, event.id);
    expect(byAdmin.id).toBe(event.id);

    const adminList = await listEvents(admin, { window: WINDOW });
    const ownerList = await listEvents(owner, { window: WINDOW });
    expect(adminList.items.map((item) => item.id)).toContain(event.id);
    expect(ownerList.items.map((item) => item.id)).toEqual([event.id]);
  });

  it("keeps a shared-view-only role out of events it does not attend", async () => {
    // `read_only` holds `calendar.view.shared` but not `calendar.view.own`, so
    // its whole world is "events I was invited into": the owner's event is
    // invisible rather than forbidden, and its own list is empty. The
    // `not_authorized` branch (an actor holding no calendar view at all) is
    // unit-covered, because no seeded role reaches it.
    expect(await reasonOf(readEvent(spectator, event.id))).toBe("not_found");
    expect((await listEvents(spectator, { window: WINDOW })).items).toEqual([]);
    expect((await listEventsAttendedBy(spectator, { window: WINDOW })).items).toEqual([]);
  });
});

describe("windowed pagination", () => {
  it("walks every event exactly once across pages", async () => {
    const paged: string[] = [];
    for (let day = 1; day <= 6; day += 1) {
      const hour = String(10 + day).padStart(2, "0");
      const created = await createEvent(owner, {
        actor: owner,
        title: `Paged ${day}`,
        start: `2026-11-24T${hour}:00:00Z`,
        end: `2026-11-24T${hour}:30:00Z`,
      });
      paged.push(created.id);
    }

    const first = await listEvents(owner, { window: WINDOW, limit: 4 });
    expect(first.items).toHaveLength(4);
    expect(first.nextCursor).not.toBeNull();

    const second = await listEvents(owner, {
      window: WINDOW,
      limit: 4,
      cursor: first.nextCursor!,
    });
    expect(second.items.length).toBeGreaterThan(0);
    expect(second.nextCursor).toBeNull();

    const seen = [...first.items, ...second.items].map((item) => item.id);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toHaveLength(7);
    expect(new Set(seen)).toEqual(new Set([event.id, ...paged]));
  });
});
describe("participant authorization", () => {
  it("grants an invited account read access, and revokes it when it leaves", async () => {
    await addParticipant(owner, { actor: owner, eventId: event.id, userId: guest.userId });

    const byGuest = await readEvent(guest, event.id);
    expect(byGuest.id).toBe(event.id);
    const attended = await listEventsAttendedBy(guest, { window: WINDOW });
    expect(attended.items.map((item) => item.id)).toContain(event.id);

    await removeParticipant(owner, { actor: owner, eventId: event.id, userId: guest.userId });
    expect(await reasonOf(readEvent(guest, event.id))).toBe("not_found");
    expect((await listEventsAttendedBy(guest, { window: WINDOW })).items).toEqual([]);
  });

  it("refuses an invitation managed from an account that does not own the event", async () => {
    // The event is not in the stranger's view at all, so the share attempt is
    // answered like a bad id rather than confirming the event exists.
    expect(
      await reasonOf(
        addParticipant(outsider, { actor: outsider, eventId: event.id, userId: guest.userId }),
      ),
    ).toBe("not_found");
    expect(await reasonOf(readEvent(guest, event.id))).toBe("not_found");

    // An admin holds `calendar.edit.any`, so managing invitations on another
    // account's event is the documented exception.
    await addParticipant(admin, { actor: admin, eventId: event.id, userId: guest.userId });
    const attended = await listEventsAttendedBy(guest, { window: WINDOW });
    expect(attended.items.map((item) => item.id)).toContain(event.id);
    await removeParticipant(admin, { actor: admin, eventId: event.id, userId: guest.userId });
  });

  it("does not let an invitee edit the event it was invited to", async () => {
    await addParticipant(owner, { actor: owner, eventId: event.id, userId: guest.userId });
    expect(
      await reasonOf(
        updateEvent(guest, {
          actor: guest,
          eventId: event.id,
          expectedUpdatedAt: event.updatedAt,
          title: "Guest rename",
        }),
      ),
    ).toBe("not_authorized");
    const unchanged = await readEvent(owner, event.id);
    expect(unchanged.title).toBe("Owner event");
    await removeParticipant(owner, { actor: owner, eventId: event.id, userId: guest.userId });
  });
});

describe("optimistic concurrency between two actors", () => {
  it("accepts the first write and rejects the stale one", async () => {
    const current = await readEvent(owner, event.id);
    const first = await updateEvent(owner, {
      actor: owner,
      eventId: event.id,
      expectedUpdatedAt: current.updatedAt,
      title: "First write wins",
    });
    expect(first.title).toBe("First write wins");

    const stale = updateEvent(admin, {
      actor: admin,
      eventId: event.id,
      expectedUpdatedAt: current.updatedAt,
      title: "Second write loses",
    });
    expect(await reasonOf(stale)).toBe("version_conflict");

    const after = await readEvent(owner, event.id);
    expect(after.title).toBe("First write wins");
    expect(after.updatedAt).toBe(first.updatedAt);
  });
});

describe("persistence across a fresh connection", () => {
  it("re-reads a UTC event after the database connection is closed", async () => {
    const created = await createEvent(owner, {
      actor: owner,
      title: "Survives a reconnect",
      start: "2026-11-25T23:30:00+02:00",
      end: "2026-11-26T00:30:00+02:00",
      timezone: "Asia/Jerusalem",
    });
    expect(created.startAt).toBe("2026-11-25T21:30:00.000Z");

    closeDatabase();
    const reopened = await readEvent(owner, created.id);
    expect(reopened.title).toBe("Survives a reconnect");
    expect(reopened.startAt).toBe("2026-11-25T21:30:00.000Z");
    expect(reopened.endAt).toBe("2026-11-25T22:30:00.000Z");
    expect(reopened.timezone).toBe("Asia/Jerusalem");

    // The admin view still reaches the row after the reconnect, and the
    // stranger still does not.
    expect((await readEvent(admin, created.id)).id).toBe(created.id);
    expect(await reasonOf(readEvent(outsider, created.id))).toBe("not_found");

    const attendedByOutsider = await listEventsAttendedBy(outsider, { window: WINDOW });
    expect(attendedByOutsider.items.map((item) => item.id)).not.toContain(created.id);
  });
});
