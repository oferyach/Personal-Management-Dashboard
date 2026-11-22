#!/usr/bin/env node
/**
 * Production entry point for running the app on a host without Docker
 * (spec §20: the app is a standalone Node server, not `next start`).
 *
 * `next start` explicitly refuses to work with `output: "standalone"`, so this
 * script prepares the standalone output and runs it:
 *   - verifies the build exists
 *   - copies immutable static assets and public files next to the server
 *   - keeps process.cwd() at the project root so DATABASE_PATH ("./data/app.db")
 *     and the migration folder resolve exactly like the documented layout
 *
 * The server applies migrations on boot and exits 1 on invalid production
 * configuration (see src/lib/serverStart.ts).
 */

import { cpSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const root = process.cwd();
const standaloneDir = resolve(root, ".next", "standalone");
const serverEntry = resolve(standaloneDir, "server.js");

if (!existsSync(serverEntry)) {
  console.error(`No standalone build at ${standaloneDir}. Run "npm run build" first.`);
  process.exit(1);
}

const staticOut = resolve(standaloneDir, ".next", "static");
const staticSource = resolve(root, ".next", "static");
if (existsSync(staticSource) && !existsSync(staticOut)) {
  cpSync(staticSource, staticOut, { recursive: true });
}

const publicSource = resolve(root, "public");
if (existsSync(publicSource)) {
  cpSync(publicSource, resolve(standaloneDir, "public"), { recursive: true });
}

const port = Number(process.env.PORT ?? 4000);
const hostname = process.env.HOSTNAME ?? "0.0.0.0";

const env = {
  ...process.env,
  NODE_ENV: process.env.NODE_ENV ?? "production",
  PORT: String(port),
  HOSTNAME: hostname,
};

const child = spawn(process.execPath, [serverEntry], { cwd: root, env, stdio: "inherit" });

child.on("exit", (code, signal) => {
  process.exitCode = signal ? 1 : (code ?? 1);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
