import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ApiInputError, apiErrorResponse } from "@/lib/api";
import { closeDatabase } from "@/db/client";
import { ProductivityError } from "@/lib/productivity";
import { createFirstAdmin } from "@/lib/adminBootstrap";
import { type Actor, AuthorizationError } from "@/lib/rbac";
import { createEvent, listEvents, readEvent, updateEvent } from "@/lib/events";
import {
  AGENDA_HORIZON_DAYS,
  agendaParams,
  createEventBody,
  duplicateEventBody,
  eventListParams,
  eventSearchParams,
  parseQuery,
  toAgendaQuery,
  toEventQuery,
  updateEventBody,
} from "@/lib/eventsApi";
import { resetTestDatabase } from "../helpers/testDb";

/**
 * Packet 2C wire half: what `/api/v1/events` accepts before a query runs.
 *
 * The route layer cannot be driven from here — `next/headers` refuses to resolve
 * a session outside a request scope — so the HTTP surface (401/403/409 per method)
 * is covered in `tests/e2e/events.spec.ts`. What is tested here is the layer the
 * routes are built from: the body and query-string schemas, the translation into
 * the service's filter vocabulary, and the error mapping those routes share.
 */

const PASSWORD = "Events-Api-Password-2026!";
const BASE = "http://127.0.0.1:4000/api/v1/events";

let hostId = "";
let hostActor = null as unknown as Actor;

async function reasonOf(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    expect(error, String(error)).toBeInstanceOf(ProductivityError);
    return (error as ProductivityError).reason;
  }
}

beforeAll(async () => {
  resetTestDatabase("events-api");
  const owner = await createFirstAdmin({
    name: "Wire Owner",
    email: "wire-owner@example.internal",
    password: PASSWORD,
    role: "user",
  });
  hostActor = {
    userId: owner.id,
    role: owner.role,
    twoFactorEnabled: true,
    sessionFresh: true,
  };
});

afterAll(() => closeDatabase());

