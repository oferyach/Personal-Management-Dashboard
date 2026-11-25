/**
 * E2E server runner (cross-platform, no shell quoting tricks).
 *
 * Runs the same artifact the Docker image runs:
 *   NODE_ENV=production + fresh database + real migrations
 *   + .next/standalone/server.js (Next "output: standalone" entrypoint).
 *
 * The first privileged account is created the way an install creates it - through the
 * admin:create CLI, out of band, before the server starts - so the auth E2E spec has a real
 * account to sign into and no test invents a shortcut around bootstrap. Those values are
 * E2E-only and are mirrored literally in tests/e2e/auth.spec.ts.
 *
 * The secrets here are obviously E2E-only, provided via env and never committed.
 * Pass --no-secrets to exercise the fail-closed startup path.
 */
import { spawn } from "node:child_process";
import { cpSync, existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import Database from "better-sqlite3";

const port = Number(process.env.E2E_PORT ?? 4100);
const standaloneDir = resolve(process.cwd(), ".next", "standalone");
// The standalone server resolves relative paths from its own directory, so the
// migration step and the server must use the same working directory.
const databasePath = `./data/e2e-${port}.db`;

const env = {
  ...process.env,
  NODE_ENV: "production",
  PORT: String(port),
  APP_URL: `http://127.0.0.1:${port}`,
  DATABASE_PATH: databasePath,
  HOSTNAME: "127.0.0.1",
  LOG_LEVEL: process.env.E2E_LOG_LEVEL ?? "warn",
  // Both Playwright projects share one loopback address and deliberately perform
  // many complete sign-ins. Keep the production limiter enabled but lift its cap
  // so the test runner itself does not become a single noisy client.
  LOGIN_RATE_LIMIT_MAX_ATTEMPTS: "100",
  // E2E-only values: long and random-looking enough to pass production validation,
  // never used outside a local run against 127.0.0.1.
  SESSION_SECRET: "e2e-session-0f3c9a71b6d24e5f8c1a90ab65de4723c8b1f0a4d6e92753",
  APP_ENCRYPTION_KEY: "3c9a71b6d24e5f8c1a90ab65de4723c8b1f0a4d6e927530fc3e9a71b6d24e5f8",
};

if (process.argv.includes("--no-secrets")) {
  delete env.SESSION_SECRET;
  delete env.APP_ENCRYPTION_KEY;
}

const bootstrapped = !process.argv.includes("--no-secrets");
// E2E-only identities, mirrored literally in tests/e2e/helpers.ts: a privileged account
// (the auth spec gives it a factor) and an ordinary one the other specs sign into.
const adminEmail = "e2e-admin@dashboard.local";
const adminPassword = "e2e-admin-password-1";
const observerEmail = "e2e-observer@dashboard.local";
const observerPassword = "e2e-observer-password-1";
// A `read_only` account: the events surface needs a session that holds the read
// grants and none of the write grants, so a denied write reads as 403 rather
// than an unauthenticated 401.
const readerEmail = "e2e-reader@dashboard.local";
const readerPassword = "e2e-reader-password-1";

function removeDatabases(dir) {
  for (const suffix of ["", "-wal", "-shm"]) {
    rmSync(resolve(dir, databasePath + suffix), { force: true });
  }
}

function prepareStandalone() {
  if (!existsSync(resolve(standaloneDir, "server.js"))) {
    throw new Error(`No standalone build at ${standaloneDir}. Run "npm run build" first.`);
  }
  if (!existsSync(resolve(standaloneDir, "drizzle"))) {
    throw new Error(
      "Migrations were not traced into the standalone build (check outputFileTracingIncludes).",
    );
  }
  cpSync(resolve(process.cwd(), ".next", "static"), resolve(standaloneDir, ".next", "static"), {
    recursive: true,
  });
  if (existsSync(resolve(process.cwd(), "public"))) {
    cpSync(resolve(process.cwd(), "public"), resolve(standaloneDir, "public"), { recursive: true });
  }
}

function main() {
  try {
    prepareStandalone();
  } catch (error) {
    console.error(String(error instanceof Error ? error.message : error));
    process.exit(1);
    return;
  }

  removeDatabases(standaloneDir);
  removeDatabases(process.cwd());

  const migrate = spawn(
    process.execPath,
    [
      resolve(process.cwd(), "node_modules/tsx/dist/cli.mjs"),
      "--tsconfig",
      resolve(process.cwd(), "tsconfig.json"),
      resolve(process.cwd(), "scripts/db-migrate.ts"),
      "--deploy",
    ],
    { cwd: standaloneDir, env, stdio: ["ignore", "inherit", "inherit"] },
  );

  migrate.on("exit", (code) => {
    if (code !== 0) {
      console.error(`e2e setup failed: migrations exited with ${code}`);
      process.exit(code ?? 1);
      return;
    }

    if (bootstrapped)
      bootstrapAccount(adminEmail, "E2E Administrator", null, adminPassword, [], () => {
        bootstrapAccount(
          observerEmail,
          "E2E Observer",
          "user",
          observerPassword,
          ["--force", "--confirm"],
          () => {
            // A `read_only` account: the events surface needs a session holding
            // the read grants and none of the write grants, so a denied write
            // reads as 403 missing_permission rather than 401.
            bootstrapAccount(
              readerEmail,
              "E2E Reader",
              "read_only",
              readerPassword,
              ["--force", "--confirm"],
              () => {
                prepareObserverFixture();
                startServer();
              },
            );
          },
        );
      });
    else startServer();
  });

  // Work item 1.3, the way an install does it: the admin:create CLI, out of band, against
  // the same database the standalone server is about to open. It runs from the repository
  // root (tsx resolves the @lib/* aliases there) with absolute database paths, while the
  // server keeps the relative ones the status page is asserted to report.
  function bootstrapAccount(email, name, role, password, extraFlags, next) {
    const absoluteDb = resolve(standaloneDir, databasePath);
    const cli = spawn(
      process.execPath,
      [
        resolve(process.cwd(), "node_modules/tsx/dist/cli.mjs"),
        resolve(process.cwd(), "scripts/admin-bootstrap.ts"),
        "--email",
        email,
        "--name",
        name,
        ...(role === null ? [] : ["--role", role]),
        ...(extraFlags || []),
        "--password-stdin",
      ],
      {
        cwd: process.cwd(),
        env: {
          ...env,
          DATABASE_PATH: absoluteDb,
          DATABASE_FILE: absoluteDb,
          ADMIN_PASSWORD: password,
        },
        stdio: ["pipe", "inherit", "inherit"],
      },
    );

    // Close stdin — the CLI tries stdin first, and if the line is empty
    // it falls back to the ADMIN_PASSWORD env variable.
    cli.stdin.end();

    cli.on("exit", (code) => {
      if (code !== 0) {
        console.error(`e2e setup failed: admin bootstrap exited with ${code}`);
        process.exit(code ?? 1);
      }
      next();
    });
    cli.on("error", (error) => {
      console.error(`e2e setup failed: admin bootstrap error ${error}`);
      process.exit(1);
    });
  }

  /**
   * Most browser specs need a stable ordinary session rather than repeating the
   * first-login password ceremony. The auth spec separately proves that ceremony
   * through a user created in the UI, so this fixture-only normalization cannot
   * hide a regression in the shipped flow.
   */
  function prepareObserverFixture() {
    const absoluteDb = resolve(standaloneDir, databasePath);
    const fixtureDb = new Database(absoluteDb);
    try {
      const result = fixtureDb
        .prepare('UPDATE "users" SET must_change_password = 0 WHERE email = ?')
        .run(observerEmail);
      if (result.changes !== 1) throw new Error("observer fixture account was not found");
    } finally {
      fixtureDb.close();
    }
  }

  function startServer() {
    const server = spawn(process.execPath, [resolve(standaloneDir, "server.js")], {
      cwd: standaloneDir,
      env,
      stdio: ["ignore", "inherit", "inherit"],
    });

    const shutdown = (signal) => {
      server.kill(signal);
      process.exit(0);
    };

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));

    server.on("exit", (code, signal) => {
      if (code !== 0 && code !== null)
        console.error(`e2e server exited with code ${code} signal ${signal}`);
      process.exit(code ?? 0);
    });
  }
}

main();
