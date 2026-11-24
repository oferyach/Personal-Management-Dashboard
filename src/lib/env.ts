import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";

/**
 * Two levels of configuration, on purpose:
 *
 *  - parseConfig()/getConfig(): everything needed to BUILD and to report status.
 *    Never requires secrets, so `next build` works without production secrets.
 *  - parseEnv()/getEnv(): config + runtime secrets. Production refuses to serve
 *    without them (spec §19, §20) — enforced at server start, not at build time.
 *
 * Development and tests run with zero configuration (spec §21): throwaway
 * secrets are generated once into <data dir>/.dev-secrets.json (gitignored).
 * Optional integrations are reported as configured/not configured, never faked.
 */

export const LOG_LEVELS = ["silent", "error", "warn", "info", "debug"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];
export type NodeEnv = "development" | "test" | "production";

export class EnvError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(
      `Invalid environment configuration:\n  - ${issues.join(
        "\n  - ",
      )}\n\nCopy .env.example to .env and fill in the required values.`,
    );
    this.name = "EnvError";
    this.issues = issues;
  }
}

const SECRET_PLACEHOLDER =
  /^(change[-_]?me|replace[-_]?with|your[-_]?secret|secret|todo|placeholder)/i;
const ALL_SAME_CHAR = /^(.)\1*$/;
const HEX_32_BYTES = /^[0-9a-f]{64}$/i;

const configSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  // 4000 locally by default: port 3000 is occupied on this machine by an
  // unrelated dev server, and a silently shifted port makes every script lie.
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  APP_URL: z.url().default("http://localhost:4000"),
  LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
  DATABASE_PATH: z.string().min(1).default("./data/app.db"),
  DEFAULT_TIMEZONE: z.string().min(1).default("Asia/Jerusalem"),
  // Hebrew is the primary UI language, English the secondary one (spec §4).
  // Enum order encodes that priority: "he" first.
  DEFAULT_LANGUAGE: z.enum(["he", "en"]).default("he"),
  SMTP_HOST: z.string().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_SECURITY: z.enum(["tls", "starttls", "auto"]).default("starttls"),
  SMTP_USER: z.string().min(1).optional(),
  SMTP_PASS: z.string().min(1).optional(),
  SMTP_FROM: z.email().optional(),
  SMTP_FROM_NAME: z.string().min(1).default("Personal Dashboard"),
  GRAPH_CLIENT_ID: z.string().min(1).optional(),
  GRAPH_CLIENT_SECRET: z.string().min(1).optional(),
  GRAPH_TENANT_ID: z.string().min(1).default("common"),
  GRAPH_REDIRECT_PATH: z.string().min(1).default("/api/v1/integrations/onedrive/callback"),
  SESSION_SECRET: z.string().min(32).optional(),
  APP_ENCRYPTION_KEY: z
    .string()
    .regex(HEX_32_BYTES, "must be 32 random bytes as 64 hex characters")
    .optional(),
  // Argon2id parameters (spec §10: the choice must be recorded, §12: Argon2id).
  // Defaults are the OWASP baseline for interactive logins; raising them is an
  // env change, not a code change, and old hashes keep verifying because the PHC
  // string carries the parameters that produced them.
  ARGON2_MEMORY_KIB: z.coerce.number().int().min(8_192).max(1_048_576).default(19_456),
  ARGON2_TIME_COST: z.coerce.number().int().min(1).max(20).default(2),
  ARGON2_PARALLELISM: z.coerce.number().int().min(1).max(16).default(1),
  // Session lifetime and sliding renewal (spec §20: expiration + revocation).
  SESSION_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(300)
    .max(30 * 24 * 3600)
    .default(8 * 3600),
  SESSION_UPDATE_AGE_SECONDS: z.coerce
    .number()
    .int()
    .min(60)
    .max(24 * 3600)
    .default(3600),
  /** Privileged actions require a session fresher than this (spec §12 MFA policy). */
  SESSION_FRESH_AGE_SECONDS: z.coerce
    .number()
    .int()
    .min(60)
    .max(24 * 3600)
    .default(900),
  // Rate limiting is stored in the database, not in process memory (spec §12).
  RATE_LIMIT_WINDOW_SECONDS: z.coerce
    .number()
    .int()
    .min(10)
    .max(24 * 3600)
    .default(600),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().min(1).max(10_000).default(100),
  LOGIN_RATE_LIMIT_WINDOW_SECONDS: z.coerce
    .number()
    .int()
    .min(10)
    .max(24 * 3600)
    .default(900),
  LOGIN_RATE_LIMIT_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(1_000).default(10),
  TOTP_ISSUER: z.string().min(1).default("Personal Management Dashboard"),
  MFA_MAX_FAILED_ATTEMPTS: z.coerce.number().int().min(1).max(100).default(10),
  MFA_LOCKOUT_SECONDS: z.coerce
    .number()
    .int()
    .min(60)
    .max(24 * 3600)
    .default(900),
  MFA_REQUIRED_FOR_PRIVILEGED_ROLES: z.enum(["true", "false"]).default("true"),
});

