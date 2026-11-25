import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDatabase } from "@/db/client";

import { createFirstAdmin } from "@/lib/adminBootstrap";
import { resetAuthInstance } from "@/lib/auth";
import { addParticipant, createEvent, listEvents } from "@/lib/events";
import { type Actor } from "@/lib/rbac";
import { resetTestDatabase } from "../helpers/testDb";

/**
 * Packet 2D integration half: the shared agenda as a *read* over the storage
 * packet 2C created. No new table and no new index — what is proven here is the
 * three properties a per-account view would get wrong: the row set is the
 * caller's visibility union (own rows plus rows the caller attends, plus every
 * row for an actor holding `calendar.view.any`), the order is `(start_at, id)`,
 * and the keyset cursor pages that order without repeating or dropping a row
 * even when two events start in the same second.
 */

const PASSWORD = "Agenda-Service-Password-2026!";

function actorFor(user: { id: string; role: Actor["role"] }): Actor {
  return { userId: user.id, role: user.role, twoFactorEnabled: true, sessionFresh: true };
}

const WINDOW = { window: { from: "2026-11-24T00:00:00.000Z", to: "2026-11-28T00:00:00.000Z" } };

let admin: Actor;
let host: Actor;
let mate: Actor;
let reader: Actor;

/** `(id, startAt)` of every event the host may see, in the service's own order. */
let hostAgenda: { id: string; startAt: string }[] = [];

/** Every event this fixture creates, so a whole-table read can be checked. */
const createdEvents: { title: string; ownerUserId: string }[] = [];

async function makeEvent(owner: Actor, title: string, startAt: string): Promise<string> {
  const record = await createEvent(owner, {
    actor: owner,
    title,
    start: startAt,
    end: `${startAt.slice(0, 11)}23:59:59.000Z`,
  });
  expect(record.ownerUserId).toBe(owner.userId);
  createdEvents.push({ title, ownerUserId: owner.userId });
  return record.id;
}

beforeAll(async () => {
  resetTestDatabase("events-agenda");
  resetAuthInstance();

  const privileged = await createFirstAdmin({
    name: "Agenda Admin",
    email: "agenda-admin@example.internal",
    password: PASSWORD,
    role: "admin",
  });
  const owning = await createFirstAdmin({
    name: "Agenda Host",
    email: "agenda-host@example.internal",
    password: PASSWORD,
    role: "user",
  });
  const invited = await createFirstAdmin({
    name: "Agenda Mate",
    email: "agenda-mate@example.internal",
    password: PASSWORD,
    role: "user",
  });
  const sharedOnly = await createFirstAdmin({
    name: "Agenda Reader",
    email: "agenda-reader@example.internal",
    password: PASSWORD,
    role: "read_only",
  });

  admin = actorFor(privileged);
  host = actorFor(owning);
  mate = actorFor(invited);
  reader = actorFor(sharedOnly);

  // Four events for the host. Two share one start instant on purpose: the id
  // half of the cursor is what makes paging stable across that tie.
  const first = await makeEvent(host, "First task", "2026-11-24T09:00:00.000Z");
  const tieA = await makeEvent(host, "Tie A", "2026-11-25T08:00:00.000Z");
  const tieB = await makeEvent(host, "Tie B", "2026-11-25T08:00:00.000Z");
  const late = await makeEvent(host, "Late task", "2026-11-27T09:00:00.000Z");

  // Two for the mate; only the first is shared with the host.
  const hostedByMate = await makeEvent(mate, "Mate hosted", "2026-11-26T10:00:00.000Z");
  await makeEvent(mate, "Mate private", "2026-11-26T11:00:00.000Z");
  // Only the mate's first event is shared, and it is the *owner* who may invite:
  // the host cannot add themselves to a row they cannot yet see.
  await addParticipant(mate, { actor: mate, eventId: hostedByMate, userId: host.userId });

  // The read_only account attends exactly one of the host's events.
  await addParticipant(host, { actor: host, eventId: late, userId: reader.userId });

  hostAgenda = [
    { id: first, startAt: "2026-11-24T09:00:00.000Z" },
    { id: tieA, startAt: "2026-11-25T08:00:00.000Z" },
    { id: tieB, startAt: "2026-11-25T08:00:00.000Z" },
    { id: late, startAt: "2026-11-27T09:00:00.000Z" },
    { id: hostedByMate, startAt: "2026-11-26T10:00:00.000Z" },
  ].sort((a, b) => (a.startAt < b.startAt ? -1 : a.startAt > b.startAt ? 1 : a.id < b.id ? -1 : 1));
});

