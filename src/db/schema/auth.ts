import { relations } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { roles } from "./identity";

/**
 * Identity tables (Phase 1, work item 1.2).
 *
 * These are Better Auth's own models. `src/lib/auth.ts` points each Better Auth
 * model at these snake_case tables with `modelName`, and the Drizzle adapter
 * resolves both tables and fields through the **object keys** below — so the
 * keys keep Better Auth's camelCase names (`emailVerified`, `lastRequest`) while
 * the SQL columns stay snake_case. `tests/unit/authSchema.test.ts` pins the
 * mapping against the library's own schema builder, and
 * `tests/integration/auth.test.ts` runs real sign-up/sign-in against it, so a
 * library upgrade that renames a field fails a test instead of failing silently
 * in production.
 *
 * Timestamps are ISO-8601 UTC strings (project convention). Better Auth hands
 * the adapter `Date` objects; the adapter serializes them into these text
 * columns, so the storage format stays ours.
 */

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
    image: text("image"),
    /** Role key into `roles.key`. Authorization itself lives in `src/lib/rbac.ts`. */
    role: text("role")
      .notNull()
      .default("read_only")
      .references(() => roles.key),
    /** Better Auth `admin` plugin fields (banning a user without deleting data). */
    banned: integer("banned", { mode: "boolean" }).notNull().default(false),
    banReason: text("ban_reason"),
    banExpires: text("ban_expires"),
    /** Better Auth `twoFactor` plugin field: true once an authenticator is enrolled. */
    twoFactorEnabled: integer("two_factor_enabled", { mode: "boolean" }).notNull().default(false),
    /**
     * Work item 1.7: accounts created by an admin hold an admin-generated temporary
     * password. The flag blocks privileged use until the user sets their own.
     */
    mustChangePassword: integer("must_change_password", { mode: "boolean" })
      .notNull()
      .default(true),
    /** Phase 6 fills in the OneDrive link; the flag exists now so the shell renders honestly. */
    onedriveLinked: integer("onedrive_linked", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("users_role_idx").on(table.role),
    uniqueIndex("users_email_unique").on(table.email),
  ],
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: text("expires_at").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    /** Set only while an admin is impersonating another user (admin plugin). */
    impersonatedBy: text("impersonated_by"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("sessions_user_id_idx").on(table.userId)],
);

export const accounts = sqliteTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: text("access_token_expires_at"),
    refreshTokenExpiresAt: text("refresh_token_expires_at"),
    scope: text("scope"),
    /** Argon2id PHC string for the credential provider. */
    password: text("password"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("accounts_user_id_idx").on(table.userId)],
);

export const verifications = sqliteTable(
  "verifications",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("verifications_identifier_idx").on(table.identifier)],
);

/** Better Auth `twoFactor` plugin table: TOTP secret + backup codes, both encrypted at rest. */
export const two_factor = sqliteTable(
  "two_factor",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: "cascade" }),
    secret: text("secret").notNull(),
    backupCodes: text("backup_codes").notNull(),
    verified: integer("verified", { mode: "boolean" }).notNull().default(true),
    /** Plugin `accountLockout` counter for two-factor brute force. */
    failedVerificationCount: integer("failed_verification_count").notNull().default(0),
    lockedUntil: text("locked_until"),
  },
  (table) => [index("two_factor_user_id_idx").on(table.userId)],
);

/**
 * DB-backed rate limiting (spec §12: rate limiting in the DB, not in process
 * memory). `id` exists because Better Auth requires a primary-key column on every
 * table it writes; `last_request` is epoch milliseconds, which is what the library
 * stores (`Number(lastRequest)`).
 */
export const rate_limit = sqliteTable("rate_limit", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: integer("last_request").notNull(),
});

export const userRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  accounts: many(accounts),
}));

export const sessionRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const accountRelations = relations(accounts, ({ one }) => ({
  user: one(users, { fields: [accounts.userId], references: [users.id] }),
}));
