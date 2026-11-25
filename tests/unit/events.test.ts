import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { closeDatabase, getDb } from "@/db/client";
import { events as eventsTable, users as usersTable } from "@/db/schema";
import { ProductivityError } from "@/lib/productivity";
import {
  EVENT_STATUSES,
  MAX_EVENT_CATEGORY_LENGTH,
  MAX_EVENT_DESCRIPTION_LENGTH,
  MAX_EVENT_LOCATION_LENGTH,
  MAX_EVENT_TITLE_LENGTH,
  MAX_PAGE_SIZE,
  clampPageSize,
  isEventStatus,
  parseQueryWindow,
} from "@/lib/productivity";
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
import { readPreferences } from "@/lib/preferences";
import { resetTestDatabase } from "../helpers/testDb";

/**
 * Packet 2B unit half: the validation vocabulary, the UTC/all-day normalization
 * rules, and the generated SQL that has to keep agreeing with them. Actor/RBAC
 * behaviour lives in `tests/integration/events.test.ts`, where the actors come
 * from real accounts.
 */

const EPOCH = "2026-01-01T00:00:00.000Z";

function actorFor(
  userId: string,
  role: "user" | "admin",
): {
  userId: string;
  role: "user" | "admin";
  twoFactorEnabled: boolean;
  sessionFresh: boolean;
} {
  return { userId, role, twoFactorEnabled: true, sessionFresh: true };
}

/** A real `users` row, because `events.owner_user_id` is a foreign key. */
async function makeUser(role: "user" | "admin" = "user"): Promise<string> {
  const id = randomUUID();
  await getDb()
    .insert(usersTable)
    .values({
      id,
      name: `Owner ${id}`,
      email: `${id}@example.internal`,
      role,
      createdAt: EPOCH,
      updatedAt: EPOCH,
    });
  return id;
}

/** Returns the machine-readable reason of a ProductivityError, or null. */
async function reasonOf(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    expect(error, String(error)).toBeInstanceOf(ProductivityError);
    return (error as ProductivityError).reason;
  }
}

/** One valid create call, with the caller's identity filled in by the caller. */
async function create(ownerId: string, overrides: Record<string, unknown> = {}) {
  return createEvent(actorFor(ownerId, "user"), {
    actor: actorFor(ownerId, "user"),
    title: "Kickoff",
    start: "2026-11-25T09:00:00Z",
    end: "2026-11-25T10:00:00Z",
    ...overrides,
  });
}

/**
 * The CHECK constraints are the only place the status vocabulary and the UTC
 * storage rule exist as SQL, and drizzle regenerates them from
 * `src/db/schema/events.ts`. Reading the committed migration and comparing the
 * two lists is what stops the TypeScript constant and the database rule from
 * drifting apart silently.
 */
describe("generated event SQL", () => {
  const sql = readFileSync(
    resolve(import.meta.dirname, "../../drizzle/0003_phase2b_events.sql"),
    "utf8",
  );

  it("locks the status CHECK to the TypeScript vocabulary", () => {
    const list = /"status" in \(([^)]*)\)/.exec(sql)?.[1] ?? "";
    const statuses = list.split(",").map((entry) => entry.trim().replace(/^'|'$/g, ""));
    expect(statuses).toEqual([...EVENT_STATUSES]);
    expect(isEventStatus("cancelled")).toBe(true);
    expect(isEventStatus("maybe")).toBe(false);
  });

  it("requires a trailing-Z instant for both endpoints and an ordered range", () => {
    expect(sql).toContain('CONSTRAINT "events_start_utc_chk" CHECK("start_at" glob');
    expect(sql).toContain('CONSTRAINT "events_end_utc_chk" CHECK("end_at" glob');
    expect(sql).toContain('CONSTRAINT "events_time_chk" CHECK("end_at" > "start_at")');
  });

  it("forces all-day rows onto calendar-day boundaries", () => {
    expect(sql).toContain(
      'CONSTRAINT "events_all_day_bounds_chk" CHECK("is_all_day" = 0 OR ' +
        "(substr(\"start_at\", 12, 8) = '00:00:00' AND substr(\"end_at\", 12, 8) = '00:00:00'))",
    );
  });

  it("keeps every reason thrown by the service inside the shared union", () => {
    const service = readFileSync(resolve(import.meta.dirname, "../../src/lib/events.ts"), "utf8");
    const source = readFileSync(
      resolve(import.meta.dirname, "../../src/lib/productivity.ts"),
      "utf8",
    );
    const union = /export type ProductivityErrorReason =([\s\S]*?);/.exec(source)?.[1] ?? "";
    const declared = new Set([...union.matchAll(/"([a-z_]+)"/g)].map((match) => match[1]));
    expect(declared.size).toBeGreaterThan(20);
    const thrown = [...service.matchAll(/new ProductivityError\(\s*"([a-z_]+)"/g)].map(
      (match) => match[1],
    );
    expect(thrown.length).toBeGreaterThan(10);
    for (const reason of thrown) expect(declared.has(reason), reason).toBe(true);
  });
});

