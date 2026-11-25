import { expect, test } from "@playwright/test";

import {
  OBSERVER_EMAIL,
  OBSERVER_PASSWORD,
  READER_EMAIL,
  READER_PASSWORD,
  signIn,
} from "./helpers";

/**
 * Packet 2C HTTP surface for `/api/v1/events*`.
 *
 * The service-level rules (visibility union, owner reassignment, duplicate
 * semantics) are proven in `tests/integration/eventsService.test.ts`; the wire
 * schema and error mapping are proven in `tests/integration/eventsApi.test.ts`.
 * What is asserted here is what only a real request can show: the 401 / 403 / 409
 * matrix per method, that a body or query string is refused before any row is
 * touched, and that the response carries a machine code rather than a message.
 */

// Inside MAX_QUERY_WINDOW_DAYS (366), and far from the present so a row created
// by another spec cannot land in it.
const WINDOW = "from=2026-01-01T00:00:00.000Z&to=2026-12-01T00:00:00.000Z";
// A category no packet ever writes, so a read filtered by it is provably empty
// regardless of what other specs have inserted into this shared database.
const EMPTY_CATEGORY = "e2e-no-rows";

async function jsonOf(response: {
  json: () => Promise<unknown>;
}): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

test("an unauthenticated visitor gets 401 on every events endpoint", async ({ page }) => {
  await page.goto("/");
  const origin = new URL(page.url()).origin;

  const reads = [
    `/api/v1/events?${WINDOW}`,
    `/api/v1/events/search?q=draft&${WINDOW}`,
    `/api/v1/events/attending?${WINDOW}`,
    "/api/v1/events/00000000-0000-0000-0000-000000000000",
  ];
  for (const path of reads) {
    const response = await page.request.get(path);
    expect(response.status(), path).toBe(401);
    expect(await jsonOf(response), path).toEqual({ error: "no_session" });
  }

  const writes: readonly [string, "POST" | "PATCH" | "DELETE", string][] = [
    [
      "/api/v1/events",
      "POST",
      JSON.stringify({ title: "Unauth", start: "2026-03-01T09:00:00.000Z" }),
    ],
    [
      "/api/v1/events/00000000-0000-0000-0000-000000000000",
      "PATCH",
      JSON.stringify({ title: "Unauth" }),
    ],
    ["/api/v1/events/00000000-0000-0000-0000-000000000000", "DELETE", ""],
  ];
  for (const [path, method, data] of writes) {
    const response = await page.request.fetch(path, {
      method,
      headers: { origin },
      data,
    });
    expect(response.status(), `${method} ${path}`).toBe(401);
    expect(await jsonOf(response), `${method} ${path}`).toEqual({ error: "no_session" });
  }
});

test("a read_only session sees the shared view but holds no write surface", async ({ page }) => {
  await signIn(page, READER_EMAIL, READER_PASSWORD);
  await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\/$/);

  // `calendar.view.shared` is enough for a window read, so this is a 200 over an
  // empty set rather than a 403: the permission exists, the rows do not.
  const list = await page.request.get(`/api/v1/events?${WINDOW}&category=${EMPTY_CATEGORY}`);
  expect(list.status(), JSON.stringify(await jsonOf(list))).toBe(200);
  expect(((await list.json()) as { data: { items: unknown[] } }).data.items).toEqual([]);

  const create = await page.request.post("/api/v1/events", {
    data: {
      title: "Reader should not create",
      start: "2026-03-01T09:00:00.000Z",
      end: "2026-03-01T10:00:00.000Z",
    },
  });
  expect(create.status()).toBe(403);
  expect(await jsonOf(create)).toEqual({ error: "missing_permission" });

  const search = await page.request.get(
    `/api/v1/events/search?q=reader&${WINDOW}&category=${EMPTY_CATEGORY}`,
  );
  expect(search.status()).toBe(200);
  expect(((await search.json()) as { data: { items: unknown[] } }).data.items).toEqual([]);

  const attending = await page.request.get(
    `/api/v1/events/attending?${WINDOW}&category=${EMPTY_CATEGORY}`,
  );
  expect(attending.status()).toBe(200);
  expect(((await attending.json()) as { data: { items: unknown[] } }).data.items).toEqual([]);
});

