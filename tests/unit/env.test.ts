import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EnvError, parseConfig, parseEnv, secretReadiness } from "@/lib/env";
import { testDatabasePath } from "../helpers/testDb";

const SESSION = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718";
const KEY = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
const PROD_URL = "https://dashboard.example.com";

/**
 * Unit tests never rely on process.env: every case passes an explicit config,
 * and NODE_ENV=test keeps validation from writing into the real ./data dir.
 */
function config(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return { NODE_ENV: "test", LOG_LEVEL: "silent", ...overrides };
}

function production(overrides: Record<string, string | undefined> = {}) {
  return config({ NODE_ENV: "production", APP_URL: PROD_URL, ...overrides });
}

function validSecrets() {
  return { SESSION_SECRET: SESSION, APP_ENCRYPTION_KEY: KEY };
}

function parse(overrides: Record<string, string | undefined> = {}) {
  return parseEnv(config(overrides));
}

function issuesOf(source: Record<string, string | undefined>): string {
  try {
    parseEnv(source);
  } catch (error) {
    expect(error).toBeInstanceOf(EnvError);
    return (error as EnvError).issues.join("\n");
  }
  throw new Error("expected parseEnv to throw");
}

describe("environment validation", () => {
  it("applies safe defaults and resolves the database path", () => {
    const { env, warnings } = parse();

    expect(env.nodeEnv).toBe("test");
    expect(env.port).toBe(4000);
    expect(env.appUrl).toBe("http://localhost:4000");
    expect(env.defaultTimezone).toBe("Asia/Jerusalem");
    // Hebrew is the primary UI language, so it is also the default rendering.
    expect(env.defaultLanguage).toBe("he");
    expect(env.logLevel).toBe("silent");
    expect(env.paths.databaseFile).toMatch(/[\\/]app\.db$/);
    expect(env.paths.databaseDisplay.startsWith("./")).toBe(true);
    expect(warnings).toEqual([]);
  });

  it("reports optional integrations as not configured instead of faking them", () => {
    const { env } = parse();
    expect(env.smtp).toBeNull();
    expect(env.onedrive).toBeNull();
  });

  it("treats empty .env values as 'not configured'", () => {
    const { env } = parse({ SMTP_HOST: "", SMTP_USER: "", GRAPH_CLIENT_ID: "  " });
    expect(env.smtp).toBeNull();
    expect(env.onedrive).toBeNull();
  });

  it("generates throwaway secrets outside production without writing them to disk", () => {
    const { env } = parse({
      DATABASE_PATH: testDatabasePath("env-secrets"),
      SESSION_SECRET: undefined,
      APP_ENCRYPTION_KEY: undefined,
    });

    expect(env.secretsWereGenerated).toBe(true);
    expect(env.sessionSecret.length).toBeGreaterThanOrEqual(32);
    expect(env.encryptionKey.length).toBe(32);
    // The generated values must stay in memory, next to the isolated database.
    expect(existsSync(env.paths.devSecretsFile)).toBe(false);
    expect(env.paths.databaseFile).toContain(".test-tmp");
  });

  it("refuses to run production without secrets", () => {
    const issues = issuesOf(production());
    expect(issues).toContain("SESSION_SECRET");
    expect(issues).toContain("APP_ENCRYPTION_KEY");
  });

  it("refuses placeholder secrets in production", () => {
    const issues = issuesOf(
      production({
        ...validSecrets(),
        SESSION_SECRET: "change-me-please-change-me-please-1234",
        APP_ENCRYPTION_KEY: "0".repeat(64),
      }),
    );
    expect(issues).toContain("SESSION_SECRET");
    expect(issues).toContain("placeholder");
  });

  it("requires a 32-byte hex encryption key", () => {
    const issues = issuesOf(config({ APP_ENCRYPTION_KEY: "short-key" }));
    expect(issues).toContain("APP_ENCRYPTION_KEY");
    expect(issues).toContain("hex");
  });

  it("warns (does not guess) when production is configured over http", () => {
    const { warnings } = parseEnv(
      production({ ...validSecrets(), APP_URL: "http://dashboard.example.com" }),
    );
    expect(warnings.join("\n")).toContain("HTTPS");
  });

  it("requires a complete SMTP block when SMTP_HOST is set", () => {
    const issues = issuesOf(config({ SMTP_HOST: "smtp.example.com" }));
    expect(issues).toContain("SMTP_USER");
    expect(issues).toContain("SMTP_PASS");
    expect(issues).toContain("SMTP_FROM");
  });

  it("accepts a complete SMTP block and keeps documented defaults", () => {
    const { env } = parse({
      SMTP_HOST: "smtp.example.com",
      SMTP_USER: "user",
      SMTP_PASS: "pass",
      SMTP_FROM: "dashboard@example.com",
    });

    expect(env.smtp !== null).toBe(true);
    expect(env.smtp?.configured).toBe(true);
    expect(env.smtp?.port).toBe(587);
    expect(env.smtp?.security).toBe("starttls");
    expect(env.smtp?.fromName).toBe("Personal Dashboard");
  });

  it("rejects a half-configured OneDrive integration", () => {
    const issues = issuesOf(config({ GRAPH_CLIENT_ID: "client-id" }));
    expect(issues).toContain("GRAPH_CLIENT_SECRET");
  });

  it("reports a fully configured OneDrive integration", () => {
    const { env } = parse({ GRAPH_CLIENT_ID: "client-id", GRAPH_CLIENT_SECRET: "client-secret" });
    expect(env.onedrive?.configured).toBe(true);
    expect(env.onedrive?.tenantId).toBe("common");
    expect(env.onedrive?.redirectPath).toBe("/api/v1/integrations/onedrive/callback");
  });

  it("coerces numeric strings and normalizes the app URL", () => {
    const { env } = parse({ PORT: "8080", APP_URL: "https://dashboard.example.com/" });
    expect(env.port).toBe(8080);
    expect(env.appUrl).toBe("https://dashboard.example.com");
  });

  it("rejects invalid enum values naming the variable", () => {
    expect(issuesOf(config({ NODE_ENV: "productionn" }))).toContain("NODE_ENV");
  });

  it("rejects a port outside the valid range", () => {
    expect(issuesOf(config({ PORT: "70000" }))).toContain("PORT");
  });

  it("rejects an invalid email for SMTP_FROM", () => {
    const issues = issuesOf(
      config({ SMTP_HOST: "smtp.example.com", SMTP_USER: "u", SMTP_PASS: "p", SMTP_FROM: "nope" }),
    );
    expect(issues).toContain("SMTP_FROM");
  });
});

