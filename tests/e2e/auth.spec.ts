import { expect, test } from "@playwright/test";
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  bodyText,
  fillVisibleForm,
  otpauthUri,
  signIn,
} from "./helpers";
import { secretFromTotpUri, totpCode } from "../helpers/totp";

/**
 * Phase 1 auth gate against the real production server (spec §22 flows 1, 2, 11, 12).
 *
 * Every step is a browser step: forms are filled through visible inputs and submitted
 * by clicking the real submit button (tests/e2e/helpers.ts), and the accounts under test
 * were created out of band by scripts/e2e-server.mjs using the real admin:create CLI.
 *
 * Tests in one file run in order, so the admin's factor is enrolled once here and reused
 * below. The other specs (status rendering, locale) sign in as the ordinary observer
 * account, which has no factor - so a passing run never depends on this file's side
 * effects, and no spec quietly assumes a privileged account that skipped MFA.
 */

const GENERATED_PASSWORD = /^[A-HJ-NP-Za-km-z2-9]{20}$/;

function tag(): string {
  return Date.now().toString(36);
}

/** The admin's factor secret, captured the one time the enrollment shows it. */
let adminTotpSecret = "";

test("anonymous visitors cannot open any authenticated screen (§7 + §12)", async ({ page }) => {
  for (const path of ["/", "/users", "/settings", "/settings/security", "/activity", "/status"]) {
    await page.goto(path);
    await expect(page.url()).toContain("/login");
  }

  // The public surface stays public: the health endpoint answers without a session.
  const health = await page.request.get("/api/v1/health");
  await expect(health.status()).toBe(200);
});

test("a wrong password yields localized copy plus a machine code, never a stack (§12)", async ({
  page,
}) => {
  await page.goto("/login");
  await fillVisibleForm(page, {
    email: `e2e-nobody-${tag()}@dashboard.local`,
    password: "definitely-not-a-real-password-1",
  });
  await page.waitForLoadState("networkidle");

  const body = await bodyText(page);
  // Better Auth answers with one of its credential codes; the app translates it into
  // Hebrew copy and keeps the raw code visible next to it.
  await expect(body).toMatch(/USER_NOT_FOUND|INVALID_EMAIL_OR_PASSWORD|INVALID_PASSWORD/);
  await expect(body).toMatch(/[\u0590-\u05FF]/);
  await expect(body).not.toMatch(/at\s+\(?0x[0-9a-f]+|\bTypeError\b|node_modules/);
});

test("a privileged account must finish MFA before the shell opens, and a fresh browser needs the factor (§12 + §22 flow 11)", async ({
  page,
  context,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "stateful identity lifecycle runs once");
  await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await page.waitForURL(/\/settings\/security/);
  await expect(page.url()).toContain("reason=mfa");

  const security = await bodyText(page);
  await expect(security).toContain("mfa_required");
  await expect(security).toContain("twoFactorEnabled=false");
  await expect(security).toMatch(/[\u0590-\u05FF]/);

  // Start enrollment: the scan URI and the recovery codes exist on screen once.
  await fillVisibleForm(page, { password: ADMIN_PASSWORD });
  await page.waitForURL(/done=mfaStarted/);
  await expect(page.getByAltText("קוד QR להגדרת אימות דו שלבי")).toBeVisible();

  const uri = await otpauthUri(page);
  await expect(uri).not.toBe("");
  adminTotpSecret = secretFromTotpUri(uri);
  await expect(await bodyText(page)).toContain("pending_enrollment");

  // A real RFC 6238 code proves the enrollment.
  await fillVisibleForm(page, { code: totpCode(adminTotpSecret) });
  await page.waitForURL(/done=mfaEnabled/);
  const afterConfirm = await bodyText(page);
  await expect(afterConfirm).toContain("twoFactorEnabled=true");
  await expect(afterConfirm).not.toContain("pending_enrollment");

  // Now the privileged shell is reachable.
  await page.goto("/");
  await expect(page.url()).not.toContain("/login");
  await expect(page.locator('[data-value="super_admin"]').first()).toBeVisible();
  await expect(page.locator('a[href="/users"]').first()).toBeVisible();

  // A fresh browser: the password alone is no longer enough.
  await context.clearCookies();
  await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await page.waitForURL(/\/two-factor\/verify/);

  await fillVisibleForm(page, { code: totpCode(adminTotpSecret) });
  await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\/$/);
  await expect(page.getByRole("heading", { level: 1, name: "לוח המחוונים" })).toBeVisible();
});