type RawEnv = Record<string, string | undefined>;
type ConfigInput = z.infer<typeof configSchema>;

export interface AppPaths {
  root: string;
  databaseFile: string;
  databaseDir: string;
  dataDir: string;
  devSecretsFile: string;
  /** Path shown to operators — never an absolute host path (spec §14). */
  databaseDisplay: string;
}

export interface SmtpConfig {
  configured: true;
  host: string;
  port: number;
  security: "tls" | "starttls" | "auto";
  user: string;
  from: string;
  fromName: string;
}

export interface OnedriveConfig {
  configured: true;
  clientId: string;
  tenantId: string;
  redirectPath: string;
}

export interface AuthSettings {
  argon2: { memoryCostKiB: number; timeCost: number; parallelism: number };
  session: { expiresInSec: number; updateAgeSec: number; freshAgeSec: number };
  rateLimit: {
    windowSec: number;
    maxRequests: number;
    loginWindowSec: number;
    loginMaxAttempts: number;
  };
  twoFactor: { issuer: string; maxFailedAttempts: number; lockoutSeconds: number };
  /** Spec §12 policy: privileged roles cannot act without an enrolled authenticator. */
  privilegedRolesRequireMfa: boolean;
}

export interface AppConfig {
  nodeEnv: NodeEnv;
  isProduction: boolean;
  isDevelopment: boolean;
  isTest: boolean;
  port: number;
  appUrl: string;
  logLevel: LogLevel;
  defaultTimezone: string;
  /** Primary UI language (spec §4): "he" renders RTL, "en" is the secondary language. */
  defaultLanguage: "he" | "en";
  paths: AppPaths;
  smtp: SmtpConfig | null;
  onedrive: OnedriveConfig | null;
  auth: AuthSettings;
}

export interface AppEnv extends AppConfig {
  sessionSecret: string;
  encryptionKey: Buffer;
  /** Key version prefix enables rotation without decrypting old values blindly (spec §19). */
  encryptionKeyVersion: number;
  secretsWereGenerated: boolean;
}

function normalize(raw: RawEnv): RawEnv {
  const out: RawEnv = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    const trimmed = value.trim();
    // An empty value in .env means "not configured", not "empty string".
    out[key] = trimmed.length > 0 ? trimmed : undefined;
  }
  return out;
}

function displayPath(root: string, absolute: string): string {
  const rel = relative(root, absolute);
  return rel.length > 0 && !rel.startsWith("..") ? `./${rel.replace(/\\/g, "/")}` : absolute;
}

function buildPaths(databasePath: string): AppPaths {
  const root = process.cwd();
  const databaseFile = isAbsolute(databasePath)
    ? databasePath
    : resolve(/* turbopackIgnore: true */ root, databasePath);
  const databaseDir = dirname(databaseFile);
  // Dev secrets live beside the data directory: a test run pointed at another
  // database can never touch the real ./data directory.
  const dataDir = databaseDir;
  return {
    root,
    databaseFile,
    databaseDir,
    dataDir,
    devSecretsFile: resolve(/* turbopackIgnore: true */ dataDir, ".dev-secrets.json"),
    databaseDisplay: displayPath(root, databaseFile),
  };
}

function zodIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
}

function configIssues(data: ConfigInput): string[] {
  const issues: string[] = [];

  if (data.SMTP_HOST && (!data.SMTP_USER || !data.SMTP_PASS || !data.SMTP_FROM)) {
    const missing = [
      !data.SMTP_USER && "SMTP_USER",
      !data.SMTP_PASS && "SMTP_PASS",
      !data.SMTP_FROM && "SMTP_FROM",
    ]
      .filter(Boolean)
      .join(", ");
    issues.push(`SMTP_HOST is set but ${missing} ${missing.includes(",") ? "are" : "is"} missing.`);
  }

  if (data.GRAPH_CLIENT_ID && !data.GRAPH_CLIENT_SECRET) {
    issues.push("GRAPH_CLIENT_ID is set but GRAPH_CLIENT_SECRET is missing.");
  }
  if (!data.GRAPH_CLIENT_ID && data.GRAPH_CLIENT_SECRET) {
    issues.push("GRAPH_CLIENT_SECRET is set but GRAPH_CLIENT_ID is missing.");
  }

  return issues;
}

