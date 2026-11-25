import { expect, test } from "@playwright/test";

import {
  OBSERVER_EMAIL,
  OBSERVER_PASSWORD,
  READER_EMAIL,
  READER_PASSWORD,
  signIn,
} from "./helpers";

/**
 * Packet 2D HTTP surface for `GET /api/v1/events/agenda`.
 *
 * The set algebra is proven in `tests/integration/eventsAgenda.test.ts` and the
 * query-string schema in `tests/integration/eventsApi.test.ts`. What only a real
 * request can show: that the endpoint answers at all, that it answers with the
 * caller's own calendar rather than the shared one, and that the window it
 * invents when the caller sends none is bounded.
 */

const DAY = 86_400_000;

async function jsonOf(response: {
  json: () => Promise<unknown>;
}): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

async function agendaRows(page: {
  request: {
    get: (url: string) => Promise<{ status: () => number; json: () => Promise<unknown> }>;
  };
}): Promise<{ id: string; title: string; startAt: string }[]> {
  const response = await page.request.get("/api/v1/events/agenda");
  expect(response.status(), JSON.stringify(await jsonOf(response))).toBe(200);
  return (
    (await response.json()) as { data: { items: { id: string; title: string; startAt: string }[] } }
  ).data.items;
}

test("an unauthenticated visitor gets 401 on the agenda read", async ({ page }) => {
  await page.goto("/");
  const response = await page.request.get("/api/v1/events/agenda");
  expect(response.status()).toBe(401);
  expect(await jsonOf(response)).toEqual({ error: "no_session" });
});

test("the agenda answers around now, in start order, and stops at its horizon", async ({
  page,
}, testInfo) => {
  // Titles and category are namespaced per project: both projects run against one
  // shared database, and the agenda takes no filter, so only the prefix keeps
  // these assertions independent of what other specs have written.
  const prefix = `Agenda ${testInfo.project.name}`;
  const category = `e2e-agenda-${testInfo.project.name}`;

  await signIn(page, OBSERVER_EMAIL, OBSERVER_PASSWORD);
  await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\/$/);

  const now = Date.now();
  const offsets = [1, 2, 30, 40];
  const created: { id: string; day: number }[] = [];
  for (const day of offsets) {
    const start = new Date(now + day * DAY).toISOString();
    const response = await page.request.post("/api/v1/events", {
      data: {
        title: `${prefix} day ${day}`,
        start,
        end: new Date(now + day * DAY + 2 * 3_600_000).toISOString(),
        category,
        status: "tentative",
      },
    });
    expect(response.status(), JSON.stringify(await jsonOf(response))).toBe(201);
    created.push({ id: ((await response.json()) as { data: { id: string } }).data.id, day });
  }

  const rows = (await agendaRows(page)).filter((row) => row.title.startsWith(prefix));
  const byDay = new Map(created.map((row) => [row.day, row.id]));
  const starts = rows.map((row) => row.startAt);

  // Inside the default horizon: days 1, 2 and 30. Day 40 is beyond it.
  expect(rows.map((row) => row.id).sort()).toEqual(
    [byDay.get(1), byDay.get(2), byDay.get(30)].sort(),
  );
  expect(starts).toEqual([...starts].sort());
  expect(rows.map((row) => row.title)).toEqual([
    `${prefix} day 1`,
    `${prefix} day 2`,
    `${prefix} day 30`,
  ]);

  // A caller's own window narrows it; the horizon is not a floor on that window.
  const narrow = await page.request.get(
    `/api/v1/events/agenda?from=${encodeURIComponent(new Date(now + 1.5 * DAY).toISOString())}` +
      `&to=${encodeURIComponent(new Date(now + 2.5 * DAY).toISOString())}`,
  );
  expect(narrow.status()).toBe(200);
  const narrowRows = ((await narrow.json()) as { data: { items: { title: string }[] } }).data.items;
  expect(narrowRows.filter((row) => row.title.startsWith(prefix)).map((row) => row.title)).toEqual([
    `${prefix} day 2`,
  ]);

  // The same rows are reachable by the shared read over a window wide enough to
  // hold them, so the agenda's shape - not its data - is what differs.
  const shared = await page.request.get(
    `/api/v1/events?from=${encodeURIComponent(new Date(now + 0.5 * DAY).toISOString())}` +
      `&to=${encodeURIComponent(new Date(now + 45 * DAY).toISOString())}` +
      `&category=${encodeURIComponent(category)}`,
  );
  expect(shared.status()).toBe(200);
  const sharedRows = ((await shared.json()) as { data: { items: { title: string }[] } }).data.items;
  expect(sharedRows.map((row) => row.title).sort()).toEqual(
    offsets.map((day) => `${prefix} day ${day}`).sort(),
  );
});

