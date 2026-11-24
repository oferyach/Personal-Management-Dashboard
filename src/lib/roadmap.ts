import type { PermissionKey } from "@/lib/rbac";

/**
 * The main navigation registry (spec §4 "Main navigation": 11 destinations).
 *
 * One table drives the sidebar, the permission filter and the honest "not built
 * yet" screens, so a destination cannot appear in the menu without a path and a
 * rule, and a planned feature cannot be presented as if it existed.
 *
 * `planned` values are copied from `docs/PLAN.md`; they describe what is planned,
 * not what is implemented.
 */
export type NavKey =
  | "dashboard"
  | "calendar"
  | "tasks"
  | "projects"
  | "assets"
  | "onedrive"
  | "notifications"
  | "activity"
  | "usersRoles"
  | "settings"
  | "profile";

export interface PlannedPhase {
  phase: string;
  gate: string;
  workItems: string;
}

export interface NavDestination {
  key: NavKey;
  path: string;
  match: "exact" | "prefix";
  /** null = any signed-in user may open it. Otherwise the permission gate (1.8). */
  permission: PermissionKey | null;
  /** null = the page is real now. Otherwise the phase that will build it. */
  planned: PlannedPhase | null;
}

const PHASE_2: PlannedPhase = { phase: "2", gate: "Gate 2", workItems: "2.1–2.12" };
const PHASE_3: PlannedPhase = { phase: "3", gate: "Gate 3", workItems: "3.1–3.10" };
const PHASE_4: PlannedPhase = { phase: "4", gate: "Gate 4", workItems: "4.1–4.8" };
const PHASE_5: PlannedPhase = { phase: "5", gate: "Gate 5", workItems: "5.0–5.11" };

export const NAV_DESTINATIONS: readonly NavDestination[] = [
  { key: "dashboard", path: "/", match: "exact", permission: null, planned: null },
  { key: "calendar", path: "/calendar", match: "prefix", permission: null, planned: PHASE_2 },
  { key: "tasks", path: "/tasks", match: "prefix", permission: null, planned: PHASE_2 },
  { key: "projects", path: "/projects", match: "prefix", permission: null, planned: PHASE_2 },
  { key: "assets", path: "/assets", match: "prefix", permission: null, planned: PHASE_4 },
  { key: "onedrive", path: "/onedrive", match: "prefix", permission: null, planned: PHASE_5 },
  {
    key: "notifications",
    path: "/notifications",
    match: "prefix",
    permission: null,
    planned: PHASE_3,
  },
  { key: "activity", path: "/activity", match: "prefix", permission: "audit.view", planned: null },
  { key: "usersRoles", path: "/users", match: "prefix", permission: "users.view", planned: null },
  { key: "settings", path: "/settings", match: "prefix", permission: null, planned: null },
  { key: "profile", path: "/settings/profile", match: "exact", permission: null, planned: null },
];

export function isDestinationActive(dest: NavDestination, pathname: string): boolean {
  if (dest.match === "exact") return pathname === dest.path;
  if (dest.path === "/") return pathname === "/";
  return pathname === dest.path || pathname.startsWith(`${dest.path}/`);
}
