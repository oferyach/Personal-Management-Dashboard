import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createFirstAdmin } from "@/lib/adminBootstrap";
import { readAudit, recordAudit } from "@/lib/audit";
import { resetAuthInstance } from "@/lib/auth";
import { collectDashboardFacts } from "@/lib/dashboard";
import { accountLanguage } from "@/i18n/requestLocale";
import { PreferenceError, readPreferences, savePreferences } from "@/lib/preferences";
import { closeTestDatabases, resetTestDatabase } from "../helpers/testDb";
import { signInHeaders } from "../helpers/signedIn";

const password = "Foundation-Password-2026!";

async function createUser(name: string, email: string) {
  return createFirstAdmin({ name, email, password, role: "user" });
}

describe("Phase 1 foundation services", () => {
  beforeEach(() => {
    resetTestDatabase("foundation-services");
    resetAuthInstance();
  });

  afterAll(() => closeTestDatabases());

  it("resolves the saved language only through a verified signed session", async () => {
    const user = await createUser("Locale Owner", "locale@example.internal");
    savePreferences(user.id, { language: "en" });
    const valid = await signInHeaders(user.email, password);
    await expect(accountLanguage(valid)).resolves.toBe("en");

    const cookie = valid.get("cookie")!;
    const forged = new Headers({
      origin: "http://127.0.0.1:4000",
      cookie: cookie.replace(/pmd\.session_token=([^;]+)/, (_all, value: string) => {
        const replacement = value.endsWith("a") ? "b" : "a";
        return `pmd.session_token=${value.slice(0, -1)}${replacement}`;
      }),
    });
    await expect(accountLanguage(forged)).resolves.toBeNull();
  });

  it("validates and persists account preferences", async () => {
    const user = await createUser("Preference Owner", "preferences@example.internal");
    const saved = savePreferences(user.id, {
      language: "en",
      timezone: "Asia/Jerusalem",
      theme: "dark",
      workweekDays: 6,
      workdayStartHour: 8,
      workdayEndHour: 18,
      defaultTaskReminderOffsets: [60, 15, 60],
    });
    expect(saved.defaultTaskReminderOffsets).toEqual([15, 60]);
    expect(readPreferences(user.id).theme).toBe("dark");
    expect(() => savePreferences(user.id, { timezone: "Not/A_Zone" })).toThrow(PreferenceError);
  });

  it("combines audit filters and redacts secret-shaped detail", async () => {
    const user = await createUser("Audit Owner", "audit@example.internal");
    recordAudit({
      action: "sign_in",
      outcome: "success",
      actorUserId: user.id,
      detail: { password: "never-store-this", method: "password" },
    });
    recordAudit({ action: "password_changed", outcome: "success", actorUserId: user.id });

    const entries = readAudit({ userId: user.id, action: "sign_in" });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.action).toBe("sign_in");
    expect(entries[0]?.detail).not.toContain("never-store-this");
    expect(entries[0]?.detail).toContain("[redacted]");
  });

  it("scopes dashboard facts unless administrative data was explicitly authorized", async () => {
    const first = await createUser("First User", "first@example.internal");
    await createUser("Second User", "second@example.internal");
    recordAudit({ action: "sign_in", outcome: "success", actorUserId: first.id });
    recordAudit({ action: "sign_in", outcome: "success" });

    const scoped = collectDashboardFacts(first.id);
    expect(scoped.accountsTotal).toBe(0);
    expect(scoped.accountsByRole).toEqual([]);
    expect(scoped.signInAttemptsToday).toBe(1);

    const administrative = collectDashboardFacts(first.id, {
      includeAccountAdministration: true,
      includeGlobalAudit: true,
    });
    expect(administrative.accountsTotal).toBe(2);
    expect(administrative.signInAttemptsToday).toBe(2);
  });
});