test("an ordinary session creates, edits, duplicates and deletes through the wire", async ({
  page,
}, testInfo) => {
  // Both Playwright projects share one bootstrapped database, so the marker
  // category is namespaced by project to keep row counts independent.
  const wireCategory = `e2e-wire-${testInfo.project.name}`;
  await signIn(page, OBSERVER_EMAIL, OBSERVER_PASSWORD);
  await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\/$/);

  const created = await page.request.post("/api/v1/events", {
    data: {
      title: "Wire round trip",
      start: "2026-03-02T09:00:00.000Z",
      end: "2026-03-02T11:00:00.000Z",
      category: wireCategory,
      status: "tentative",
    },
  });
  expect(created.status(), JSON.stringify(await jsonOf(created))).toBe(201);
  const event = (await created.json()) as {
    data: { id: string; title: string; category: string; status: string; updatedAt: string };
  };
  expect(event.data).toMatchObject({
    title: "Wire round trip",
    category: wireCategory,
    status: "tentative",
  });
  const id = event.data.id;
  const token = event.data.updatedAt;

  const listed = await page.request.get(`/api/v1/events?${WINDOW}&category=${wireCategory}`);
  expect(listed.status()).toBe(200);
  const listedRows = ((await listed.json()) as { data: { items: { id: string }[] } }).data.items;
  expect(listedRows.map((row) => row.id)).toContain(id);

  const stale = await page.request.patch(`/api/v1/events/${id}`, {
    data: { expectedUpdatedAt: "2026-01-01T00:00:00.000Z", title: "Should not apply" },
  });
  expect(stale.status()).toBe(409);
  expect(await jsonOf(stale)).toEqual({ error: "version_conflict" });

  const patched = await page.request.patch(`/api/v1/events/${id}`, {
    data: { expectedUpdatedAt: token, title: "Wire round trip, renamed", status: "confirmed" },
  });
  expect(patched.status()).toBe(200);
  const renamed = (await patched.json()) as {
    data: { title: string; status: string; endAt: string; updatedAt: string };
  };
  expect(renamed.data).toMatchObject({ title: "Wire round trip, renamed", status: "confirmed" });
  expect(renamed.data.endAt).toBe("2026-03-02T11:00:00.000Z");

  const copy = await page.request.post(`/api/v1/events/${id}`, { data: {} });
  expect(copy.status()).toBe(201);
  const copyId = ((await copy.json()) as { data: { id: string } }).data.id;
  expect(copyId).not.toBe(id);

  const removed = await page.request.fetch(`/api/v1/events/${copyId}`, {
    method: "DELETE",
    data: `expectedUpdatedAt=${encodeURIComponent(renamed.data.updatedAt)}`,
    headers: { "content-type": "application/x-www-form-urlencoded" },
  });
  expect(removed.status()).toBe(200);

  const gone = await page.request.get(`/api/v1/events/${copyId}`);
  expect(gone.status()).toBe(404);
  expect(await jsonOf(gone)).toEqual({ error: "not_found" });
});

test("a malformed request never reaches the service", async ({ page }, testInfo) => {
  const wireCategory = `e2e-wire-${testInfo.project.name}`;
  await signIn(page, OBSERVER_EMAIL, OBSERVER_PASSWORD);
  await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\/$/);

  const crossOrigin = await page.request.post("/api/v1/events", {
    headers: { origin: "https://evil.example" },
    data: { title: "CSRF", start: "2026-03-03T09:00:00.000Z" },
  });
  expect(crossOrigin.status()).toBe(403);
  expect(await jsonOf(crossOrigin)).toEqual({ error: "invalid_origin" });

  const notJson = await page.request.post("/api/v1/events", {
    data: "title=not-json",
    headers: { "content-type": "text/plain" },
  });
  expect(notJson.status(), JSON.stringify(await jsonOf(notJson))).toBe(400);
  expect(await jsonOf(notJson)).toEqual({ error: "invalid_json" });

  const unknownKey = await page.request.post("/api/v1/events", {
    data: { title: "Smuggled", start: "2026-03-03T09:00:00.000Z", recurrence: "daily" },
  });
  expect(unknownKey.status()).toBe(400);
  expect(await jsonOf(unknownKey)).toEqual({ error: "invalid_input" });

  // Nothing was created by any of these: the window is mandatory, the limit
  // must be digits, search needs a phrase, `/attending` refuses an `attendee`
  // filter rather than ignoring it, and half a cursor is refused rather than
  // silently paging from the start.
  for (const [path, code] of [
    ["/api/v1/events", "invalid_input"],
    [`/api/v1/events?${WINDOW}&limit=5O`, "invalid_input"],
    [`/api/v1/events/search?${WINDOW}`, "invalid_input"],
    [`/api/v1/events/attending?${WINDOW}&attendee=anyone`, "attendee_not_allowed"],
    [`/api/v1/events?${WINDOW}&cursorStartAt=2026-03-01T00:00:00.000Z`, "invalid_window"],
  ] as const) {
    const response = await page.request.get(path);
    expect(response.status(), path).toBe(400);
    expect(await jsonOf(response), path).toEqual({ error: code });
  }

  const after = await page.request.get(`/api/v1/events?${WINDOW}&category=${wireCategory}`);
  expect(((await after.json()) as { data: { items: { id: string }[] } }).data.items).toHaveLength(
    1,
  );

  const missingToken = await page.request.fetch(
    "/api/v1/events/00000000-0000-0000-0000-000000000000",
    {
      method: "DELETE",
    },
  );
  expect(missingToken.status()).toBe(404);
  expect(await jsonOf(missingToken)).toEqual({ error: "not_found" });
});
