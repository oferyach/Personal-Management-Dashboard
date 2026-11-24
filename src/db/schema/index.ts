import { accounts, rate_limit, sessions, two_factor, users, verifications } from "./auth";
import {
  audit_logs,
  permissions,
  resource_permissions,
  role_permissions,
  roles,
  user_preferences,
} from "./identity";
import { systemMeta } from "./systemMeta";

/**
 * Every table behind one object, because that is how `src/db/client.ts` configures
 * Drizzle (`drizzle(sqlite, { schema })`) and how `drizzle-kit` generates
 * migrations. Files are grouped by domain so a phase can add its own domain file
 * without touching the database client; this index is the single place that says
 * which tables exist.
 */
export const schema = {
  systemMeta,
  users,
  sessions,
  accounts,
  verifications,
  two_factor,
  rate_limit,
  roles,
  permissions,
  role_permissions,
  resource_permissions,
  user_preferences,
  audit_logs,
} as const;

export * from "./auth";
export * from "./identity";
export * from "./systemMeta";

export type Schema = typeof schema;
export type SystemMetaRow = typeof systemMeta.$inferSelect;