describe("event input validation", () => {
  beforeAll(() => resetTestDatabase("events-unit"));
  afterAll(() => closeDatabase());

  it("rejects a missing, blank, oversized or control-character title", async () => {
    const owner = await makeUser();
    expect(await reasonOf(create(owner, { title: "" }))).toBe("invalid_title");
    expect(await reasonOf(create(owner, { title: "   " }))).toBe("invalid_title");
    expect(await reasonOf(create(owner, { title: "evil\u0007title" }))).toBe("invalid_title");
    expect(await reasonOf(create(owner, { title: "x".repeat(MAX_EVENT_TITLE_LENGTH + 1) }))).toBe(
      "title_too_long",
    );
    const boundary = await create(owner, { title: "x".repeat(MAX_EVENT_TITLE_LENGTH) });
    expect(boundary.title.length).toBe(MAX_EVENT_TITLE_LENGTH);
  });

  it("rejects an instant without an explicit zone rather than guessing local time", async () => {
    const owner = await makeUser();
    expect(await reasonOf(create(owner, { start: "2026-11-25T09:00" }))).toBe("invalid_instant");
    expect(await reasonOf(create(owner, { start: "2026-11-25 09:00" }))).toBe("invalid_instant");
    expect(await reasonOf(create(owner, { start: "25/11/2026" }))).toBe("invalid_instant");
    expect(
      await reasonOf(create(owner, { start: "2026-11-25T09:00Z", end: "2026-11-25T10:00Z" })),
    ).toBe(null);
  });

  it("refuses an event that ends at or before it starts", async () => {
    const owner = await makeUser();
    expect(
      await reasonOf(create(owner, { start: "2026-11-25T10:00:00Z", end: "2026-11-25T09:00:00Z" })),
    ).toBe("inverted_range");
    expect(
      await reasonOf(create(owner, { start: "2026-11-25T10:00:00Z", end: "2026-11-25T10:00:00Z" })),
    ).toBe("inverted_range");
    expect(
      await reasonOf(create(owner, { allDay: true, start: "2026-11-26", end: "2026-11-25" })),
    ).toBe("inverted_range");
  });

  it("rejects malformed zones, unknown zones, and oversized free text", async () => {
    const owner = await makeUser();
    expect(await reasonOf(create(owner, { status: "maybe" }))).toBe("invalid_status");
    expect(await reasonOf(create(owner, { color: "red" }))).toBe("invalid_color");
    expect(await reasonOf(create(owner, { color: "#ff0000" }))).toBe(null);
    expect(
      await reasonOf(create(owner, { category: "c".repeat(MAX_EVENT_CATEGORY_LENGTH + 1) })),
    ).toBe("category_too_long");
    expect(
      await reasonOf(create(owner, { description: "d".repeat(MAX_EVENT_DESCRIPTION_LENGTH + 1) })),
    ).toBe("description_too_long");
    expect(
      await reasonOf(create(owner, { location: "l".repeat(MAX_EVENT_LOCATION_LENGTH + 1) })),
    ).toBe("location_too_long");
  });

  it("accepts only IANA zone ids that Intl can resolve", async () => {
    const owner = await makeUser();
    expect(await reasonOf(create(owner, { timezone: "Europe/Jerusalem" }))).toBe(
      "invalid_timezone",
    );
    expect(await reasonOf(create(owner, { timezone: "Foo/Bar" }))).toBe("invalid_timezone");
    expect(await reasonOf(create(owner, { timezone: "z".repeat(65) }))).toBe("invalid_timezone");
    expect(await reasonOf(create(owner, { timezone: "Asia/Jerusalem" }))).toBe(null);
  });

  it("refuses a non-boolean all-day flag", async () => {
    const owner = await makeUser();
    expect(await reasonOf(create(owner, { allDay: "true" }))).toBe("invalid_all_day");
  });
});