describe("request bodies", () => {
  it("accepts a minimal create and leaves the grammar to the service", async () => {
    const body = createEventBody.parse({ title: "Drafting", start: "2026-12-01T09:00:00.000Z" });
    expect(body).toEqual({ title: "Drafting", start: "2026-12-01T09:00:00.000Z" });

    // 350 characters is a well-formed string but past MAX_EVENT_TITLE_LENGTH:
    // the wire says nothing, the service answers with its own reason code.
    const longTitle = "x".repeat(350);
    expect(
      createEventBody.safeParse({ title: longTitle, start: "2026-12-01T09:00:00.000Z" }).success,
    ).toBe(true);
    expect(
      await reasonOf(
        createEvent(hostActor, {
          actor: hostActor,
          title: longTitle,
          start: "2026-12-01T09:00:00.000Z",
          end: "2026-12-01T10:00:00.000Z",
        }),
      ),
    ).toBe("title_too_long");

    // `end` is not optional to the service even though the wire schema allows it
    // to be absent: a timed event without an end is an invalid instant, not a
    // default one-hour event.
    expect(
      await reasonOf(
        createEvent(hostActor, {
          actor: hostActor,
          title: "No end",
          start: "2026-12-01T09:00:00.000Z",
          end: undefined,
        }),
      ),
    ).toBe("invalid_instant");
  });

  it("refuses unknown keys and statuses outside the shared vocabulary", () => {
    for (const body of [
      { title: "A", start: "2026-12-01T09:00:00.000Z", recurrence: "daily" },
      { title: "A", start: "2026-12-01T09:00:00.000Z", status: "archived" },
      { start: "2026-12-01T09:00:00.000Z" },
    ]) {
      expect(createEventBody.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
  });

  it("requires a concurrency token and at least one change on PATCH", () => {
    expect(updateEventBody.safeParse({}).success).toBe(false);
    expect(
      updateEventBody.safeParse({ expectedUpdatedAt: "2026-12-01T09:00:00.000Z" }).success,
    ).toBe(false);
    expect(
      updateEventBody.parse({
        expectedUpdatedAt: "2026-12-01T09:00:00.000Z",
        title: "Renamed",
        status: "confirmed",
      }),
    ).toEqual({
      expectedUpdatedAt: "2026-12-01T09:00:00.000Z",
      title: "Renamed",
      status: "confirmed",
    });
  });

  it("takes no fields on duplicate, so a client cannot smuggle a rule", () => {
    expect(duplicateEventBody.safeParse({}).success).toBe(true);
    for (const body of [{ recurrence: "daily" }, { title: "Copy" }]) {
      expect(duplicateEventBody.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
  });
});

describe("query strings", () => {
  it("makes the window mandatory and refuses a parameter it does not know", () => {
    expect(eventListParams.safeParse({}).success).toBe(false);
    expect(eventListParams.safeParse({ from: "2026-12-01T00:00:00.000Z" }).success).toBe(false);
    expect(
      eventListParams.safeParse({
        from: "2026-12-01T00:00:00.000Z",
        to: "2026-12-08T00:00:00.000Z",
        attendee: "someone",
      }).success,
    ).toBe(true);
    for (const extra of [{ owner: "me" }, { q: "draft" }, { limit: "5O" }]) {
      const params = {
        from: "2026-12-01T00:00:00.000Z",
        to: "2026-12-08T00:00:00.000Z",
        ...extra,
      };
      expect(eventListParams.safeParse(params).success, JSON.stringify(extra)).toBe(false);
    }
  });

  it("requires a phrase for search", () => {
    const window = { from: "2026-12-01T00:00:00.000Z", to: "2026-12-08T00:00:00.000Z" };
    expect(eventSearchParams.safeParse(window).success).toBe(false);
    expect(eventSearchParams.safeParse({ ...window, q: "draft" }).success).toBe(true);
  });

  it("keeps the three category states distinct when translating", () => {
    const window = { from: "2026-12-01T00:00:00.000Z", to: "2026-12-08T00:00:00.000Z" };
    expect(toEventQuery({ ...window }).category).toBeUndefined();
    expect(toEventQuery({ ...window, category: "" }).category).toBeNull();
    expect(toEventQuery({ ...window, category: "deep work" }).category).toBe("deep work");
    expect(toEventQuery({ ...window, limit: "5" }).limit).toBe(5);
  });

  it("refuses half a cursor rather than paging from the wrong place", () => {
    const window = { from: "2026-12-01T00:00:00.000Z", to: "2026-12-08T00:00:00.000Z" };
    for (const half of [{ cursorStartAt: "2026-12-02T00:00:00.000Z" }, { cursorId: "abc" }]) {
      expect(() => toEventQuery({ ...window, ...half })).toThrow(ProductivityError);
    }
    expect(
      toEventQuery({ ...window, cursorStartAt: "2026-12-02T00:00:00.000Z", cursorId: "abc" })
        .cursor,
    ).toEqual({
      startAt: "2026-12-02T00:00:00.000Z",
      id: "abc",
    });
    expect(toEventQuery(window).cursor).toBeNull();
  });

  it("parses a real query string and drives the service with it", async () => {
    const created = await createEvent(hostActor, {
      actor: hostActor,
      title: "Ship the wire layer",
      start: "2026-12-02T09:00:00.000Z",
      end: "2026-12-02T11:00:00.000Z",
      category: "release",
      location: "office",
    });
    hostId = created.id;

    const page = await listEvents(
      hostActor,
      toEventQuery(
        parseQuery(
          new Request(
            `${BASE}?from=2026-12-01T00:00:00.000Z&to=2026-12-08T00:00:00.000Z&category=release&limit=3`,
          ),
          eventListParams,
        ),
      ),
    );
    expect(page.items.map((row) => row.id)).toContain(hostId);
    expect(page.items[0]).toMatchObject({ category: "release", location: "office" });
    expect(page.nextCursor).toBeNull();

    const uncategorized = await listEvents(
      hostActor,
      toEventQuery(
        parseQuery(
          new Request(
            `${BASE}?from=2026-12-01T00:00:00.000Z&to=2026-12-08T00:00:00.000Z&category=`,
          ),
          eventListParams,
        ),
      ),
    );
    expect(uncategorized.items.map((row) => row.id)).not.toContain(hostId);

    const second = await createEvent(hostActor, {
      actor: hostActor,
      title: "Second release row",
      start: "2026-12-03T09:00:00.000Z",
      end: "2026-12-03T10:00:00.000Z",
      category: "release",
    });

    const paged = await listEvents(
      hostActor,
      toEventQuery(
        parseQuery(
          new Request(
            `${BASE}?from=2026-12-01T00:00:00.000Z&to=2026-12-08T00:00:00.000Z&category=release&limit=1`,
          ),
          eventListParams,
        ),
      ),
    );
    expect(paged.items.map((row) => row.id)).toEqual([hostId]);
    const cursor = paged.nextCursor;
    if (cursor === null) throw new Error("Expected a cursor after a full page.");
    expect(cursor).toEqual({ startAt: "2026-12-02T09:00:00.000Z", id: hostId });

    const continued = await listEvents(
      hostActor,
      toEventQuery(
        parseQuery(
          new Request(
            `${BASE}?from=2026-12-01T00:00:00.000Z&to=2026-12-08T00:00:00.000Z&category=release&limit=1` +
              `&cursorStartAt=${encodeURIComponent(cursor.startAt)}&cursorId=${cursor.id}`,
          ),
          eventListParams,
        ),
      ),
    );
    expect(continued.items.map((row) => row.id)).toEqual([second.id]);

    const edited = await updateEvent(hostActor, {
      actor: hostActor,
      eventId: hostId,
      expectedUpdatedAt: created.updatedAt,
      title: "Ship the wire layer, take two",
    });
    expect(edited.title).toBe("Ship the wire layer, take two");
    expect(edited.endAt).toBe("2026-12-02T11:00:00.000Z");

    expect(
      await reasonOf(
        updateEvent(hostActor, {
          actor: hostActor,
          eventId: hostId,
          expectedUpdatedAt: created.updatedAt,
          title: "Third attempt",
        }),
      ),
    ).toBe("version_conflict");
    expect((await readEvent(hostActor, hostId)).title).toBe("Ship the wire layer, take two");
  });

  it("turns a malformed query string into a 400 with a machine code", () => {
    const response = apiErrorResponse(
      (() => {
        try {
          parseQuery(new Request(`${BASE}?to=2026-12-08T00:00:00.000Z`), eventListParams);
        } catch (error) {
          return error;
        }
        throw new Error("parseQuery should have thrown");
      })(),
    );
    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("application/json");
  });
});

describe("error mapping", () => {
  it("answers a service reason with its stable code and no message", async () => {
    const conflict = apiErrorResponse(
      new ProductivityError("version_conflict", "row moved under /c/src/mysite"),
    );
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({ error: "version_conflict" });

    expect(
      apiErrorResponse(new ProductivityError("not_authorized", "no calendar grant")).status,
    ).toBe(403);
    expect(apiErrorResponse(new ProductivityError("not_found", "no such row")).status).toBe(404);
    expect(
      apiErrorResponse(new ProductivityError("invalid_instant", "not an instant")).status,
    ).toBe(400);
  });

  it("maps an rbac denial to the grant it lacks rather than a 500", async () => {
    // The 2C services call `authorize` directly — there is no `runAction` wrapper
    // turning rbac's denial into an ActionError — so `AuthorizationError` has to
    // reach the wire on its own. A `read_only` account posting an event gets a
    // 403 naming the missing grant; a session that no longer matches the account
    // gets 401 so the client can re-authenticate.
    const denied = apiErrorResponse(
      new AuthorizationError(
        "missing_permission",
        'Role "read_only" does not hold "calendar.create".',
      ),
    );
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: "missing_permission" });

    expect(
      apiErrorResponse(new AuthorizationError("mfa_required", "privileged role without a factor"))
        .status,
    ).toBe(403);

    const stale = apiErrorResponse(new AuthorizationError("stale_session", "session moved"));
    expect(stale.status).toBe(401);
    expect(await stale.json()).toEqual({ error: "stale_session" });
  });

  it("keeps an unexpected failure opaque", async () => {
    const response = apiErrorResponse(new Error("TypeError at C:/src/mysite/src/lib/events.ts:42"));
    const text = await response.text();
    expect(response.status).toBe(500);
    expect(JSON.parse(text)).toEqual({ error: "internal_error" });
    for (const leak of ["at ", "src/lib", "C:/", "undefined"]) {
      expect(text.toLowerCase()).not.toContain(leak.toLowerCase());
    }
  });

  it("treats a cross-origin write as forbidden, not malformed", async () => {
    const response = apiErrorResponse(new ApiInputError("invalid_origin"));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "invalid_origin" });
  });
});