function secretIssues(data: ConfigInput): string[] {
  if (data.NODE_ENV !== "production") return [];

  const issues: string[] = [];
  const secret = data.SESSION_SECRET;
  const key = data.APP_ENCRYPTION_KEY;

  if (!secret) issues.push("SESSION_SECRET is required in production (at least 32 characters).");
  else if (SECRET_PLACEHOLDER.test(secret) || ALL_SAME_CHAR.test(secret))
    issues.push("SESSION_SECRET looks like a placeholder. Generate a random value.");

  if (!key)
    issues.push(
      "APP_ENCRYPTION_KEY is required in production (32 random bytes as 64 hex characters).",
    );
  else if (SECRET_PLACEHOLDER.test(key) || ALL_SAME_CHAR.test(key))
    issues.push("APP_ENCRYPTION_KEY looks like a placeholder. Generate a random value.");

  return issues;
}

function parseInput(source: RawEnv): ConfigInput {
  const parsed = configSchema.safeParse(normalize(source));
  if (!parsed.success) throw new EnvError(zodIssues(parsed.error));

  const issues = configIssues(parsed.data);
  if (issues.length > 0) throw new EnvError(issues);

  return parsed.data;
}

function toConfig(data: ConfigInput, paths: AppPaths, warnings: string[]): AppConfig {
  if (data.NODE_ENV === "production" && !data.APP_URL.startsWith("https://")) {
    warnings.push(
      "APP_URL is not an https:// origin. Production must be served over HTTPS through the reverse proxy (spec §20).",
    );
  }

  return {
    nodeEnv: data.NODE_ENV,
    isProduction: data.NODE_ENV === "production",
    isDevelopment: data.NODE_ENV === "development",
    isTest: data.NODE_ENV === "test",
    port: data.PORT,
    appUrl: data.APP_URL.replace(/\/+$/, ""),
    logLevel: data.LOG_LEVEL,
    defaultTimezone: data.DEFAULT_TIMEZONE,
    defaultLanguage: data.DEFAULT_LANGUAGE,
    paths,
    smtp: data.SMTP_HOST
      ? {
          configured: true,
          host: data.SMTP_HOST,
          port: data.SMTP_PORT,
          security: data.SMTP_SECURITY,
          user: data.SMTP_USER as string,
          from: data.SMTP_FROM as string,
          fromName: data.SMTP_FROM_NAME,
        }
      : null,
    onedrive:
      data.GRAPH_CLIENT_ID && data.GRAPH_CLIENT_SECRET
        ? {
            configured: true,
            clientId: data.GRAPH_CLIENT_ID,
            tenantId: data.GRAPH_TENANT_ID,
            redirectPath: data.GRAPH_REDIRECT_PATH,
          }
        : null,
    auth: {
      argon2: {
        memoryCostKiB: data.ARGON2_MEMORY_KIB,
        timeCost: data.ARGON2_TIME_COST,
        parallelism: data.ARGON2_PARALLELISM,
      },
      session: {
        expiresInSec: data.SESSION_TTL_SECONDS,
        updateAgeSec: data.SESSION_UPDATE_AGE_SECONDS,
        freshAgeSec: data.SESSION_FRESH_AGE_SECONDS,
      },
      rateLimit: {
        windowSec: data.RATE_LIMIT_WINDOW_SECONDS,
        maxRequests: data.RATE_LIMIT_MAX_REQUESTS,
        loginWindowSec: data.LOGIN_RATE_LIMIT_WINDOW_SECONDS,
        loginMaxAttempts: data.LOGIN_RATE_LIMIT_MAX_ATTEMPTS,
      },
      twoFactor: {
        issuer: data.TOTP_ISSUER,
        maxFailedAttempts: data.MFA_MAX_FAILED_ATTEMPTS,
        lockoutSeconds: data.MFA_LOCKOUT_SECONDS,
      },
      privilegedRolesRequireMfa: data.MFA_REQUIRED_FOR_PRIVILEGED_ROLES === "true",
    },
  };
}

/** Build-safe and status-safe: never touches secrets, never writes files. */
export function parseConfig(source: RawEnv = process.env): {
  config: AppConfig;
  warnings: string[];
} {
  const data = parseInput(source);
  const warnings: string[] = [];
  return { config: toConfig(data, buildPaths(data.DATABASE_PATH), warnings), warnings };
}

interface ResolvedSecrets {
  sessionSecret: string;
  encryptionKey: string;
  generated: boolean;
}

