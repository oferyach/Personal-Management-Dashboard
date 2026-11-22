import type { Dictionary } from "./types";

/**
 * English dictionary — SECONDARY language.
 *
 * Typed against `Dictionary`, which is derived from the Hebrew dictionary, so
 * a missing or extra key is a build failure rather than a silent fallback.
 * Brand names and machine identifiers (OneDrive, SMTP, Node, SQLite) are not
 * translated.
 */
export const en: Dictionary = {
  app: {
    name: "Personal Management Dashboard",
    tagline: "Calendar, tasks, projects, assets, reminders and OneDrive — on your own server.",
    phaseNote:
      "Phase 0 — foundation. Everything shown here is read from the running process and the real database.",
  },

  nav: {
    heading: "Main menu",
    dashboard: "Dashboard",
    calendar: "Calendar",
    tasks: "Tasks",
    projects: "Projects",
    assets: "Assets",
    onedrive: "OneDrive",
    notifications: "Notifications",
    activity: "Activity history",
    usersRoles: "Users & roles",
    settings: "Settings",
    profile: "My profile",
  },

  status: {
    cards: {
      database: "Database",
      runtime: "Runtime",
      worker: "Background worker",
      integrations: "Integrations",
    },
    labels: {
      status: "status",
      file: "file",
      journalMode: "journal mode",
      foreignKeys: "foreign keys",
      busyTimeout: "busy timeout",
      synchronous: "synchronous",
      migrationsApplied: "migrations applied",
      tables: "tables",
      sqlite: "SQLite version",
      environment: "environment",
      node: "Node",
      version: "app version",
      publicUrl: "public URL",
      uptime: "uptime",
      timezone: "timezone",
      language: "default language",
      state: "state",
      detail: "detail",
      diagnostics: "raw diagnostics (not translated)",
      heartbeatAge: "heartbeat age",
      smtp: "SMTP",
      onedrive: "OneDrive",
      schemaVersion: "schema version",
    },
    warningsHeading: "Configuration warnings",
    footer: {
      healthLink: "JSON health endpoint",
      nextPhase: "Next: Phase 1 — authentication, users, roles, MFA. See",
    },
  },

  states: {
    health: { ok: "ok", degraded: "degraded" },
    database: { connected: "connected", unavailable: "unavailable" },
    worker: {
      not_installed: "not installed",
      online: "online",
      stale: "stale",
      no_heartbeat: "no heartbeat",
    },
    workerDetail: {
      not_installed:
        "The background worker (jobs, reminders, sync) arrives in Phase 3; there is no heartbeat table yet.",
      online: "Worker heartbeat is fresh.",
      stale: "No current heartbeat — reminders and background jobs are not running.",
      no_heartbeat: "The heartbeat value is unreadable.",
    },
    integration: {
      configured: "configured",
      not_configured: "not configured — the app runs without it",
    },
  },

  notFound: {
    title: "Page not found",
    body: "This address does not match any page in the app. The link may be outdated, or it may have been mistyped.",
    backHome: "Back to the main page",
  },

  ui: {
    language: {
      label: "Language",
      he: "עברית",
      en: "English",
      switchTo: "Switch language",
    },
  },

  units: {
    seconds: "s",
    milliseconds: "ms",
  },
};
