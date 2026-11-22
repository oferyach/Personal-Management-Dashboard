import { expect, test, type Page } from "@playwright/test";

/**
 * Hebrew-first + RTL gate (spec §4 as amended 2026-11-22).
 *
 * Asserted through the real production server: direction and language are
 * decided server-side before the first byte of HTML, the switch is a plain
 * form POST (works with JavaScript disabled and under the production CSP),
 * and measured values keep their own direction inside RTL text.
 */

const HEBREW = /[\u0590-\u05FF]/;

async function documentDirection(page: Page) {
  return page.evaluate(() => ({
    lang: document.documentElement.lang,
    dir: document.documentElement.dir,
    locale: document.documentElement.getAttribute("data-locale"),
    defaultLanguage: document.documentElement.getAttribute("data-default-language"),
  }));
}

test("Hebrew is the primary language: the document arrives RTL with a Hebrew title", async ({
  page,
}) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);

  expect(await documentDirection(page)).toEqual({
    lang: "he-IL",
    dir: "rtl",
    locale: "he",
    defaultLanguage: "he",
  });

  await expect(page.locator("h1")).toHaveText(/[\u0590-\u05FF]/);
  await expect(page).toHaveTitle(/לוח ניהול אישי/);
  // The switch offers the secondary language in its own script.
  await expect(page.getByRole("button", { name: "English" })).toBeVisible();
});

test("switching language flips dir and persists the choice in a cookie", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

  await page.getByRole("button", { name: "English" }).click();

  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(
    page.getByRole("heading", { level: 1, name: "Personal Management Dashboard" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Database" })).toBeVisible();

  const [cookie] = await context
    .cookies()
    .then((all) => all.filter((c) => c.name === "pmd_locale"));
  expect(cookie?.value).toBe("en");
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.path).toBe("/");

  // Preference survives a fresh navigation, not just the redirect.
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.getByRole("button", { name: "עברית" })).toBeVisible();

  // And back to Hebrew, the primary language.
  await page.getByRole("button", { name: "עברית" }).click();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("html")).toHaveAttribute("lang", "he-IL");
});

test("the language switch works without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();

  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

  await page.getByRole("button", { name: "English" }).click();

  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");

  await context.close();
});

test("an invalid or hostile locale value falls back to Hebrew", async ({ browser }) => {
  for (const injected of ["de", "en'\"<script>", "../x", "rtl"]) {
    const context = await browser.newContext();
    const page = await context.newPage();

    await context.addCookies([
      { name: "pmd_locale", value: injected, url: "http://127.0.0.1:4100/" },
    ]);
    await page.goto("/");

    expect(await documentDirection(page)).toEqual({
      lang: "he-IL",
      dir: "rtl",
      locale: "he",
      defaultLanguage: "he",
    });
    await expect(page.locator("h1")).toHaveText(HEBREW);

    await context.close();
  }
});

test("measured values stay LTR inside the RTL page", async ({ page }) => {
  await page.goto("/");

  const fileValue = page.locator('dd[dir="ltr"]', { hasText: "./data/e2e-4100.db" });
  await expect(fileValue.first()).toBeVisible();
  await expect(fileValue.first()).toHaveAttribute("dir", "ltr");

  // The localized label is for humans; the machine code stays queryable.
  await expect(page.locator('[data-value="not_installed"]')).toBeVisible();
  await expect(page.getByText("wal", { exact: true }).first()).toBeVisible();
});

test("even the 404 page arrives Hebrew and RTL", async ({ page }) => {
  const response = await page.goto("/definitely-not-here");
  expect(response?.status()).toBe(404);

  expect(await documentDirection(page)).toEqual({
    lang: "he-IL",
    dir: "rtl",
    locale: "he",
    defaultLanguage: "he",
  });
  await expect(page.getByRole("heading", { level: 1, name: "הדף לא נמצא" })).toBeVisible();
});

test("RTL page renders on mobile without hydration or CSP errors", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(String(error)));

  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("button", { name: "English" })).toBeVisible();

  expect(consoleErrors).toEqual([]);
});