function resolveSecrets(data: ConfigInput, paths: AppPaths, warnings: string[]): ResolvedSecrets {
  const nodeEnv = data.NODE_ENV;
  const providedSecret = data.SESSION_SECRET;
  const providedKey = data.APP_ENCRYPTION_KEY;

  if (nodeEnv === "production") {
    // Validated by secretIssues(); a production process never generates its own secrets.
    return {
      sessionSecret: providedSecret as string,
      encryptionKey: providedKey as string,
      generated: false,
    };
  }

  if (providedSecret && providedKey)
    return { sessionSecret: providedSecret, encryptionKey: providedKey, generated: false };

  if (nodeEnv === "test") {
    return {
      sessionSecret: providedSecret ?? randomBytes(32).toString("hex"),
      encryptionKey: providedKey ?? randomBytes(32).toString("hex"),
      generated: true,
    };
  }

  let existing: { sessionSecret?: unknown; encryptionKey?: unknown } | undefined;
  try {
    existing = JSON.parse(readFileSync(paths.devSecretsFile, "utf8"));
  } catch {
    existing = undefined;
  }

  const reusableSecret =
    typeof existing?.sessionSecret === "string" && existing.sessionSecret.length >= 32;
  const reusableKey =
    typeof existing?.encryptionKey === "string" && HEX_32_BYTES.test(existing.encryptionKey);

  if (reusableSecret && reusableKey && !providedSecret && !providedKey) {
    return {
      sessionSecret: existing?.sessionSecret as string,
      encryptionKey: existing?.encryptionKey as string,
      generated: false,
    };
  }

  const sessionSecret = providedSecret ?? randomBytes(32).toString("hex");
  const encryptionKey = providedKey ?? randomBytes(32).toString("hex");

  try {
    mkdirSync(/* turbopackIgnore: true */ paths.dataDir, { recursive: true });
    writeFileSync(
      paths.devSecretsFile,
      JSON.stringify(
        { createdAt: new Date().toISOString(), sessionSecret, encryptionKey },
        null,
        2,
      ),
      { encoding: "utf8", mode: 0o600 },
    );
    warnings.push(
      `SESSION_SECRET / APP_ENCRYPTION_KEY were not set: generated throwaway development values in ${displayPath(
        paths.root,
        paths.devSecretsFile,
      )}. These are not for production and sessions end when they are regenerated.`,
    );
  } catch {
    warnings.push(
      "SESSION_SECRET / APP_ENCRYPTION_KEY were not set: using temporary in-memory development values.",
    );
  }

  return { sessionSecret, encryptionKey, generated: true };
}

/** Full configuration including runtime secrets. Strict in production. */
export function parseEnv(source: RawEnv = process.env): { env: AppEnv; warnings: string[] } {
  const data = parseInput(source);

  const issues = secretIssues(data);
  if (issues.length > 0) throw new EnvError(issues);

  const warnings: string[] = [];
  const paths = buildPaths(data.DATABASE_PATH);
  const config = toConfig(data, paths, warnings);
  const secrets = resolveSecrets(data, paths, warnings);

  return {
    env: {
      ...config,
      sessionSecret: secrets.sessionSecret,
      encryptionKey: Buffer.from(secrets.encryptionKey, "hex"),
      encryptionKeyVersion: 1,
      secretsWereGenerated: secrets.generated,
    },
    warnings,
  };
}

/** Reports production secret readiness without throwing (admin/health reporting). */
export function secretReadiness(source: RawEnv = process.env): {
  required: boolean;
  ok: boolean;
  issues: string[];
} {
  let data: ConfigInput;
  try {
    data = parseInput(source);
  } catch (error) {
    const issues = error instanceof EnvError ? error.issues : ["configuration is invalid"];
    return { required: normalize(source).NODE_ENV === "production", ok: false, issues };
  }

  const issues = secretIssues(data);
  return { required: data.NODE_ENV === "production", ok: issues.length === 0, issues };
}

let cachedConfig: AppConfig | undefined;
let cachedEnv: AppEnv | undefined;
let cachedWarnings: string[] = [];
let dotenvLoaded = false;

function ensureDotenv(): void {
  if (dotenvLoaded) return;
  if (process.env.NODE_ENV !== "test") loadDotenv();
  dotenvLoaded = true;
}

export function getConfig(): AppConfig {
  if (cachedConfig) return cachedConfig;
  ensureDotenv();
  const { config, warnings } = parseConfig(process.env);
  cachedConfig = config;
  if (cachedWarnings.length === 0) cachedWarnings = warnings;
  return config;
}

export function getEnv(): AppEnv {
  if (cachedEnv) return cachedEnv;
  ensureDotenv();
  const { env, warnings } = parseEnv(process.env);
  cachedEnv = env;
  cachedWarnings = warnings;
  return env;
}

export function getEnvWarnings(): string[] {
  try {
    getEnv();
  } catch {
    // Secrets may be missing; config-level warnings are still worth showing.
    getConfig();
  }
  return cachedWarnings;
}

/** Test seam: lets a suite point the app at an isolated SQLite file. */
export function resetEnvCache(): void {
  cachedConfig = undefined;
  cachedEnv = undefined;
  cachedWarnings = [];
}
