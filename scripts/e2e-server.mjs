/**
 * E2E server runner (cross-platform, no shell quoting tricks).
 *
 * Runs the same artifact the Docker image runs:
 *   NODE_ENV=production + fresh database + real migrations
 *   + .next/standalone/server.js (Next "output: standalone" entrypoint).
 *
 * The secrets here are obviously E2E-only, provided via env and never committed.
 * Pass --no-secrets to exercise the fail-closed startup path.
 */
import { spawn } from "node:child_process";
import { cpSync, existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";

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
  // E2E-only values: long and random-looking enough to pass production validation,
  // never used outside a local run against 127.0.0.1.
  SESSION_SECRET: "e2e-session-0f3c9a71b6d24e5f8c1a90ab65de4723c8b1f0a4d6e92753",
  APP_ENCRYPTION_KEY: "3c9a71b6d24e5f8c1a90ab65de4723c8b1f0a4d6e927530fc3e9a71b6d24e5f8",
};

if (process.argv.includes("--no-secrets")) {
  delete env.SESSION_SECRET;
  delete env.APP_ENCRYPTION_KEY;
}

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
  });
}

main();