describe("agenda query strings", () => {
  it("bounds the window itself when the caller sends none", () => {
    const before = Date.now();
    const query = toAgendaQuery({});
    const after = Date.now();
    const from = Date.parse(query.window.from);
    expect(from).toBeGreaterThanOrEqual(before);
    expect(from).toBeLessThanOrEqual(after);
    expect(Date.parse(query.window.to) - from).toBe(AGENDA_HORIZON_DAYS * 86_400_000);
    expect(query.cursor).toBeNull();
    expect(query.limit).toBeUndefined();
  });

  it("keeps a caller's own bounds and page size", () => {
    const query = toAgendaQuery({
      from: "2026-12-01T00:00:00.000Z",
      to: "2026-12-03T00:00:00.000Z",
      limit: "5",
    });
    expect(query.window).toEqual({
      from: "2026-12-01T00:00:00.000Z",
      to: "2026-12-03T00:00:00.000Z",
    });
    expect(query.limit).toBe(5);
  });

  it("accepts none of the filters /api/v1/events accepts", () => {
    for (const extra of [
      { status: "confirmed" },
      { category: "work" },
      { location: "office" },
      { attendee: "someone" },
      { q: "draft" },
      { limit: "5O" },
    ]) {
      expect(agendaParams.safeParse(extra).success, JSON.stringify(extra)).toBe(false);
    }
    expect(agendaParams.safeParse({ limit: "12" }).success).toBe(true);
    expect(agendaParams.safeParse({}).success).toBe(true);
  });

  it("refuses half a cursor, and hands an inverted window to the service", async () => {
    expect(() => toAgendaQuery({ cursorStartAt: "2026-12-02T00:00:00.000Z" })).toThrow(
      ProductivityError,
    );
    expect(() => toAgendaQuery({ cursorId: "abc" })).toThrow(ProductivityError);
    expect(
      toAgendaQuery({
        cursorStartAt: "2026-12-02T00:00:00.000Z",
        cursorId: "abc",
      }).cursor,
    ).toEqual({ startAt: "2026-12-02T00:00:00.000Z", id: "abc" });

    const inverted = toAgendaQuery({
      from: "2026-12-08T00:00:00.000Z",
      to: "2026-12-01T00:00:00.000Z",
    });
    expect(await reasonOf(listEvents(hostActor, inverted))).toBe("invalid_window");
  });

  it("parses an agenda request's query string strictly", () => {
    expect(parseQuery(new Request(`${BASE}/agenda`), agendaParams)).toEqual({});
    expect(parseQuery(new Request(`${BASE}/agenda?limit=3`), agendaParams)).toEqual({
      limit: "3",
    });
    expect(() => parseQuery(new Request(`${BASE}/agenda?status=confirmed`), agendaParams)).toThrow(
      ApiInputError,
    );
  });
});
