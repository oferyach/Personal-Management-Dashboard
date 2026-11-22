/**
 * Hebrew dictionary — PRIMARY UI language and the source of truth for the
 * dictionary shape (spec §4, amended 2026-11-22).
 *
 * Only presentation strings belong here. Measured machine values (SQL pragma
 * names, enum codes such as `not_installed`, ISO timestamps, file paths) stay
 * untranslated in the data layer and are rendered as LTR islands, so the UI
 * never reports an invented or mistranslated fact.
 */

export const he = {
  app: {
    name: "לוח ניהול אישי",
    tagline: "יומן, משימות, פרויקטים, נכסים, התראות ו-OneDrive — בשרת שלך.",
    phaseNote: "שלב 0 — תשתית. כל מה שמוצג כאן נקרא מהתהליך הפעיל ומהמסד נתונים האמיתי.",
  },

  /** Main navigation labels (spec §4). Rendered by the Phase 1 app shell. */
  nav: {
    heading: "תפריט ראשי",
    dashboard: "לוח מחוונים",
    calendar: "לוח שנה",
    tasks: "משימות",
    projects: "פרויקטים",
    assets: "נכסים",
    onedrive: "OneDrive",
    notifications: "התראות",
    activity: "היסטוריית פעילות",
    usersRoles: "משתמשים ותפקידים",
    settings: "הגדרות",
    profile: "פרופיל אישי",
  },

  status: {
    cards: {
      database: "מסד נתונים",
      runtime: "סביבת ריצה",
      worker: "תהליך רקע",
      integrations: "אינטגרציות",
    },
    labels: {
      status: "מצב",
      file: "קובץ",
      journalMode: "מצב יומן",
      foreignKeys: "מפתחות חיצוניים",
      busyTimeout: "זמן המתנה מרבי",
      synchronous: "סנכרון",
      migrationsApplied: "העברות שהוחלו",
      tables: "טבלאות",
      sqlite: "גרסת SQLite",
      environment: "סביבה",
      node: "Node",
      version: "גרסת היישום",
      publicUrl: "כתובת ציבורית",
      uptime: "זמן פעולה",
      timezone: "אזור זמן",
      language: "שפת ברירת מחדל",
      state: "מצב",
      detail: "פירוט",
      diagnostics: "פלט מכונה (לא מתורגם)",
      heartbeatAge: "גיל פעימת לב",
      smtp: "SMTP",
      onedrive: "OneDrive",
      schemaVersion: "גרסת סכמה",
    },
    warningsHeading: "התראות הגדרה",
    footer: {
      healthLink: "נקודת בדיקת תקינות (JSON)",
      nextPhase: "שלב הבא: שלב 1 — אימות, משתמשים, תפקידים ו-MFA. עיין בקובץ",
    },
  },

  /** Localized labels for machine enums. The raw code stays available for tools. */
  states: {
    health: { ok: "תקין", degraded: "לקוי" },
    database: { connected: "מחובר", unavailable: "לא זמין" },
    worker: {
      not_installed: "לא מותקן",
      online: "מחובר",
      stale: "מיושן",
      no_heartbeat: "אין פעימת לב",
    },
    /** Localized explanation of a measured state. The raw diagnostic string stays visible as machine data. */
    workerDetail: {
      not_installed: "תהליך הרקע (משימות, תזכורות וסנכרון) מוצג בשלב 3; עדיין אין טבלת פעימות לב.",
      online: "פעימת הלב של תהליך הרקע טרייה.",
      stale: "אין פעימת לב עדכנית — תזכורות ומשימות רקע אינן פועלות.",
      no_heartbeat: "ערכו של פעימת הלב אינו ניתן לקריאה.",
    },
    integration: {
      configured: "מוגדר",
      not_configured: "לא מוגדר — היישום פועל בלעדיו",
    },
  },

  notFound: {
    title: "הדף לא נמצא",
    body: "כתובת זו אינה תואמת לדף ביישום. ייתכן שהקישור מיושן או שהוקלדה שגיאה.",
    backHome: "חזרה לדף הראשי",
  },

  ui: {
    language: {
      label: "שפה",
      /** Native names on purpose: a language switch is readable in its own script. */
      he: "עברית",
      en: "English",
      switchTo: "החלפה לשפה",
    },
  },

  units: {
    seconds: "שניות",
    milliseconds: "מילי־שניות",
  },
} as const;

export type HebrewDictionary = typeof he;
