import { expect, test } from "@playwright/test";

import { OBSERVER_EMAIL, OBSERVER_PASSWORD, signIn } from "./helpers";

test("the API description is public while identity resources require a session", async ({
  request,
}) => {
  const description = await request.get("/api/v1/openapi.json");
  expect(description.status()).toBe(200);
  const document = (await description.json()) as {
    openapi?: string;
    paths?: Record<string, unknown>;
  };
  expect(document.openapi).toBe("3.1.0");
  expect(Object.keys(document.paths ?? {})).toEqual(
    expect.arrayContaining(["/health", "/profile", "/users", "/roles", "/admin/status"]),
  );

  for (const path of [
    "/api/v1/profile",
    "/api/v1/users",
    "/api/v1/roles",
    "/api/v1/admin/status",
  ]) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(401);
    expect(await response.json(), path).toEqual({ error: "no_session" });
  }
});

test("an ordinary session can read its profile and role matrix but not administration data", async ({
  page,
}) => {
  await signIn(page, OBSERVER_EMAIL, OBSERVER_PASSWORD);
  await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\/$/);

  const profile = await page.request.get("/api/v1/profile");
  expect(profile.status()).toBe(200);
  expect(((await profile.json()) as { data: { email: string } }).data.email).toBe(OBSERVER_EMAIL);

  const roles = await page.request.get("/api/v1/roles");
  expect(roles.status()).toBe(200);
  expect(((await roles.json()) as { data: unknown[] }).data).toHaveLength(4);

  for (const path of ["/api/v1/users", "/api/v1/admin/status"]) {
    const response = await page.request.get(path);
    expect(response.status(), path).toBe(403);
    expect(await response.json(), path).toEqual({ error: "missing_permission" });
  }
});

test("profile mutations validate origin and JSON before applying a same-origin update", async ({
  page,
}) => {
  await signIn(page, OBSERVER_EMAIL, OBSERVER_PASSWORD);
  await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\/$/);

  const hostile = await page.request.patch("/api/v1/profile", {
    headers: { origin: "https://example.invalid" },
    data: { name: "Should Not Apply" },
  });
  expect(hostile.status()).toBe(403);
  expect(await hostile.json()).toEqual({ error: "invalid_origin" });

  const invalid = await page.evaluate(async () => {
    const response = await fetch("/api/v1/profile", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ unexpected: true }),
    });
    return { status: response.status, body: await response.json() };
  });
  expect(invalid).toEqual({ status: 400, body: { error: "invalid_input" } });

  const name = `E2E Observer ${Date.now().toString(36)}`;
  const updated = await page.evaluate(async (nextName) => {
    const response = await fetch("/api/v1/profile", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: nextName }),
    });
    return { status: response.status, body: await response.json() };
  }, name);
  expect(updated.status).toBe(200);

  const profile = await page.request.get("/api/v1/profile");
  expect(((await profile.json()) as { data: { name: string } }).data.name).toBe(name);
});
