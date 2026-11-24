import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { OBSERVER_EMAIL, OBSERVER_PASSWORD, signIn } from "./helpers";

/**
 * Phase 0 gate: the production server must prove it is real.
 * Everything asserted here is measured from the running process, the built app
 * and the migrated database file.
 */

type HealthBody = {
  status: string;
  uptimeSeconds: number;
  app: { nodeEnv: string; node: string; version: string };
  database: {
    ok: boolean;
    file: string;
    journalMode: string;
    foreignKeys: boolean;
    busyTimeoutMs: number;
    synchronous: string;
    tableCount: number;
    migrationsApplied: number;
    sqliteVersion: string;
  };
  worker: { state: string };
  integrations: { smtp: string; onedrive: string };
};

test("JSON health endpoint reports measured production state", async ({ request }) => {
  const response = await request.get("/api/v1/health");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/json");

  const body = (await response.json()) as HealthBody;

  expect(body.status).toBe("ok");
  expect(body.app.nodeEnv).toBe("production");
  expect(body.uptimeSeconds).toBeGreaterThanOrEqual(0);
  expect(body.database.ok).toBe(true);
  expect(body.database.journalMode).toBe("wal");
  expect(body.database.foreignKeys).toBe(true);
  expect(body.database.busyTimeoutMs).toBe(5000);
  expect(body.database.synchronous).toBe("NORMAL");
  expect(body.database.migrationsApplied).toBeGreaterThanOrEqual(1);
  expect(body.database.tableCount).toBeGreaterThanOrEqual(1);
  expect(body.worker.state).toBe("not_installed");
  expect(body.integrations).toEqual({ smtp: "not_configured", onedrive: "not_configured" });
});

test("/health liveness alias returns the same measured report as the versioned endpoint", async ({
  request,
}) => {
  const api = await request.get("/api/v1/health");
  const liveness = await request.get("/health");

  expect(liveness.status()).toBe(api.status());
  expect(liveness.headers()["content-type"]).toContain("application/json");
  expect(((await liveness.json()) as HealthBody).status).toBe(
    ((await api.json()) as HealthBody).status,
  );
});

test("the container healthcheck script reports healthy against the live server", async ({
  baseURL,
}) => {
  // Same script the Dockerfile HEALTHCHECK runs inside the container.
  const output = execFileSync(process.execPath, ["scripts/healthcheck.mjs"], {
    env: { ...process.env, HEALTHCHECK_URL: `${baseURL}/health` },
    encoding: "utf8",
  });
  expect(output.trim()).toBe("");
});

test("the container healthcheck script fails when the URL is not healthy", async ({ baseURL }) => {
  let failed = false;
  try {
    execFileSync(process.execPath, ["scripts/healthcheck.mjs"], {
      env: { ...process.env, HEALTHCHECK_URL: `${baseURL}/definitely-not-here` },
      encoding: "utf8",
      stdio: "pipe",
    });
  } catch (error) {
    failed = true;
    expect((error as { status?: number }).status).toBe(1);
  }
  expect(failed).toBe(true);
});

test("health endpoint leaks no secrets and no absolute host paths", async ({ request }) => {
  const text = await (await request.get("/api/v1/health")).text();
  const lower = text.toLowerCase();

  for (const needle of [
    "session_secret",
    "app_encryption_key",
    "sessionsecret",
    "encryptionkey",
    "e2e-session",
  ]) {
    expect(lower).not.toContain(needle);
  }

  const body = JSON.parse(text) as HealthBody;
  expect(body.database.file.startsWith("./")).toBe(true);
  expect(/^[a-z]:[\\/]/i.test(body.database.file)).toBe(false);
});

test("security headers are applied to pages and API routes", async ({ request }) => {
  for (const path of ["/", "/api/v1/health", "/definitely-not-here"]) {
    const response = await request.get(path);
    const headers = response.headers();

    expect(headers["x-content-type-options"], `${path}: X-Content-Type-Options`).toBe("nosniff");
    expect(headers["x-frame-options"], `${path}: X-Frame-Options`).toBe("DENY");
    expect(headers["referrer-policy"], `${path}: Referrer-Policy`).toBe(
      "strict-origin-when-cross-origin",
    );
    expect(headers["cross-origin-opener-policy"], `${path}: COOP`).toBe("same-origin");
    expect(headers["x-dns-prefetch-control"], `${path}: DNS prefetch`).toBe("off");
    expect(headers["permissions-policy"], `${path}: Permissions-Policy`).toContain(
      "interest-cohort=()",
    );

    const csp = headers["content-security-policy"] ?? "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    // Production must use a per-request nonce, not 'unsafe-inline'.
    expect(csp).toContain("script-src 'self' 'nonce-");
    expect(csp).not.toContain("unsafe-eval");
    expect(headers["x-nonce"], `${path}: X-Nonce must be a per-request value`).toBeTruthy();

    expect(headers["x-powered-by"]).toBeUndefined();
  }
});

test("every request gets its own CSP nonce", async ({ request }) => {
  const first = (await request.get("/")).headers()["x-nonce"] ?? "";
  const second = (await request.get("/")).headers()["x-nonce"] ?? "";
  expect(first.length).toBeGreaterThanOrEqual(16);
  expect(first).not.toBe(second);
});

test("unknown routes return 404 with no stack trace", async ({ request }) => {
  const response = await request.get("/definitely-not-here");
  expect(response.status()).toBe(404);
  const body = await response.text();
  expect(body).not.toContain("at ");
  expect(body).not.toContain("node_modules");
});

test("status page renders measured state on desktop and mobile viewports", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(String(error)));

  // Under Phase 1 the status screen sits behind the login (raw infrastructure facts
  // are not public), so the test signs in through the visible form first as an ordinary
  // account: the status screen needs a session, not a privileged role.
  await signIn(page, OBSERVER_EMAIL, OBSERVER_PASSWORD);
  await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\/$/);

  const response = await page.goto("/status");
  expect(response?.status()).toBe(200);

  // The landing page is Hebrew-first: labels come from the Hebrew dictionary,
  // values stay as measured machine data.
  await expect(page.getByRole("heading", { level: 1, name: "לוח ניהול אישי" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "מסד נתונים" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "תהליך רקע" })).toBeVisible();
  await expect(page.getByText("מחובר", { exact: true })).toBeVisible();
  await expect(page.locator('[data-value="not_installed"]')).toBeVisible();
  await expect(page.getByText("./data/e2e-4100.db")).toBeVisible();
  await expect(page.getByRole("link", { name: "נקודת בדיקת תקינות (JSON)" })).toHaveAttribute(
    "href",
    "/api/v1/health",
  );

  // The app must actually hydrate: a blocked inline script shows up as a CSP error.
  const cspProblems = consoleErrors.filter((text) =>
    /Content Security Policy|Refused to execute|Failed to load/i.test(text),
  );
  expect(cspProblems, `console errors: ${consoleErrors.join(" | ")}`).toEqual([]);
  expect(consoleErrors, `console errors: ${consoleErrors.join(" | ")}`).toEqual([]);
});

test("the app is not indexable", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
});