test("the privileged admin creates a read_only account, and that account is denied the users screen (§22 flows 1 + 12)", async ({
  page,
  context,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "stateful identity lifecycle runs once");
  // The admin now carries a factor, so signing in means password + code.
  await page.goto("/login");
  await fillVisibleForm(page, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  await page.waitForURL(/\/two-factor\/verify/);
  await fillVisibleForm(page, { code: totpCode(adminTotpSecret) });
  await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\/$/);

  await page.goto("/users");
  await expect(page.url()).toContain("/users");

  const victimEmail = `e2e-victim-${tag()}@dashboard.local`;
  await fillVisibleForm(page, { name: "Nobody At All", email: victimEmail, role: "read_only" });
  await page.waitForURL(/done=accountCreated/);

  // The generated password exists on screen exactly once; the test copies it, never stores it.
  const generated = await page.evaluate((passwordPattern) => {
    const generatedPassword = new RegExp(passwordPattern);
    for (const element of document.querySelectorAll('p[dir="ltr"]')) {
      const value = element.textContent.trim();
      if (generatedPassword.test(value)) return value;
    }
    return "";
  }, GENERATED_PASSWORD.source);
  await expect(generated).not.toBe("");

  await context.clearCookies();
  await signIn(page, victimEmail, generated);
  await page.waitForURL(/\/settings\/security/);
  await expect(page.url()).toContain("reason=password");

  const replacement = "e2e-read-only-replacement-1";
  await fillVisibleForm(page, {
    currentPassword: generated,
    newPassword: replacement,
    confirmPassword: replacement,
  });
  await page.waitForURL(/done=passwordChanged/);

  await page.goto("/users");
  await expect(page.url()).toContain("/forbidden");
  const body = await bodyText(page);
  await expect(body).toMatch(/[\u0590-\u05FF]/);
  await expect(body).not.toContain("super_admin");
});

test("an ordinary account enrolls its own factor and a fresh browser needs it (§22 flow 11)", async ({
  page,
  context,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "stateful identity lifecycle runs once");
  // Created through the admin UI like any other account, then used as the test subject.
  await page.goto("/login");
  await fillVisibleForm(page, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  await page.waitForURL(/\/two-factor\/verify/);
  await fillVisibleForm(page, { code: totpCode(adminTotpSecret) });
  await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\/$/);

  await page.goto("/users");
  const mfaEmail = `e2e-mfa-${tag()}@dashboard.local`;
  await fillVisibleForm(page, { name: "Factor Holder", email: mfaEmail, role: "user" });
  await page.waitForURL(/done=accountCreated/);

  const generated = await page.evaluate((passwordPattern) => {
    const generatedPassword = new RegExp(passwordPattern);
    for (const element of document.querySelectorAll('p[dir="ltr"]')) {
      const value = element.textContent.trim();
      if (generatedPassword.test(value)) return value;
    }
    return "";
  }, GENERATED_PASSWORD.source);
  await expect(generated).not.toBe("");

  const replacement = "e2e-mfa-replacement-1";
  await context.clearCookies();
  await signIn(page, mfaEmail, generated);
  await page.waitForURL(/\/settings\/security/);
  await expect(page.url()).toContain("reason=password");

  await fillVisibleForm(page, {
    currentPassword: generated,
    newPassword: replacement,
    confirmPassword: replacement,
  });
  await page.waitForURL(/done=passwordChanged/);

  await fillVisibleForm(page, { password: replacement });
  await page.waitForURL(/done=mfaStarted/);

  const uri = await otpauthUri(page);
  await expect(uri).not.toBe("");
  const secret = secretFromTotpUri(uri);

  await fillVisibleForm(page, { code: totpCode(secret) });
  await page.waitForURL(/done=mfaEnabled/);
  const afterConfirm = await bodyText(page);
  await expect(afterConfirm).toContain("twoFactorEnabled=true");
  await expect(afterConfirm).not.toContain("pending_enrollment");

  await context.clearCookies();
  await signIn(page, mfaEmail, replacement);
  await page.waitForURL(/\/two-factor\/verify/);
  await fillVisibleForm(page, { code: totpCode(secret) });
  await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\/$/);
  await expect(page.getByRole("heading", { level: 1, name: "לוח המחוונים" })).toBeVisible();
});

test("the login page is the only anonymous page and it is localized too (§4 + §7)", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.url()).toContain("/login");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { level: 1, name: "כניסה למערכת" })).toBeVisible();
  await expect(page.getByRole("button", { name: "English" })).toBeVisible();
});