test("the agenda refuses every filter the shared read accepts", async ({ page }) => {
  await signIn(page, OBSERVER_EMAIL, OBSERVER_PASSWORD);
  await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\/$/);

  const cases: readonly [string, string][] = [
    ["?status=confirmed", "invalid_input"],
    ["?category=work", "invalid_input"],
    ["?attendee=me", "invalid_input"],
    ["?limit=5O", "invalid_input"],
    ["?cursorStartAt=2026-12-02T00%3A00%3A00.000Z", "invalid_window"],
    ["?from=2026-12-08T00%3A00%3A00.000Z&to=2026-12-01T00%3A00%3A00.000Z", "invalid_window"],
    ["?from=2026-12-01T00%3A00%3A00.000Z&to=2026-12-01T00%3A00%3A00.000Z", "invalid_window"],
  ];
  for (const [query, code] of cases) {
    const response = await page.request.get(`/api/v1/events/agenda${query}`);
    expect(response.status(), query).toBe(400);
    expect(await jsonOf(response), query).toEqual({ error: code });
  }

  // A page size is the one parameter the agenda does accept, and the cursor it
  // hands back is a (startAt, id) pair that the next call must carry whole.
  const paged = await page.request.get("/api/v1/events/agenda?limit=2");
  expect(paged.status()).toBe(200);
  const page1 = (await jsonOf(paged)) as {
    data: { items: { id: string }[]; nextCursor: { startAt: string; id: string } | null };
  };
  expect(page1.data.items).toHaveLength(2);
  expect(page1.data.nextCursor).not.toBeNull();

  const cursor = page1.data.nextCursor!;
  const follow = await page.request.get(
    `/api/v1/events/agenda?limit=2` +
      `&cursorStartAt=${encodeURIComponent(cursor.startAt)}` +
      `&cursorId=${encodeURIComponent(cursor.id)}`,
  );
  expect(follow.status()).toBe(200);
  const page2 = (await jsonOf(follow)) as { data: { items: { id: string }[] } };
  const firstIds = page1.data.items.map((row) => row.id);
  const secondIds = page2.data.items.map((row) => row.id);
  expect(secondIds.every((id) => !firstIds.includes(id))).toBe(true);
});

test("a read_only session may take the agenda, and sees no other account's rows", async ({
  page,
}, testInfo) => {
  const prefix = `Agenda ${testInfo.project.name}`;

  await signIn(page, READER_EMAIL, READER_PASSWORD);
  await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\/$/);

  const rows = await agendaRows(page);
  expect(rows.filter((row) => row.title.startsWith(prefix))).toEqual([]);

  // A 200 over an empty set, not a 403: the grant exists, the rows do not. This
  // account holds `calendar.view.shared` (events it is a participant in) and
  // attends none of the rows the observer wrote, so the agenda cannot leak them.
  const shared = await page.request.get(
    `/api/v1/events?from=${encodeURIComponent(new Date(Date.now() - DAY).toISOString())}` +
      `&to=${encodeURIComponent(new Date(Date.now() + 45 * DAY).toISOString())}`,
  );
  expect(shared.status()).toBe(200);
  const sharedRows = ((await shared.json()) as { data: { items: { title: string }[] } }).data.items;
  expect(sharedRows.filter((row) => row.title.startsWith(prefix))).toEqual([]);
});