describe("event normalization and round-trip", () => {
  beforeAll(() => resetTestDatabase("events-unit"));
  afterAll(() => closeDatabase());

  it("stores both endpoints as UTC text and reads back exactly that text", async () => {
    const owner = await makeUser();
    const created = await create(owner, {
      start: "2026-11-25T09:00:00+02:00",
      end: "2026-11-25T10:30+02:00",
    });
    expect(created.startAt).toBe("2026-11-25T07:00:00.000Z");
    expect(created.endAt).toBe("2026-11-25T08:30:00.000Z");

    const read = await readEvent(actorFor(owner, "user"), created.id);
    expect(read.startAt).toBe(created.startAt);
    expect(read.endAt).toBe(created.endAt);

    const [raw] = await getDb()
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.id, created.id))
      .limit(1);
    expect(raw?.startAt).toBe("2026-11-25T07:00:00.000Z");
  });

  it("defaults the zone to the owner's stored preference, not to a fixed zone", async () => {
    const owner = await makeUser();
    const plain = await create(owner);
    expect(plain.timezone).toBe(readPreferences(owner).timezone);
    const zoned = await create(owner, { timezone: "Asia/Jerusalem" });
    expect(zoned.timezone).toBe("Asia/Jerusalem");
    expect(zoned.startAt).toBe(plain.startAt);
  });

  it("normalizes an all-day event onto calendar-day boundaries", async () => {
    const owner = await makeUser();
    const single = await create(owner, { allDay: true, start: "2026-11-25", end: "2026-11-25" });
    expect(single.isAllDay).toBe(true);
    expect(single.startAt).toBe("2026-11-25T00:00:00.000Z");
    expect(single.endAt).toBe("2026-11-26T00:00:00.000Z");

    // The end date is exclusive, so a two-day event spans 25 → 27; repeating one
    // day is what makes a single-day event non-empty.
    const span = await create(owner, { allDay: true, start: "2026-11-25", end: "2026-11-27" });
    expect(span.endAt).toBe("2026-11-27T00:00:00.000Z");

    // An all-day event takes calendar dates only; a timed instant is refused
    // rather than silently truncated to a day.
    expect(await reasonOf(create(owner, { allDay: true, start: "2026-11-25T21:00:00Z" }))).toBe(
      "invalid_all_day",
    );

    const timed = await create(owner);
    expect(timed.isAllDay).toBe(false);
    expect(timed.startAt).toBe("2026-11-25T09:00:00.000Z");
  });

  it("re-validates a patched range and refuses a stale updatedAt token", async () => {
    const owner = await makeUser();
    const event = await create(owner);

    const patched = await updateEvent(actorFor(owner, "user"), {
      actor: actorFor(owner, "user"),
      eventId: event.id,
      expectedUpdatedAt: event.updatedAt,
      status: "confirmed",
      color: "#00ff00",
    });
    expect(patched.status).toBe("confirmed");
    expect(patched.updatedAt).not.toBe(event.updatedAt);

    const stale = updateEvent(actorFor(owner, "user"), {
      actor: actorFor(owner, "user"),
      eventId: event.id,
      expectedUpdatedAt: event.updatedAt,
      title: "Second tab wins",
    });
    expect(await reasonOf(stale)).toBe("version_conflict");

    // Only the start is patched, so the existing end still has to stay after it.
    expect(
      await reasonOf(
        updateEvent(actorFor(owner, "user"), {
          actor: actorFor(owner, "user"),
          eventId: event.id,
          expectedUpdatedAt: patched.updatedAt,
          start: "2026-11-26T10:00:00Z",
        }),
      ),
    ).toBe("inverted_range");
    expect(
      await reasonOf(
        updateEvent(actorFor(owner, "user"), {
          actor: actorFor(owner, "user"),
          eventId: event.id,
          expectedUpdatedAt: "2026-11-25T09:00",
        }),
      ),
    ).toBe("invalid_instant");
  });

  it("enforces the schema CHECKs even when a row bypasses the service", async () => {
    const owner = await makeUser();
    const insert = async (values: Record<string, unknown>) => {
      try {
        await getDb()
          .insert(eventsTable)
          .values(values as never);
        return null;
      } catch (error) {
        return (error as Error).message;
      }
    };
    const base = {
      ownerUserId: owner,
      title: "Raw row",
      timezone: "UTC",
      status: "confirmed",
      isAllDay: false,
      createdAt: EPOCH,
      updatedAt: EPOCH,
    };

    expect(
      await insert({
        ...base,
        id: randomUUID(),
        startAt: "2026-11-25T10:00:00.000Z",
        endAt: "2026-11-25T09:00:00.000Z",
      }),
    ).toContain("events_time_chk");
    expect(
      await insert({
        ...base,
        id: randomUUID(),
        startAt: "2026-11-25T09:00:00",
        endAt: "2026-11-25T10:00:00.000Z",
      }),
    ).toContain("events_start_utc_chk");
    expect(
      await insert({
        ...base,
        id: randomUUID(),
        status: "maybe",
        startAt: "2026-11-25T09:00:00.000Z",
        endAt: "2026-11-25T10:00:00.000Z",
      }),
    ).toContain("events_status_chk");
    expect(
      await insert({
        ...base,
        id: randomUUID(),
        color: "red",
        startAt: "2026-11-25T09:00:00.000Z",
        endAt: "2026-11-25T10:00:00.000Z",
      }),
    ).toContain("events_color_chk");
    expect(
      await insert({
        ...base,
        id: randomUUID(),
        isAllDay: true,
        startAt: "2026-11-25T09:00:00.000Z",
        endAt: "2026-11-26T00:00:00.000Z",
      }),
    ).toContain("events_all_day_bounds_chk");
  });
});

