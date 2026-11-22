import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

/**
 * Fail-closed verification: a production process must refuse to serve when the
 * runtime secrets are missing, instead of inventing them.
 * This runs its own server instance on a separate port.
 */
test("production startup fails closed when secrets are missing", async () => {
  const port = 4111;

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    E2E_PORT: String(port),
    E2E_LOG_LEVEL: "info",
  };
  // Same entrypoint as the healthy E2E server, minus the secrets.
  delete env.SESSION_SECRET;
  delete env.APP_ENCRYPTION_KEY;
  delete env.PORT;

  const child = spawn(process.execPath, ["scripts/e2e-server.mjs", "--no-secrets"], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  child.stdout.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });

  const exitCode = await new Promise<number | null>((resolveExit) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolveExit(null);
    }, 60_000);
    child.on("exit", (code: number | null) => {
      clearTimeout(timer);
      resolveExit(code);
    });
  });

  expect(exitCode, `server output:\n${output}`).toBe(1);
  expect(output).toContain("refusing to start");
  expect(output).toContain("SESSION_SECRET");
  expect(output).toContain("APP_ENCRYPTION_KEY");
  expect(output).not.toContain("e2e-session");

  for (const dir of [resolve(process.cwd()), resolve(process.cwd(), ".next", "standalone")]) {
    for (const suffix of ["", "-wal", "-shm"]) {
      rmSync(resolve(dir, `data/e2e-${port}.db${suffix}`), { force: true });
    }
  }
});
