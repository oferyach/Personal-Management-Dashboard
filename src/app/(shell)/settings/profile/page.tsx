import {
  Feedback,
  SectionCard,
  SelectField,
  SubmitButton,
  TabLinks,
  TextField,
} from "@/components/forms";
import { getI18n } from "@/i18n/requestLocale";
import { LOCALES } from "@/i18n/locales";
import { readPreferences } from "@/lib/preferences";
import { can } from "@/lib/rbac";
import { requirePageUser } from "@/lib/requestAuth";
import { saveProfileAction } from "../actions";

export const dynamic = "force-dynamic";

const OFFSET_KEYS = { 15: "m15", 60: "m60", 1440: "m1440" } as const;

/**
 * Work item 1.9 — per-account profile. Everything on this screen is a column of
 * `user_preferences` or a column of `users`; nothing is a control that goes nowhere.
 * A `read_only` account sees the same fields with `disabled`, because a disabled
 * control is honest in a way a hidden one is not: it shows the account what exists
 * and why it cannot change it.
 */
export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; done?: string }>;
}) {
  const { user } = await requirePageUser({ allowIncompleteSecurity: true });
  const { dict, locale } = await getI18n();
  const t = dict.settings;
  const p = t.profile;
  const prefs = readPreferences(user.id);
  const mayEdit = await can(user.actor, "settings.edit_own");
  const params = await searchParams;

  const firstOffset = prefs.defaultTaskReminderOffsets[0] ?? 60;
  const calendarOffset = prefs.defaultCalendarReminderOffsets[0] ?? 60;

  const intervalOptions = [15, 60, 1440].map((value) => ({
    value: String(value),
    label: p.intervalValues[OFFSET_KEYS[value as keyof typeof OFFSET_KEYS]],
  }));

  return (
    <>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{p.title}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{p.subtitle}</p>
      </header>

      <div className="mt-4">
        <TabLinks
          label={t.title}
          pathname="/settings/profile"
          tabs={[
            { href: "/settings", label: t.title },
            { href: "/settings/profile", label: t.tabs.profile },
            { href: "/settings/security", label: t.tabs.security },
          ]}
        />
      </div>

      <div className="mt-5 space-y-4">
        <Feedback dict={dict} notice={params.notice} done={params.done} />

        <SectionCard title={p.displayName} body={p.saveHint}>
          <form action={saveProfileAction} className="space-y-4">
            <TextField
              name="name"
              label={p.displayName}
              value={user.name ?? ""}
              autoComplete="name"
              disabled={!mayEdit}
            />
            <div>
              <span className="text-muted-foreground block text-sm">{p.email}</span>
              <span className="text-foreground ltr-island mt-1 block font-mono text-sm" dir="ltr">
                {user.email}
              </span>
              <span className="text-muted-foreground block text-xs">{p.emailHint}</span>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                name="language"
                label={p.language}
                value={prefs.language ?? locale}
                disabled={!mayEdit}
                options={LOCALES.map((code) => ({
                  value: code,
                  label: dict.ui.language[code],
                }))}
              />
              <TextField
                name="timezone"
                label={p.timezone}
                value={prefs.timezone}
                hint={p.timezoneHint}
                machine
                disabled={!mayEdit}
              />
              <SelectField
                name="workweekDays"
                label={p.workweekDays}
                value={String(prefs.workweekDays)}
                disabled={!mayEdit}
                options={[5, 6, 7].map((days) => ({
                  value: String(days),
                  label:
                    days === 5
                      ? p.workweekValues.d5
                      : days === 6
                        ? p.workweekValues.d6
                        : p.workweekValues.d7,
                }))}
              />
              <SelectField
                name="theme"
                label={p.theme}
                value={prefs.theme}
                disabled={!mayEdit}
                options={[
                  { value: "system", label: p.themeValues.system },
                  { value: "light", label: p.themeValues.light },
                  { value: "dark", label: p.themeValues.dark },
                ]}
              />
              <TextField
                name="workdayStartHour"
                label={p.workdayStart}
                type="number"
                value={String(prefs.workdayStartHour)}
                hint={p.workingHoursHint}
                machine
                disabled={!mayEdit}
              />
              <TextField
                name="workdayEndHour"
                label={p.workdayEnd}
                type="number"
                value={String(prefs.workdayEndHour)}
                hint={p.workingHoursHint}
                machine
                disabled={!mayEdit}
              />
              <SelectField
                name="defaultTaskReminderOffsets"
                label={p.taskReminders}
                value={String(firstOffset)}
                hint={p.reminderHint}
                disabled={!mayEdit}
                options={intervalOptions}
              />
              <SelectField
                name="defaultCalendarReminderOffsets"
                label={p.calendarReminders}
                value={String(calendarOffset)}
                hint={p.reminderHint}
                disabled={!mayEdit}
                options={intervalOptions}
              />
            </div>

            {mayEdit ? <SubmitButton label={dict.common.save} /> : null}
            {!mayEdit ? <p className="text-muted-foreground text-sm">{p.readOnlyHint}</p> : null}
          </form>
        </SectionCard>
      </div>
    </>
  );
}