describe("keyset pagination over a bounded window", () => {
  beforeAll(() => resetTestDatabase("events-unit"));
  afterAll(() => closeDatabase());

  it("walks every event exactly once, ordered by (start_at, id)", async () => {
    const owner = await makeUser();
    const actor = actorFor(owner, "user");
    const created: EventRecord[] = [];
    for (let i = 0; i < 5; i += 1) {
      created.push(
        await create(owner, {
          title: `Event ${i}`,
          start: `2026-11-25T0${i}:00:00Z`,
          end: `2026-11-25T0${i}:30:00Z`,
        }),
      );
    }
    // Two events that start in the same second: the id is the tiebreaker.
    const tied = await Promise.all([
      create(owner, { title: "Tie A", start: "2026-11-25T09:00:00Z", end: "2026-11-25T09:30:00Z" }),
      create(owner, { title: "Tie B", start: "2026-11-25T09:00:00Z", end: "2026-11-25T09:30:00Z" }),
    ]);

    const window = { from: "2026-11-24T00:00:00.000Z", to: "2026-11-26T00:00:00.000Z" };
    const seen: { startAt: string; id: string }[] = [];
    let cursor: { startAt: string; id: string } | null = null;
    for (let page = 0; page < 10; page += 1) {
      const result = await listEvents(actor, { window, limit: 2, cursor });
      for (const item of result.items) seen.push({ startAt: item.startAt, id: item.id });
      cursor = result.nextCursor;
      if (cursor === null) break;
    }

    const expected = [...created, ...tied]
      .map((event) => ({ startAt: event.startAt, id: event.id }))
      .sort((a, b) =>
        a.startAt < b.startAt ? -1 : a.startAt > b.startAt ? 1 : a.id < b.id ? -1 : 1,
      );
    expect(seen).toEqual(expected);
    expect(seen.length).toBe(7);
  });

  it("refuses an unbounded or oversized window and a malformed cursor", async () => {
    const owner = await makeUser();
    const actor = actorFor(owner, "user");
    await create(owner);
    expect(
      await reasonOf(listEvents(actor, { window: {} as { from: unknown; to: unknown }, limit: 2 })),
    ).toBe("invalid_instant");
    expect(
      await reasonOf(
        listEvents(actor, {
          window: { from: "2026-01-01T00:00:00.000Z", to: "2027-03-01T00:00:00.000Z" },
          limit: 2,
        }),
      ),
    ).toBe("window_too_large");
    expect(
      await reasonOf(
        listEvents(actor, {
          window: { from: "2026-11-24T00:00:00.000Z", to: "2026-11-26T00:00:00.000Z" },
          limit: 2,
          cursor: { startAt: "2026-11-25T09:00", id: randomUUID() },
        }),
      ),
    ).toBe("invalid_window");
    expect(
      await reasonOf(
        listEvents(actor, {
          window: { from: "2026-11-24T00:00:00.000Z", to: "2026-11-26T00:00:00.000Z" },
          status: "maybe",
        }),
      ),
    ).toBe("invalid_status");
    expect(clampPageSize(10_000)).toBe(MAX_PAGE_SIZE);
    expect(clampPageSize(0)).toBe(50);
    expect(parseQueryWindow({ from: "2026-11-24T00:00:00Z", to: "2026-11-26T00:00:00Z" })).toEqual({
      from: "2026-11-24T00:00:00.000Z",
      to: "2026-11-26T00:00:00.000Z",
    });
  });
});