describe("build-safe configuration vs runtime secrets", () => {
  it("builds production configuration without secrets (build must not need runtime secrets)", () => {
    const { config: cfg, warnings } = parseConfig(production());

    expect(cfg.nodeEnv).toBe("production");
    expect(cfg.isProduction).toBe(true);
    expect(cfg.appUrl).toBe(PROD_URL);
    expect(cfg.paths.databaseDisplay.startsWith("./")).toBe(true);
    expect(warnings).toEqual([]);
    expect("sessionSecret" in cfg).toBe(false);
    expect("encryptionKey" in cfg).toBe(false);
  });

  it("still rejects broken non-secret configuration at build time", () => {
    let caught: EnvError | undefined;
    try {
      parseConfig(production({ SMTP_HOST: "smtp.example.com" }));
    } catch (error) {
      caught = error as EnvError;
    }
    expect(caught).toBeInstanceOf(EnvError);
    expect(caught?.issues.join("\n")).toContain("SMTP_USER");
  });

  it("reports production secret readiness without throwing", () => {
    const missing = secretReadiness(production());
    expect(missing.required).toBe(true);
    expect(missing.ok).toBe(false);
    expect(missing.issues.join("\n")).toContain("SESSION_SECRET");

    const complete = secretReadiness(production(validSecrets()));
    expect(complete.ok).toBe(true);
    expect(complete.issues).toEqual([]);

    const development = secretReadiness(config());
    expect(development.required).toBe(false);
    expect(development.ok).toBe(true);
  });

  it("keeps the strict path strict: production still refuses to serve without secrets", () => {
    expect(() => parseEnv(production())).toThrow(EnvError);
    expect(parseEnv(production(validSecrets())).env.secretsWereGenerated).toBe(false);
  });
});
