import { type Page } from "@playwright/test";

/**
 * Shared E2E plumbing. Everything here fills *visible* form inputs and submits
 * through the shipped client path (a click on the real submit button), so a
 * passing test means a browser user could actually do it: no invented shortcuts,
 * no direct API calls.
 *
 * E2E-only identity: mirrored literally in scripts/e2e-server.mjs, which creates
 * this account through the real admin:create CLI before the server boots.
 */
export const ADMIN_EMAIL = "e2e-admin@dashboard.local";
export const ADMIN_PASSWORD = "e2e-admin-password-1";
// An ordinary account (role `user`, no factor): the specs that only need a session
// sign in as this one, so they never depend on the admin's factor state.
export const OBSERVER_EMAIL = "e2e-observer@dashboard.local";
export const OBSERVER_PASSWORD = "e2e-observer-password-1";

/**
 * Fills the one form whose required (non-hidden) inputs are exactly `fields`,
 * tags that form, and clicks that form's own submit button. Throws when the
 * screen is ambiguous - two forms sharing a required set would leave a test to
 * guess, which is a UI bug, not something tests should paper over.
 *
 * Returns the required-name set it filled, so a test can assert what it meant.
 */
export async function fillVisibleForm(
  page: Page,
  fields: Record<string, string>,
): Promise<string[]> {
  const wanted = Object.keys(fields).slice().sort();
  const state = await page.evaluate((payload: Record<string, string>) => {
    const requiredOf = (form: HTMLElement): string[] =>
      Array.from(
        form.querySelectorAll('input:not([type="submit"]):not([type="hidden"]):not([disabled])'),
      )
        .filter((input) => input.hasAttribute("required"))
        .map((input) => input.getAttribute("name") ?? "")
        .slice()
        .sort();

    const forms = Array.from(document.querySelectorAll("form"));
    const key = Object.keys(payload).slice().sort().join("|");
    const matches = forms.filter((form) => requiredOf(form).join("|") === key);
    if (matches.length !== 1) return { count: matches.length, wanted: key };

    const form = matches[0];
    if (!form) return { count: matches.length, wanted: key };
    form.setAttribute("data-pmd-filled", key);
    for (const field of form.querySelectorAll("input, select")) {
      const name = field.getAttribute("name");
      if (!name) continue;
      const value = payload[name];
      if (value === undefined) continue;
      if (field.tagName === "select") {
        // In the browser, changing a <select> means setting its `value` slot.
        // The cast only tells the type checker about a browser-side property.
        const select = field as unknown as { value: string };
        select.value = value;
      } else {
        field.setAttribute("value", value);
      }
    }
    return { count: 1, wanted: key };
  }, fields);

  if (state.count !== 1) {
    throw new Error(
      `expected exactly one form requiring ${state.wanted} on this screen, found ${state.count}`,
    );
  }

  const submit = page.locator("form[data-pmd-filled] button[type='submit']").first();
  await submit.click();
  return wanted;
}

/** Signs in through the visible login form and waits for the landing screen. */
export async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await fillVisibleForm(page, { email, password });
}

/** Whole-page text, for asserting localized copy next to machine codes. */
export async function bodyText(page: Page): Promise<string> {
  const body = await page.evaluate(() => document.body?.innerText ?? "");
  return body.replace(/\s+/g, " ");
}

/** The rendered otpauth:// machine value (an enrollment shows it exactly once). */
export async function otpauthUri(page: Page): Promise<string> {
  const values = await page.evaluate(() =>
    Array.from(document.querySelectorAll("dd")).map((cell) => cell.textContent.trim()),
  );
  const found = values.find((value: string) => value.startsWith("otpauth://"));
  return found ?? "";
}