describe("participants", () => {
  beforeAll(() => resetTestDatabase("events-unit"));
  afterAll(() => closeDatabase());

  it("invites another account, lets it read the event, and lets it leave", async () => {
    const owner = await makeUser();
    const invitee = await makeUser();
    const event = await create(owner);

    const participant = await addParticipant(actorFor(owner, "user"), {
      actor: actorFor(owner, "user"),
      eventId: event.id,
      userId: invitee,
    });
    expect(participant.userId).toBe(invitee);

    const attended = await listEventsAttendedBy(actorFor(invitee, "user"), {
      window: { from: "2026-11-24T00:00:00.000Z", to: "2026-11-26T00:00:00.000Z" },
    });
    expect(attended.items.map((item) => item.id)).toEqual([event.id]);

    await removeParticipant(actorFor(owner, "user"), {
      actor: actorFor(owner, "user"),
      eventId: event.id,
      userId: invitee,
    });
    const after = await listEventsAttendedBy(actorFor(invitee, "user"), {
      window: { from: "2026-11-24T00:00:00.000Z", to: "2026-11-26T00:00:00.000Z" },
    });
    expect(after.items).toEqual([]);
  });

  it("refuses the owner, a duplicate invitation, and an unknown invitee", async () => {
    const owner = await makeUser();
    const invitee = await makeUser();
    const event = await create(owner);
    const actor = actorFor(owner, "user");

    expect(await reasonOf(addParticipant(actor, { actor, eventId: event.id, userId: owner }))).toBe(
      "participant_is_owner",
    );
    await addParticipant(actor, { actor, eventId: event.id, userId: invitee });
    expect(
      await reasonOf(addParticipant(actor, { actor, eventId: event.id, userId: invitee })),
    ).toBe("duplicate_participant");
    expect(
      await reasonOf(addParticipant(actor, { actor, eventId: event.id, userId: randomUUID() })),
    ).toBe("invalid_participant");
    expect(
      await reasonOf(removeParticipant(actor, { actor, eventId: event.id, userId: randomUUID() })),
    ).toBe("not_found");
  });
});