afterAll(async () => {
  await closeDatabase();
});

describe("the shared agenda read", () => {
  it("answers with the caller's own rows plus the rows they attend", async () => {
    const page = await listEvents(host, WINDOW);
    expect(page.items.map((item) => item.id)).toEqual(hostAgenda.map((item) => item.id));
    // The mate's other event is neither the host's nor attended by them.
    expect(page.items.some((item) => item.title === "Mate private")).toBe(false);
  });

  it("orders by start instant then id, so a shared instant still has one order", async () => {
    const page = await listEvents(host, WINDOW);
    const keys = page.items.map((item) => `${item.startAt}|${item.id}`);
    expect(keys).toEqual([...keys].sort());
    // The tie is real: five rows, four distinct instants.
    expect(new Set(page.items.map((item) => item.startAt)).size).toBe(4);
  });

  it("pages the whole agenda with the returned cursor, once each", async () => {
    const seen: string[] = [];
    let cursor: { startAt: string; id: string } | null = null;
    let pages = 0;

    for (;;) {
      const page = await listEvents(host, { ...WINDOW, limit: 2, cursor });
      pages += 1;
      seen.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
      if (cursor === null) break;
      expect(pages, "the walk must terminate").toBeLessThan(8);
    }

    expect(pages).toBe(3);
    expect(seen).toEqual(hostAgenda.map((item) => item.id));
  });

  it("keeps the cursor a position, not an offset, when a row is written mid-walk", async () => {
    const first = await listEvents(host, { ...WINDOW, limit: 2 });
    expect(first.items.map((item) => item.id)).toEqual(hostAgenda.slice(0, 2).map((i) => i.id));

    // Inserted behind the cursor: it must not shift the next page.
    const inserted = await makeEvent(host, "Mid-walk insert", "2026-11-24T10:00:00.000Z");
    const second = await listEvents(host, { ...WINDOW, limit: 2, cursor: first.nextCursor });
    expect(second.items.map((item) => item.id)).toEqual(hostAgenda.slice(2, 4).map((i) => i.id));

    // And it is not lost: a fresh read places it where its start instant says.
    const reread = await listEvents(host, { ...WINDOW, limit: 3 });
    expect(reread.items.map((item) => item.id)).toEqual([
      hostAgenda[0]!.id,
      inserted,
      hostAgenda[1]!.id,
    ]);
  });

  it("shows one account's agenda whole to an actor holding calendar.view.any", async () => {
    const page = await listEvents(admin, WINDOW);
    const titles = new Set(page.items.map((item) => item.title));
    // Every event this fixture wrote is visible to the admin, including the
    // mate's private one that the host's agenda must exclude.
    for (const event of createdEvents) {
      expect(titles.has(event.title), event.title).toBe(true);
    }
    expect(page.items.map((item) => item.ownerUserId)).toContain(mate.userId);
  });

  it("limits a calendar.view.shared account to the events it attends", async () => {
    const page = await listEvents(reader, WINDOW);
    expect(page.items.map((item) => item.title)).toEqual(["Late task"]);
    // Still a read the grant allows, so an empty agenda is an empty set, not a
    // refusal: this window holds nothing the reader attends.
    const empty = await listEvents(reader, {
      window: { from: "2026-11-24T00:00:00.000Z", to: "2026-11-25T00:00:00.000Z" },
    });
    expect(empty.items).toEqual([]);
    expect(empty.nextCursor).toBeNull();
  });
});
