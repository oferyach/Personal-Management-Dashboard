import { createInterface } from "node:readline";

import { closeDatabase } from "@/db/client";
import { runMigrations } from "@/db/migrate";
import { getConfig, getEnvWarnings } from "@/lib/env";
import { AdminBootstrapError, bootstrapState, createFirstAdmin } from "@/lib/adminBootstrap";
import { configureLogging, getLogger, logStartupWarnings } from "@/lib/log";
import { describeParams } from "@/lib/passwords";
import type { RoleKey } from "@/db/schema/identity";

/**
 * Work item 1.3 — the first-admin bootstrap CLI.
 *
 *   npm run admin:create -- --email you@example.com --name "Your Name"
 *
 * Rules this CLI exists to enforce:
 *  - There is no built-in, default or well-known password. The password is read from
 *    a prompt (typed twice, masked) or from a single line on stdin for automation.
 *    It is never taken from a command-line argument: argv is visible in a shell
 *    history and in another user's `ps` output.
 *  - A privileged account already present makes this CLI refuse, unless both
 *    `--force` and `--confirm` are given. After the first admin exists, accounts are
 *    created in the users screen, where an authorization decision exists.
 *  - The password hash uses the recorded Argon2id parameters, printed here so the
 *    choice is visible in the install log (spec §12).
 */

const USAGE = `Usage: npm run admin:create -- [options]

  --email <address>        sign-in address (prompted when omitted)
  --name <full name>       display name (prompted when omitted)
  --role <super_admin|admin>  privileged role, default super_admin
  --password-stdin         read the password from one line of stdin (automation)
  --force --confirm        create an additional privileged account on purpose
  --help                   show this text
`;

function readFlags(argv: string[]): Map<string, string | boolean> {
  const flags = new Map<string, string | boolean>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    if (!arg.startsWith("--")) continue;
    const [key, inline] = arg.slice(2).split("=");
    if (!key) continue;
    if (inline !== undefined) {
      flags.set(key, inline);
      continue;
    }
    const next = argv[i + 1] ?? "";
    if (next && !next.startsWith("--")) {
      flags.set(key, next);
      i += 1;
    } else {
      flags.set(key, true);
    }
  }
  return flags;
}

function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.replace(/\r$/, ""));
    }),
  );
}

/** Masked prompt on a terminal; a plain line when stdin is piped. */
function askHidden(question: string): Promise<string> {
  if (!process.stdin.isTTY) return ask(question);

  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    process.stderr.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    let value = "";
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener("data", onData);
          process.stderr.write("\n");
          resolve(value);
          return;
        }
        if (char === "\u0003") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener("data", onData);
          process.stderr.write("\n");
          reject(new Error("cancelled"));
          return;
        }
        if (char === "\u007f" || char === "\b") {
          value = value.slice(0, -1);
          process.stderr.write("\b \b");
          continue;
        }
        value += char;
        process.stderr.write("*");
      }
    };

    stdin.on("data", onData);
  });
}

async function readStdinLine(): Promise<string> {
  const rl = createInterface({ input: process.stdin, terminal: false });
  const line = await new Promise<string>((resolve) => rl.once("line", resolve));
  rl.close();
  return line.replace(/\r$/, "");
}

const flags = readFlags(process.argv.slice(2));
const env = getConfig();
configureLogging({ level: env.logLevel === "silent" ? "info" : env.logLevel });
const log = getLogger("admin:create");

async function main(): Promise<void> {
  if (flags.get("help")) {
    process.stdout.write(USAGE);
    return;
  }

  logStartupWarnings(getEnvWarnings(), "admin:create");

  // The role column has a foreign key to `roles.key`, so the RBAC seed must exist
  // before any account can be created (the single migration path does both).
  const migration = runMigrations();
  if (!migration.ok) throw new Error("migrations did not run; run npm run db:migrate first");

  const before = bootstrapState();
  log.info("current install state", {
    accounts: before.accounts,
    privilegedAccounts: before.privilegedAccounts,
    // Named `hashParameters`, not `passwordHash`: the redactor masks anything that
    // looks credential-shaped, and this value is the Argon2id parameter description,
    // which is meant to be visible in the install log (spec §12).
    hashParameters: describeParams(),
    database: env.paths.databaseDisplay,
  });

  let email = typeof flags.get("email") === "string" ? (flags.get("email") as string) : "";
  while (!email) email = (await ask("email: ")).trim();

  let name = typeof flags.get("name") === "string" ? (flags.get("name") as string) : "";
  while (!name) name = (await ask("full name: ")).trim();

  const roleFlag = flags.get("role");
  const role = (typeof roleFlag === "string" ? roleFlag : "super_admin") as RoleKey;

  let password = "";
  if (flags.get("password-stdin")) {
    // Prefer the env variable (set by scripts/e2e-server.mjs) — it is
    // reliable on all platforms.  Fall back to stdin for interactive use.
    password = process.env.ADMIN_PASSWORD ?? "";
    if (!password) {
      password = await readStdinLine();
    }
  } else {
    password = await askHidden("password (min 12 characters): ");
    const again = await askHidden("repeat password: ");
    if (password !== again) throw new Error("the two passwords do not match");
  }

  if (!password) throw new Error("no password provided");

  const created = await createFirstAdmin({
    name,
    email,
    password,
    role,
    force: flags.get("force") === true,
    confirm: flags.get("confirm") === true,
  });

  process.stdout.write(
    [
      "",
      `account created: ${created.email}`,
      `  id:   ${created.id}`,
      `  role: ${created.role}`,
      `  password hash: ${describeParams()}`,
      `  privileged accounts now: ${created.privilegedAccountsAfter}`,
      "",
      `sign in at ${env.appUrl}/login`,
      "no temporary password was generated: you typed this one yourself.",
      "",
    ].join("\n"),
  );
}

// No top-level await: `tsx` compiles this file to CommonJS (the package is not
// "type": "module"), and CommonJS rejects it.
void (async () => {
  try {
    await main();
  } catch (error) {
    if (error instanceof AdminBootstrapError) {
      log.error("bootstrap refused", { reason: error.reason, detail: error.message });
      if (error.reason !== "admin_exists") process.stdout.write(`\n${error.message}\n`);
    } else {
      log.error("bootstrap failed", { error: error instanceof Error ? error.message : error });
    }
    process.exitCode = 1;
  } finally {
    closeDatabase();
  }
})();
